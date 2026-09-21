import { create } from 'zustand';
import { CVData, JobRef } from '../types';
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
}

const EMAIL_KEY = 'cv_email';
// One cached CV per saved job, so re-tailoring an unedited job opens the
// existing result instead of regenerating it. Versioned so a schema change
// can invalidate old persisted data cleanly.
const DIR_STORAGE_KEY = 'cv_tailor_dir_v1';
const OLD_VIEWER_STORAGE_KEY = 'cv_tailor_viewer_v1';

interface PersistedDir {
  cvs: TailoredCVEntry[];
  viewerJobId: string | null;
}

function loadDir(): PersistedDir {
  try {
    const raw = localStorage.getItem(DIR_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedDir;
      // Entries persisted before templateId existed don't have one — default them.
      return { ...parsed, cvs: parsed.cvs.map((c) => ({ ...c, templateId: c.templateId ?? DEFAULT_TEMPLATE_ID })) };
    }
  } catch {
    // fall through to migration below
  }
  // One-time migration from the old single-viewer format.
  try {
    const raw = localStorage.getItem(OLD_VIEWER_STORAGE_KEY);
    if (raw) {
      const old = JSON.parse(raw);
      if (old?.viewerCv && old?.viewerMeta) {
        const migrated: PersistedDir = {
          cvs: [
            {
              jobId: '',
              meta: old.viewerMeta,
              jobRef: { company_name: '', job_title: '', raw_description: '' },
              cv: old.viewerCv,
              generatedAt: '',
              templateId: DEFAULT_TEMPLATE_ID,
            },
          ],
          viewerJobId: '',
        };
        try {
          localStorage.setItem(DIR_STORAGE_KEY, JSON.stringify(migrated));
        } catch {
          // ignore — in-memory state still works
        }
        return migrated;
      }
    }
  } catch {
    // ignore
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
    localStorage.removeItem(OLD_VIEWER_STORAGE_KEY);
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
}));