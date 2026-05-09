import { CVData } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface CvListItem {
  cv_id: number;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface CvResponse {
  cv_id: number;
  email: string;
  name: string;
  cv_data: CVData;
  created_at: string;
  updated_at: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export async function fetchCvs(email: string): Promise<CvListItem[]> {
  const data = await request<{ cvs: CvListItem[] }>(`/cv/list?email=${encodeURIComponent(email)}`);
  return data.cvs;
}

export async function fetchCv(email: string, cvId: number): Promise<CvResponse> {
  return request<CvResponse>(`/cv?email=${encodeURIComponent(email)}&cv_id=${cvId}`);
}

export async function saveCv(
  email: string,
  name: string,
  cvData: CVData,
  cvId?: number,
): Promise<{ cv_id: number; message: string }> {
  return request<{ cv_id: number; message: string }>('/cv', {
    method: 'PUT',
    body: JSON.stringify({ email, name, cv_data: cvData, cv_id: cvId }),
  });
}

export async function deleteCv(email: string, cvId: number): Promise<{ message: string }> {
  return request<{ message: string }>(`/cv?email=${encodeURIComponent(email)}&cv_id=${cvId}`, {
    method: 'DELETE',
  });
}
