export interface ExperienceEntry {
  id: string;
  company: string;
  role: string;
  period: string;
  description: string;
}

export interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  period: string;
  // No current generator populates this — see EmbeddedTemplate.tsx's guidance
  // comment for what would need to change to fill it in.
  coursework?: string;
}

export interface JobRef {
  company_name: string;
  job_title: string;
  raw_description: string;
}

/** A titled block with bullet points — e.g. one project or one research
 * entry in EmbeddedTemplate.tsx. Shared here so any template can use the
 * same shape rather than each declaring its own. */
export interface EntrySection {
  id: string;
  title: string;
  org?: string;
  period?: string;
  bullets: string[];
}

/** A skill on the CV. `name` is the editable label; `level` is an optional
 * 1–10 proficiency (the Modern template draws its progress bar from it — when
 * unset the bar is hidden entirely). */
export interface SkillEntry {
  name: string;
  level?: number;
}

export interface CVData {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  summary: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: SkillEntry[];
  accentColor: string;
  // Optional, template-specific sections — only EmbeddedTemplate.tsx reads
  // these today. `projects`/`research` are derived from `experience` in
  // generatedCvToCVData (utils/cv.ts); `additional`/`referencesNote` have no
  // generator yet and will always be empty/undefined until one exists.
  projects?: EntrySection[];
  research?: EntrySection[];
  additional?: string[];
  referencesNote?: string;
}