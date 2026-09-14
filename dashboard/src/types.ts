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

export interface JobRef {
  company_name: string;
  job_title: string;
  raw_description: string;
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