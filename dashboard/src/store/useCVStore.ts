import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import { CVData } from '../types';
import { GeneratedCV, StoredProfile } from '../api/backend';

export interface ViewerMeta {
  companyName: string;
  jobTitle: string;
}

interface AppStore {
  email: string;
  viewerCv: CVData | null;
  viewerMeta: ViewerMeta | null;

  login: (email: string) => void;
  logout: () => void;
  loadGeneratedCV: (profile: StoredProfile, generated: GeneratedCV, meta: ViewerMeta) => void;
}

const storedEmail =
  (typeof localStorage !== 'undefined' ? localStorage.getItem('cv_email') : null) || '';

export const useCVStore = create<AppStore>((set) => ({
  email: storedEmail,
  viewerCv: null,
  viewerMeta: null,

  login: (email) => {
    localStorage.setItem('cv_email', email);
    set({ email });
  },

  logout: () => {
    localStorage.removeItem('cv_email');
    set({ email: '', viewerCv: null, viewerMeta: null });
  },

  loadGeneratedCV: (profile, generated, meta) => {
    set({
      viewerMeta: meta,
      viewerCv: {
        name: profile.full_name,
        title: generated.title,
        email: profile.email,
        phone: '',
        location: '',
        website: '',
        linkedin: '',
        summary: generated.summary,
        experience: generated.experience.map((e) => ({
          id: uuid(),
          company: e.company,
          role: e.role,
          period: e.period,
          description: e.description,
        })),
        education: generated.education.map((e) => ({
          id: uuid(),
          institution: e.institution,
          degree: e.degree,
          period: e.period,
        })),
        skills: profile.skills ?? [],
        accentColor: '#2c4a3e',
      },
    });
  },
}));