import { v4 as uuid } from 'uuid';
import { CVData, EntrySection, JobRef } from '../types';
import { GeneratedCV, StoredProfile } from '../api/backend';

/** Map the /tailor-generate response (+ an optional profile for name/skills)
 * onto the CVData shape that ModernTemplate renders. */
export function generatedCvToCVData(
  generated: GeneratedCV,
  profile?: StoredProfile | null,
): CVData {
  return {
    name: profile?.full_name ?? '',
    title: generated.title,
    email: profile?.email ?? '',
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
      coursework: e.description || undefined,
    })),
    skills: (profile?.skills ?? []).map((name) => ({ name })),
    accentColor: '#2c4a3e',
    // Derived for templates (e.g. EmbeddedTemplate) that want projects and
    // work/research experience as separate sections instead of one merged
    // list. tailoring-service merges matched_projects into `experience` with
    // company: "Not specified" (see PLAN.md's "matched projects were
    // silently dropped" note) — that's the only signal we have to split on,
    // so it's a heuristic, not a real distinction the backend makes.
    projects: generated.experience.filter((e) => e.company === 'Not specified').map(toEntrySection),
    research: generated.experience.filter((e) => e.company !== 'Not specified').map(toEntrySection),
  };
}

function toEntrySection(e: GeneratedCV['experience'][number]): EntrySection {
  return {
    id: uuid(),
    title: e.role,
    org: e.company === 'Not specified' ? undefined : e.company,
    period: e.period,
    bullets: e.description ? [e.description] : [],
  };
}

/** Snapshot the fields of a saved job so a cached CV can tell whether the job
 * has been edited since it was tailored. */
export function jobRefOf(job: {
  company_name: string;
  job_title: string;
  raw_description: string;
}): JobRef {
  return {
    company_name: job.company_name,
    job_title: job.job_title,
    raw_description: job.raw_description,
  };
}

export function isJobRefMatching(a: JobRef, b: JobRef): boolean {
  return (
    a.company_name === b.company_name &&
    a.job_title === b.job_title &&
    a.raw_description === b.raw_description
  );
}