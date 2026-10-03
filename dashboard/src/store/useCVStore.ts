import { create } from 'zustand';
import { produce, Draft } from 'immer';
import { v4 as uuid } from 'uuid';
import { CVData, JobRef, SkillEntry } from '../types';
import { GeneratedCV, StoredProfile, StoredCV, saveTailoredCV, listTailoredCVs } from '../api/backend';
import { generatedCvToCVData } from '../utils/cv';
import { DEFAULT_TEMPLATE_ID } from '../components/templates';
import { CVSync, installVisibilityFlush } from '../utils/cvSync';

export interface ViewerMeta {
  companyName: string;
  jobTitle: string;
}

/** Where a CV stands with the backend. `dirty` means the local copy has edits
 * the server hasn't acknowledged, so a hydrate must not overwrite it. */
export type CVSyncState = 'synced' | 'dirty' | 'saving' | 'error';

export interface TailoredCVEntry {
  /** This CV's own identity. A user can hold several CVs for the same job, so
   * this is deliberately NOT the job id. */
  cvId: string;
  /** The job this was tailored for, or null for a CV that isn't tied to one. */
  jobId: string | null;
  meta: ViewerMeta;
  jobRef: JobRef;
  cv: CVData;
  generatedAt: string;
  updatedAt: string;
  templateId: string;
  syncState: CVSyncState;
}

interface AppStore {
  email: string;
  cvs: TailoredCVEntry[];
  viewerCv: CVData | null;
  viewerMeta: ViewerMeta | null;
  viewerCvId: string | null;
  viewerTemplateId: string;
  /** True once the backend has been consulted for the signed-in user. */
  hydrated: boolean;

  initFromSession: () => Promise<void>;
  logout: () => Promise<void>;
  /** Load the signed-in user's CVs from the backend and merge them with the
   * local directory, then push anything only-local up. */
  hydrate: () => Promise<void>;
  saveGeneratedCV: (
    profile: StoredProfile | null,
    generated: GeneratedCV,
    jobId: string,
    jobRef: JobRef,
  ) => void;
  selectCV: (cvId: string) => void;
  getCV: (cvId: string) => TailoredCVEntry | undefined;
  /** Every CV tailored for a job, most recently generated first. */
  getCVsForJob: (jobId: string) => TailoredCVEntry[];
  setTemplate: (cvId: string, templateId: string) => void;
  deleteCV: (cvId: string) => Promise<void>;
  /** Apply an in-place edit to a stored CV. Callers mutate the `draft` (see
   * `setFieldByPath` in utils/cvEdits.ts) and the result is persisted + made
   * the active viewer CV if that CV is open. */
  updateCV: (cvId: string, updater: (draft: Draft<CVData>) => void, immediate?: boolean) => void;
}

const EMAIL_KEY = 'cv_email';
// Every CV the user has, so they follow them across devices. Versioned so a
// schema change can be handled deliberately: v2→v3 keyed entries by `jobId`;
// v3 keys them by their own `cvId` and adds `syncState`. Unlike the v1→v2 bump
// (where `skills` changed shape and the decision was to regenerate), this one
// migrates in place — `loadDir` mints a `cvId` for any v2 entry that lacks one,
// so nobody loses a tailored CV (and a regeneration costs a Bedrock call).
const DIR_STORAGE_KEY = 'cv_tailor_dir_v3';
const LEGACY_DIR_STORAGE_KEY = 'cv_tailor_dir_v2';

interface PersistedDir {
  cvs: TailoredCVEntry[];
  viewerCvId: string | null;
}

/** Coerce any persisted `skills` into the `{ name, level? }` shape — guards
 * against stale writes with string entries or out-of-range levels. */
function normalizeSkills(skills: unknown): SkillEntry[] {
  if (!Array.isArray(skills)) return [];
  return skills.map((s): SkillEntry => {
    if (typeof s === 'string') return { name: s };
    const entry = (s ?? {}) as { name?: unknown; level?: unknown };
    const name = typeof entry.name === 'string' ? entry.name : '';
    const level =
      typeof entry.level === 'number' &&
      Number.isFinite(entry.level) &&
      entry.level >= 1 &&
      entry.level <= 10
        ? Math.round(entry.level)
        : undefined;
    return level === undefined ? { name } : { name, level };
  });
}

/** Bring one persisted entry up to the current shape. `dirty` is set for
 * anything that had to be invented (a minted cvId) so hydrate pushes it up,
 * and for anything still marked unsynced from a previous session. */
function normalizeEntry(raw: unknown): TailoredCVEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<TailoredCVEntry> & { jobId?: string | null };

  const cv = entry.cv;
  if (!cv || typeof cv !== 'object') return null;

  const mintedId = !entry.cvId || typeof entry.cvId !== 'string';
  const wasSynced = entry.syncState === 'synced';

  return {
    cvId: mintedId ? uuid() : (entry.cvId as string),
    jobId: typeof entry.jobId === 'string' ? entry.jobId : null,
    meta: {
      companyName: entry.meta?.companyName ?? '',
      jobTitle: entry.meta?.jobTitle ?? '',
    },
    jobRef: {
      company_name: entry.jobRef?.company_name ?? '',
      job_title: entry.jobRef?.job_title ?? '',
      raw_description: entry.jobRef?.raw_description ?? '',
    },
    cv: { ...cv, skills: normalizeSkills(cv.skills) },
    generatedAt: entry.generatedAt ?? new Date(0).toISOString(),
    updatedAt: entry.updatedAt ?? entry.generatedAt ?? new Date(0).toISOString(),
    templateId: entry.templateId ?? DEFAULT_TEMPLATE_ID,
    // A minted cvId means the server has never seen this entry, so it has to
    // be pushed. So does anything the last session left unsynced.
    syncState: mintedId || !wasSynced ? 'dirty' : 'synced',
  };
}

function loadDir(): PersistedDir {
  for (const key of [DIR_STORAGE_KEY, LEGACY_DIR_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<PersistedDir> & {
        cvs?: unknown[];
        viewerJobId?: string | null;
      };
      const cvs = (parsed.cvs ?? [])
        .map(normalizeEntry)
        .filter((e): e is TailoredCVEntry => e !== null);

      // v2 stored `viewerJobId`; resolve it to a cvId via the job the entry
      // was tailored for, so a returning user lands on the CV they left open.
      const wantedJobId = parsed.viewerJobId ?? null;
      const viewerCvId =
        parsed.viewerCvId ??
        (wantedJobId ? cvs.find((c) => c.jobId === wantedJobId)?.cvId ?? null : null);

      return { cvs, viewerCvId };
    } catch {
      // fall through to the next key
    }
  }
  return { cvs: [], viewerCvId: null };
}

function persist({ cvs, viewerCvId }: PersistedDir) {
  try {
    localStorage.setItem(
      DIR_STORAGE_KEY,
      JSON.stringify({ cvs, viewerCvId }),
    );
  } catch {
    // private-mode / quota — in-memory state still works
  }
}

const initial = loadDir();

/** Map a backend row onto a store entry. */
function fromStoredCV(stored: StoredCV): TailoredCVEntry {
  return {
    cvId: stored.cv_id,
    jobId: stored.job_id ?? null,
    meta: {
      companyName: stored.meta?.companyName ?? '',
      jobTitle: stored.meta?.jobTitle ?? '',
    },
    jobRef: {
      company_name: stored.job_ref?.company_name ?? '',
      job_title: stored.job_ref?.job_title ?? '',
      raw_description: stored.job_ref?.raw_description ?? '',
    },
    cv: { ...stored.cv, skills: normalizeSkills(stored.cv?.skills) },
    generatedAt: stored.generated_at,
    updatedAt: stored.updated_at,
    templateId: stored.template_id ?? DEFAULT_TEMPLATE_ID,
    syncState: 'synced',
  };
}

/** The debounced pusher. Lives at module scope (not in the store) because it's
 * machinery, not state, and it needs to call back into the store without the
 * store needing a reference to it. */
const sync = new CVSync({
  save: async (cvId) => {
    const entry = useCVStore.getState().getCV(cvId);
    if (!entry) return;
    const result = await saveTailoredCV({
      cv_id: entry.cvId,
      job_id: entry.jobId,
      meta: entry.meta,
      job_ref: entry.jobRef,
      template_id: entry.templateId,
      generated_at: entry.generatedAt,
      cv: entry.cv,
    });
    // Only once the server has actually acknowledged it — this is what flips
    // the builder's status chip back to "Saved".
    useCVStore.setState((state) => {
      const cvs = state.cvs.map((c) =>
        c.cvId === cvId
          ? { ...c, updatedAt: result.updated_at, syncState: 'synced' as const }
          : c,
      );
      persist({ cvs, viewerCvId: state.viewerCvId });
      return { cvs };
    });
  },
  onStateChange: (cvIds) => {
    const { cvs } = useCVStore.getState();
    useCVStore.setState({
      cvs: cvs.map((c) =>
        cvIds.has(c.cvId) && c.syncState === 'dirty' ? { ...c, syncState: 'saving' } : c,
      ),
    });
  },
  onError: (cvId) => {
    const { cvs } = useCVStore.getState();
    useCVStore.setState({
      cvs: cvs.map((c) => (c.cvId === cvId ? { ...c, syncState: 'error' } : c)),
    });
  },
});

if (typeof document !== 'undefined') installVisibilityFlush(sync);

/** The viewer should show the CV that was last open, else the newest. */
function pickViewer(cvs: TailoredCVEntry[], preferredCvId: string | null) {
  const preferred = cvs.find((c) => c.cvId === preferredCvId) ?? cvs[0] ?? null;
  return {
    viewerCv: preferred?.cv ?? null,
    viewerMeta: preferred?.meta ?? null,
    viewerCvId: preferred?.cvId ?? null,
    viewerTemplateId: preferred?.templateId ?? DEFAULT_TEMPLATE_ID,
  };
}

export const useCVStore = create<AppStore>((set, get) => ({
  email: (typeof localStorage !== 'undefined' ? localStorage.getItem(EMAIL_KEY) : null) || '',
  ...pickViewer(initial.cvs, initial.viewerCvId),
  cvs: initial.cvs,
  hydrated: false,

  initFromSession: async () => {
    const { fetchUserAttributes } = await import('aws-amplify/auth');
    try {
      const attrs = await fetchUserAttributes();
      const email = (attrs.email || '').toLowerCase();
      localStorage.setItem(EMAIL_KEY, email);
      set({ email });
      await get().hydrate();
    } catch {
      // Not signed in — leave the store's email empty so existing
      // per-page "you need to sign in first" guards keep working. The local
      // directory stays as-is; it's flushed once a session exists.
      localStorage.removeItem(EMAIL_KEY);
      set({ email: '' });
    }
  },

  hydrate: async () => {
    // A re-login in the same page session reuses the same CVSync instance,
    // which logout() stopped — revive it before anything marks work dirty.
    sync.resume();

    let stored: StoredCV[] = [];
    try {
      stored = await listTailoredCVs();
    } catch (e) {
      // Offline or signed out. The local directory is still authoritative for
      // what's on screen, and anything dirty stays queued for the next flush.
      set({ hydrated: false });
      return;
    }

    const serverById = new Map(stored.map((s) => [s.cv_id, s]));
    const local = get().cvs;

    // Union by cvId. Local wins only while it's still dirty — that's what
    // keeps a crash between an edit and its debounced flush from being
    // reverted by the server copy.
    const merged: TailoredCVEntry[] = local.map((entry) => {
      const remote = serverById.get(entry.cvId);
      serverById.delete(entry.cvId);
      if (entry.syncState !== 'synced' || !remote) {
        return entry;
      }
      return fromStoredCV(remote);
    });
    for (const leftover of serverById.values()) {
      merged.push(fromStoredCV(leftover));
    }
    merged.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

    persist({ cvs: merged, viewerCvId: get().viewerCvId });
    set({ ...pickViewer(merged, get().viewerCvId), cvs: merged, hydrated: true });

    // Push everything the server hasn't acknowledged.
    for (const entry of merged) {
      if (entry.syncState === 'dirty' || entry.syncState === 'error') sync.markDirty(entry.cvId);
    }
  },

  logout: async () => {
    const { signOut } = await import('aws-amplify/auth');
    sync.stop();
    await signOut();
    // The CV directory is deliberately NOT cleared: it is now a write-through
    // cache of server state, and wiping it would only discard unsynced edits.
    localStorage.removeItem(EMAIL_KEY);
    set({ email: '', hydrated: false, ...pickViewer([], null), cvs: [] });
  },

  saveGeneratedCV: (profile, generated, jobId, jobRef) => {
    const existingTemplateId =
      get().cvs.find((c) => c.jobId === jobId)?.templateId ?? DEFAULT_TEMPLATE_ID;
    const cv = generatedCvToCVData(generated, profile);
    const entry: TailoredCVEntry = {
      cvId: uuid(),
      jobId,
      meta: { companyName: jobRef.company_name, jobTitle: jobRef.job_title },
      jobRef,
      cv,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      templateId: existingTemplateId,
      syncState: 'dirty',
    };
    const cvs = [entry, ...get().cvs];
    persist({ cvs, viewerCvId: entry.cvId });
    set({ cvs, ...pickViewer(cvs, entry.cvId) });
    // A regeneration is a discrete action, not a keystroke — push it now
    // rather than making the user wait out the debounce.
    sync.markDirty(entry.cvId);
    void sync.flushNow();
  },

  selectCV: (cvId) => {
    const entry = get().cvs.find((c) => c.cvId === cvId);
    if (!entry) return;
    persist({ cvs: get().cvs, viewerCvId: cvId });
    set({
      viewerCv: entry.cv,
      viewerMeta: entry.meta,
      viewerCvId: cvId,
      viewerTemplateId: entry.templateId,
    });
  },

  getCV: (cvId) => get().cvs.find((c) => c.cvId === cvId),

  getCVsForJob: (jobId) =>
    get()
      .cvs.filter((c) => c.jobId === jobId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),

  setTemplate: (cvId, templateId) => {
    const cvs = get().cvs.map((c) => (c.cvId === cvId ? { ...c, templateId, syncState: 'dirty' as const } : c));
    persist({ cvs, viewerCvId: get().viewerCvId });
    set({
      cvs,
      viewerTemplateId: cvId === get().viewerCvId ? templateId : get().viewerTemplateId,
    });
    sync.markDirty(cvId);
    void sync.flushNow();
  },

  deleteCV: async (cvId) => {
    const removed = get().cvs.find((c) => c.cvId === cvId);
    if (!removed) return;
    const wasViewing = get().viewerCvId === cvId;

    // Drop it locally first so the UI responds immediately, and stop the
    // autosave from resurrecting it on the next flush.
    sync.forget(cvId);
    const without = get().cvs.filter((c) => c.cvId !== cvId);
    persist({ cvs: without, viewerCvId: wasViewing ? null : get().viewerCvId });
    set({ cvs: without, ...(wasViewing ? pickViewer(without, null) : {}) });

    const { deleteTailoredCV } = await import('../api/backend');
    try {
      await deleteTailoredCV(cvId);
    } catch (e) {
      // Put it back. Leaving it only in localStorage would let the next
      // hydrate resurrect it from the server, which is more confusing than
      // the delete never having appeared to happen.
      const restored = [...get().cvs, removed].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      );
      persist({ cvs: restored, viewerCvId: wasViewing ? cvId : get().viewerCvId });
      set({ cvs: restored, ...(wasViewing ? pickViewer(restored, cvId) : {}) });
      throw e;
    }
  },

  updateCV: (cvId, updater, immediate = false) => {
    const target = get().cvs.find((c) => c.cvId === cvId);
    if (!target) return;
    const next: TailoredCVEntry = {
      ...target,
      cv: produce(target.cv, (draft) => updater(draft)),
      syncState: 'dirty',
    };
    const cvs = get().cvs.map((c) => (c.cvId === cvId ? next : c));
    persist({ cvs, viewerCvId: get().viewerCvId });
    set({
      cvs,
      ...(cvId === get().viewerCvId ? { viewerCv: next.cv } : {}),
    });
    sync.markDirty(cvId);
    if (immediate) void sync.flushNow();
  },
}));
