import { create } from 'zustand';
import { produce, Draft } from 'immer';
import { CVData, JobRef, SkillEntry } from '../types';
import { GeneratedCV, StoredProfile } from '../api/backend';
import { generatedCvToCVData } from '../utils/cv';
import { DEFAULT_TEMPLATE_ID } from '../components/templates';

export interface ViewerMeta {
  companyName: string;
  jobTitle: string;
}

export interface TailoredCVEntry {
  jobId: string;
  meta: ViewerMeta;
  jobRef: JobRef;
  cv: CVData;
  generatedAt: string;
  templateId: string;
}

interface AppStore {
  email: string;
  cvs: TailoredCVEntry[];
  viewerCv: CVData | null;
  viewerMeta: ViewerMeta | null;
  viewerJobId: string | null;
  viewerTemplateId: string;

  initFromSession: () => Promise<void>;
  logout: () => Promise<void>;
  saveGeneratedCV: (profile: StoredProfile | null, generated: GeneratedCV, jobId: string, jobRef: JobRef) => void;
  selectCV: (jobId: string) => void;
  getCVForJob: (jobId: string) => TailoredCVEntry | undefined;
  setTemplate: (jobId: string, templateId: string) => void;
  /** Apply an in-place edit to a stored CV. Callers mutate the `draft` (see
   * `setFieldByPath` in utils/cvEdits.ts) and the result is persisted + made
   * the active viewer CV if that job is open. */
  updateCV: (jobId: string, updater: (draft: Draft<CVData>) => void) => void;
}

const EMAIL_KEY = 'cv_email';
// One cached CV per saved job, so re-tailoring an unedited job opens the
// existing result instead of regenerating it. Versioned so a schema change
// can invalidate old persisted data cleanly. v1→v2: `skills` became
// `{ name, level? }` — the decision was to regenerate rather than migrate,
// so v1 data is intentionally discarded.
const DIR_STORAGE_KEY = 'cv_tailor_dir_v2';

interface PersistedDir {
  cvs: TailoredCVEntry[];
  viewerJobId: string | null;
}

/** Coerce any persisted `skills` into the `{ name, level? }` shape — guards
 * against stale v2 writes with string entries or out-of-range levels. */
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

function loadDir(): PersistedDir {
  try {
    const raw = localStorage.getItem(DIR_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedDir;
      // Entries persisted before templateId existed don't have one — default them.
      return {
        ...parsed,
        cvs: parsed.cvs.map((c) => ({
          ...c,
          templateId: c.templateId ?? DEFAULT_TEMPLATE_ID,
          cv: { ...c.cv, skills: normalizeSkills(c.cv.skills) },
        })),
      };
    }
  } catch {
    // fall through to a fresh directory
  }
  return { cvs: [], viewerJobId: null };
}

function persist({ cvs, viewerJobId }: PersistedDir) {
  try {
    localStorage.setItem(DIR_STORAGE_KEY, JSON.stringify({ cvs, viewerJobId }));
  } catch {
    // private-mode / quota — in-memory state still works
  }
}

const initial = loadDir();

export const useCVStore = create<AppStore>((set, get) => ({
  email: (typeof localStorage !== 'undefined' ? localStorage.getItem(EMAIL_KEY) : null) || '',
  cvs: initial.cvs,
  viewerCv: initial.cvs.find((c) => c.jobId === initial.viewerJobId)?.cv ?? initial.cvs[0]?.cv ?? null,
  viewerMeta: initial.cvs.find((c) => c.jobId === initial.viewerJobId)?.meta ?? initial.cvs[0]?.meta ?? null,
  viewerJobId: initial.cvs.find((c) => c.jobId === initial.viewerJobId)?.jobId ?? initial.cvs[0]?.jobId ?? null,
  viewerTemplateId:
    initial.cvs.find((c) => c.jobId === initial.viewerJobId)?.templateId ??
    initial.cvs[0]?.templateId ??
    DEFAULT_TEMPLATE_ID,

  initFromSession: async () => {
    const { fetchUserAttributes } = await import('aws-amplify/auth');
    try {
      const attrs = await fetchUserAttributes();
      const email = (attrs.email || '').toLowerCase();
      localStorage.setItem(EMAIL_KEY, email);
      set({ email });
    } catch {
      // Not signed in — leave the store's email empty so existing
      // per-page "you need to sign in first" guards keep working.
      localStorage.removeItem(EMAIL_KEY);
      set({ email: '' });
    }
  },

  logout: async () => {
    const { signOut } = await import('aws-amplify/auth');
    await signOut();
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(DIR_STORAGE_KEY);
    set({ email: '', cvs: [], viewerCv: null, viewerMeta: null, viewerJobId: null, viewerTemplateId: DEFAULT_TEMPLATE_ID });
  },

  saveGeneratedCV: (profile, generated, jobId, jobRef) => {
    const cv = generatedCvToCVData(generated, profile);
    // Regenerating an existing job keeps its previously chosen template
    // rather than resetting to the default.
    const existingTemplateId = get().cvs.find((c) => c.jobId === jobId)?.templateId ?? DEFAULT_TEMPLATE_ID;
    const entry: TailoredCVEntry = {
      jobId,
      meta: { companyName: jobRef.company_name, jobTitle: jobRef.job_title },
      jobRef,
      cv,
      generatedAt: new Date().toISOString(),
      templateId: existingTemplateId,
    };
    const cvs = get().cvs.some((c) => c.jobId === jobId)
      ? get().cvs.map((c) => (c.jobId === jobId ? entry : c))
      : [...get().cvs, entry];
    persist({ cvs, viewerJobId: jobId });
    set({ cvs, viewerCv: entry.cv, viewerMeta: entry.meta, viewerJobId: jobId, viewerTemplateId: entry.templateId });
  },

  selectCV: (jobId) => {
    const entry = get().cvs.find((c) => c.jobId === jobId);
    if (!entry) return;
    persist({ cvs: get().cvs, viewerJobId: jobId });
    set({ viewerCv: entry.cv, viewerMeta: entry.meta, viewerJobId: jobId, viewerTemplateId: entry.templateId });
  },

  getCVForJob: (jobId) => get().cvs.find((c) => c.jobId === jobId),

  setTemplate: (jobId, templateId) => {
    const cvs = get().cvs.map((c) => (c.jobId === jobId ? { ...c, templateId } : c));
    persist({ cvs, viewerJobId: get().viewerJobId });
    set({
      cvs,
      viewerTemplateId: jobId === get().viewerJobId ? templateId : get().viewerTemplateId,
    });
  },

  updateCV: (jobId, updater) => {
    const cvs = get().cvs.map((c) => {
      if (c.jobId !== jobId) return c;
      return { ...c, cv: produce(c.cv, (draft) => updater(draft)) };
    });
    const matched = cvs.find((c) => c.jobId === jobId)?.cv ?? get().viewerCv;
    const viewerCv = jobId === get().viewerJobId ? matched : get().viewerCv;
    persist({ cvs, viewerJobId: get().viewerJobId });
    set({ cvs, viewerCv });
  },
}));