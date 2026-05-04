import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import { CVData, TemplateId, ExperienceEntry, EducationEntry } from '../types';

const DEFAULT_CV: CVData = {
  name: 'Alexandra Chen',
  title: 'Senior Product Designer',
  email: 'a.chen@email.com',
  phone: '+64 21 555 0123',
  location: 'Auckland, New Zealand',
  website: 'alexchen.design',
  linkedin: 'linkedin.com/in/alexchen',
  summary:
    'Product designer with 8 years of experience crafting intuitive digital experiences for global audiences. Passionate about systems thinking and accessible design.',
  experience: [
    {
      id: uuid(),
      company: 'Canva',
      role: 'Senior Product Designer',
      period: '2021 – Present',
      description:
        'Led design system overhaul serving 40M+ users. Collaborated with cross-functional teams to ship 12 major features. Mentored 3 junior designers.',
    },
    {
      id: uuid(),
      company: 'Xero',
      role: 'UX Designer',
      period: '2018 – 2021',
      description:
        'Redesigned the invoicing flow, reducing task completion time by 34%. Conducted 80+ user interviews and established a monthly research cadence.',
    },
  ],
  education: [
    {
      id: uuid(),
      institution: 'University of Auckland',
      degree: 'Bachelor of Design (Hons)',
      period: '2014 – 2018',
    },
  ],
  skills: ['Figma', 'Prototyping', 'User Research', 'Design Systems', 'Accessibility', 'React'],
  accentColor: '#2c4a3e',
};

interface CVStore {
  cv: CVData;
  template: TemplateId;
  notes: string;
  zoom: number;
  past: CVData[];
  future: CVData[];

  // CV field actions
  updateField: <K extends keyof CVData>(field: K, value: CVData[K]) => void;

  // Experience
  addExperience: () => void;
  updateExperience: (id: string, field: keyof ExperienceEntry, value: string) => void;
  removeExperience: (id: string) => void;
  moveExperience: (id: string, direction: 'up' | 'down') => void;

  // Education
  addEducation: () => void;
  updateEducation: (id: string, field: keyof EducationEntry, value: string) => void;
  removeEducation: (id: string) => void;

  // Skills
  addSkill: (skill: string) => void;
  removeSkill: (skill: string) => void;

  // App state
  setTemplate: (id: TemplateId) => void;
  setNotes: (notes: string) => void;
  setZoom: (zoom: number) => void;

  // Undo / redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const HISTORY_LIMIT = 50;

const cloneCv = (cv: CVData): CVData => {
  return JSON.parse(JSON.stringify(cv)) as CVData;
};

export const useCVStore = create<CVStore>()(
  immer((set, get) => ({
    cv: DEFAULT_CV,
    template: 'modern',
    notes: '• Follow up with recruiter by Friday\n• Tailor summary for tech roles\n• Add portfolio link once live',
    zoom: 0.72,
    past: [],
    future: [],

    updateField: (field, value) => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        (state.cv as Record<string, unknown>)[field as string] = value;
      });
    },

    addExperience: () => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        state.cv.experience.push({ id: uuid(), company: '', role: '', period: '', description: '' });
      });
    },

    updateExperience: (id, field, value) => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        const entry = state.cv.experience.find((e) => e.id === id);
        if (entry) entry[field] = value;
      });
    },

    removeExperience: (id) => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        state.cv.experience = state.cv.experience.filter((e) => e.id !== id);
      });
    },

    moveExperience: (id, direction) => {
      set((state) => {
        const arr = state.cv.experience;
        const idx = arr.findIndex((e) => e.id === id);
        if (direction === 'up' && idx > 0) {
          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        } else if (direction === 'down' && idx < arr.length - 1) {
          [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        }
      });
    },

    addEducation: () => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        state.cv.education.push({ id: uuid(), institution: '', degree: '', period: '' });
      });
    },

    updateEducation: (id, field, value) => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        const entry = state.cv.education.find((e) => e.id === id);
        if (entry) entry[field] = value;
      });
    },

    removeEducation: (id) => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        state.cv.education = state.cv.education.filter((e) => e.id !== id);
      });
    },

    addSkill: (skill) => {
      set((state) => {
        if (!state.cv.skills.includes(skill)) {
          state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
          state.future = [];
          state.cv.skills.push(skill);
        }
      });
    },

    removeSkill: (skill) => {
      set((state) => {
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.future = [];
        state.cv.skills = state.cv.skills.filter((s) => s !== skill);
      });
    },

    setTemplate: (id) => set((state) => { state.template = id; }),
    setNotes: (notes) => set((state) => { state.notes = notes; }),
    setZoom: (zoom) => set((state) => { state.zoom = zoom; }),

    undo: () => {
      set((state) => {
        if (state.past.length === 0) return;
        const prev = state.past[state.past.length - 1];
        state.future = [cloneCv(state.cv), ...state.future.slice(0, HISTORY_LIMIT)];
        state.cv = prev;
        state.past = state.past.slice(0, -1);
      });
    },

    redo: () => {
      set((state) => {
        if (state.future.length === 0) return;
        const next = state.future[0];
        state.past = [...state.past.slice(-HISTORY_LIMIT), cloneCv(state.cv)];
        state.cv = next;
        state.future = state.future.slice(1);
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  }))
);