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
  skills: string[];
  accentColor: string;
}

export type TemplateId = 'modern' | 'classic' | 'minimal';

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}