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
  description: string;
}

export interface ProjectEntry {
  name: string;
  description: string;
}

export interface Profile {
  full_name: string;
  skills: string[];
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
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
