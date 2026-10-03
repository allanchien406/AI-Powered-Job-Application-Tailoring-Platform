import { fetchAuthSession } from 'aws-amplify/auth';
import type { CVData, JobRef } from '../types';

// Client for the deployed backend (profile-service, intake-service, and later
// job-service / tailoring-service). Replaces the old cvApi.ts, which talked to
// the removed cv-service.
//
// The default URL is the current staged deployment; override with VITE_API_URL.
const API_URL =
  import.meta.env.VITE_API_URL || 'https://qmpqjnqmn8.execute-api.us-east-1.amazonaws.com';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export interface ExperienceEntry {
  id?: string;
  title: string;
  company: string;
  period: string;
  description: string;
}

export interface ProjectEntry {
  id?: string;
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

/** Fetch the signed-in user's saved profile. Throws on 404. */
export async function getProfile(): Promise<StoredProfile> {
  return request<StoredProfile>('/profile');
}

/** Create or fully replace the signed-in user's profile. `email` is stored
 * as a normal display attribute now — it plays no role in identifying whose
 * profile this is; the backend derives that from the caller's JWT. */
export async function saveProfile(profile: Profile & { email: string }): Promise<StoredProfile> {
  return request<StoredProfile>('/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
}

export interface JobDescriptionInput {
  company_name: string;
  job_title: string;
  raw_description: string;
}

export interface StoredJobDescription extends JobDescriptionInput {
  job_id: string;
  created_at: string;
}

/** Save a new job description. Always creates a new item — there's no
 * update-in-place or dedup, so re-saving the same posting makes a second copy. */
export async function saveJobDescription(job: JobDescriptionInput): Promise<StoredJobDescription> {
  const data = await request<{ message: string; job_id: string; company_name: string; job_title: string }>(
    '/job-description',
    {
      method: 'PUT',
      body: JSON.stringify(job),
    },
  );
  return { ...job, job_id: data.job_id, created_at: new Date().toISOString() };
}

/** Update an existing job description in place. `job_id` is preserved, so any
 * previously tailored result still points at the same job. */
export async function updateJobDescription(
  jobId: string,
  job: JobDescriptionInput,
): Promise<StoredJobDescription> {
  const data = await request<{ message: string; job_id: string; company_name: string; job_title: string }>(
    '/job-description',
    {
      method: 'PUT',
      body: JSON.stringify({ job_id: jobId, ...job }),
    },
  );
  return { ...job, job_id: data.job_id, created_at: new Date().toISOString() };
}

/** List every job description the signed-in user has saved, most recent first. */
export async function listJobDescriptions(): Promise<StoredJobDescription[]> {
  const data = await request<{ job_descriptions: StoredJobDescription[] }>('/job-description/list');
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
  education: Array<{ institution: string; degree: string; period: string; description: string }>;
}

export interface PreviewMatch {
  score: number;
  matched_terms: string[];
  name?: string;
  title?: string;
  company?: string;
  period?: string;
  description: string;
}

export interface TailorPreviewResult {
  message: string;
  email: string;
  job_id: string;
  extracted_requirements: string[];
  matched_projects: PreviewMatch[];
  matched_experiences: PreviewMatch[];
}

/** Free keyword-only matching preview — unlike /tailor-generate this makes no
 * Bedrock calls, so it's safe to run often (e.g. as the user edits). */
export async function tailorPreview(jobId: string): Promise<TailorPreviewResult> {
  return request('/tailor-preview', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  });
}

/** Run the full matching + Bedrock generation pipeline against a saved job. */
export async function generateTailoredCV(
  jobId: string,
): Promise<{ prompt_context: PromptContext; generated_cv: GeneratedCV }> {
  return request('/tailor-generate', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  });
}

// --- Tailored CV persistence -------------------------------------------------
// A tailored CV is identified by its own `cv_id`, not by the job it was
// tailored for: a user can hold several versions for the same posting. `job_id`
// is attribution only. See
// docs/superpowers/specs/2026-09-27-cv-persistence-design.md.

/** Display labels for the job a CV was tailored for. The dashboard shows these
 * in the CV list, so they are stored rather than joined from the job. */
export interface CVMeta {
  companyName: string;
  jobTitle: string;
}

export interface StoredCV {
  cv_id: string;
  job_id: string | null;
  meta: CVMeta;
  job_ref: JobRef;
  template_id: string;
  generated_at: string;
  updated_at: string;
  created_at: string;
  cv: CVData;
}

/** The subset the dashboard sends back on save. The server stamps
 * `created_at`/`updated_at` itself — a client clock must not decide them. */
export interface CVSaveInput {
  cv_id?: string;
  job_id: string | null;
  meta: CVMeta;
  job_ref: JobRef;
  template_id: string;
  generated_at: string;
  cv: CVData;
}

export interface CVSaveResult {
  message: string;
  cv_id: string;
  job_id: string | null;
  generated_at: string;
  updated_at: string;
  /** Present only if the server clipped something, e.g. an oversized
   * `job_ref.raw_description`. The save still succeeded. */
  warnings?: string[];
}

/** Create or replace one tailored CV. Omit `cv_id` to create a new one;
 * include it to update in place (which preserves the server's `created_at`). */
export async function saveTailoredCV(input: CVSaveInput): Promise<CVSaveResult> {
  return request<CVSaveResult>('/cv', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** Fetch one tailored CV by id. Throws on 404. */
export async function getTailoredCV(cvId: string): Promise<StoredCV> {
  return request<StoredCV>(`/cv?cv_id=${encodeURIComponent(cvId)}`);
}

/** Every tailored CV the signed-in user has, most recently generated first.
 * Returns full documents (not metadata) so the builder can hydrate in one
 * round trip. */
export async function listTailoredCVs(): Promise<StoredCV[]> {
  const data = await request<{ cvs: StoredCV[] }>('/cv/list');
  return data.cvs;
}

/** Delete a tailored CV. Idempotent server-side — deleting one that is already
 * gone resolves rather than throwing, so a double-click is harmless. */
export async function deleteTailoredCV(cvId: string): Promise<void> {
  await request(`/cv?cv_id=${encodeURIComponent(cvId)}`, { method: 'DELETE' });
}
