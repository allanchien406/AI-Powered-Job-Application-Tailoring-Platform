// Client for the deployed backend (profile-service, intake-service, and later
// job-service / tailoring-service). Replaces the old cvApi.ts, which talked to
// the removed cv-service.
//
// The default URL is the current staged deployment; override with VITE_API_URL.
const API_URL =
  import.meta.env.VITE_API_URL || 'https://qmpqjnqmn8.execute-api.us-east-1.amazonaws.com';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  period: string;
  description: string;
}

export interface ProjectEntry {
  name: string;
  period: string;
  description: string;
}

export interface EducationEntry {
  institution: string;
  degree: string;
  period: string;
  description: string;
}

export interface Profile {
  full_name: string;
  skills: string[];
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
}

export interface StoredProfile extends Profile {
  email: string;
  created_at: string;
  updated_at: string;
  embedding_warnings?: string[];
}

/** Free-form text -> the Profile shape. Does not save anything. */
export async function parseProfileText(rawText: string): Promise<Profile> {
  const data = await request<{ message: string; profile: Profile }>('/profile/parse', {
    method: 'POST',
    body: JSON.stringify({ raw_text: rawText }),
  });
  return data.profile;
}

/** Fetch a saved profile. Throws on 404. */
export async function getProfile(email: string): Promise<StoredProfile> {
  return request<StoredProfile>(`/profile?email=${encodeURIComponent(email)}`);
}

/** Create or fully replace a profile. */
export async function saveProfile(
  email: string,
  profile: Profile,
): Promise<StoredProfile> {
  return request<StoredProfile>('/profile', {
    method: 'PUT',
    body: JSON.stringify({ email, ...profile }),
  });
}

export interface JobDescriptionInput {
  company_name: string;
  job_title: string;
  raw_description: string;
}

export interface StoredJobDescription extends JobDescriptionInput {
  email: string;
  job_id: string;
  created_at: string;
}

/** Save a new job description. Always creates a new item — there's no
 * update-in-place or dedup, so re-saving the same posting makes a second copy. */
export async function saveJobDescription(
  email: string,
  job: JobDescriptionInput,
): Promise<StoredJobDescription> {
  const data = await request<{ message: string; job_id: string; email: string; company_name: string; job_title: string }>(
    '/job-description',
    {
      method: 'PUT',
      body: JSON.stringify({ email, ...job }),
    },
  );
  return { ...job, email: data.email, job_id: data.job_id, created_at: new Date().toISOString() };
}

/** List every job description a user has saved, most recent first. */
export async function listJobDescriptions(email: string): Promise<StoredJobDescription[]> {
  const data = await request<{ job_descriptions: StoredJobDescription[] }>(
    `/job-description/list?email=${encodeURIComponent(email)}`,
  );
  return data.job_descriptions;
}

export interface MatchedEntry {
  score: number;
  description: string;
  period?: string;
  [key: string]: unknown;
}

export interface PromptContext {
  candidate: { full_name: string; email: string };
  target_role: { company_name: string; job_title: string };
  raw_job_description: string;
  matched_projects: MatchedEntry[];
  matched_experiences: MatchedEntry[];
  education: Array<{ institution: string; degree: string; period: string; description?: string }>;
}

export interface GeneratedCV {
  title: string;
  summary: string;
  experience: Array<{ company: string; role: string; period: string; description: string }>;
  education: Array<{ institution: string; degree: string; period: string }>;
}

/** Run the full matching + Bedrock generation pipeline against a saved job. */
export async function generateTailoredCV(
  email: string,
  jobId: string,
): Promise<{ prompt_context: PromptContext; generated_cv: GeneratedCV }> {
  return request('/tailor-generate', {
    method: 'POST',
    body: JSON.stringify({ email, job_id: jobId }),
  });
}
