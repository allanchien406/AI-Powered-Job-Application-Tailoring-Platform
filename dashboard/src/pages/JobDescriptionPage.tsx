import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Shell } from '../components/Shell';
import { CVPreview } from '../components/CVPreview';
import { Button, Card, Field, Input, Notice, PanelCard, SectionTitle, TextArea } from '../components/ui';
import {
  saveJobDescription,
  updateJobDescription,
  listJobDescriptions,
  generateTailoredCV,
  tailorPreview,
  getProfile,
  StoredJobDescription,
  JobDescriptionInput,
  GeneratedCV,
  StoredProfile,
  TailorPreviewResult,
} from '../api/backend';
import { generatedCvToCVData, isJobRefMatching, jobRefOf } from '../utils/cv';

type ListState = 'loading' | 'loaded' | 'error';
type SaveState = 'idle' | 'saving' | 'error';
type GenerateState = { jobId: string; status: 'generating' } | { jobId: string; status: 'error'; message: string } | null;
type PreviewState = {
  jobId: string;
  status: 'loading' | 'loaded' | 'error';
  result?: TailorPreviewResult;
  message?: string;
} | null;

export const JobDescriptionPage: React.FC = () => {
  const navigate = useNavigate();
  const email = useCVStore((state) => state.email);
  const getCVForJob = useCVStore((state) => state.getCVForJob);
  const saveGeneratedCV = useCVStore((state) => state.saveGeneratedCV);
  const selectCV = useCVStore((state) => state.selectCV);

  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [jobs, setJobs] = useState<StoredJobDescription[]>([]);
  const [listState, setListState] = useState<ListState>('loading');

  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [rawDescription, setRawDescription] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [generateState, setGenerateState] = useState<GenerateState>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const [result, setResult] = useState<{
    jobId: string;
    generatedCv: GeneratedCV;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<JobDescriptionInput>({
    company_name: '',
    job_title: '',
    raw_description: '',
  });
  const [editState, setEditState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    listJobDescriptions()
      .then((data) => {
        setJobs(data);
        setListState('loaded');
      })
      .catch(() => setListState('error'));

    // Cache the saved profile so the generated-CV preview can carry the real
    // name + skills and "Open in editor" doesn't need an extra fetch.
    getProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [email]);

  if (!email) {
    return (
      <Shell>
        <PanelCard>
          <div className="mb-2.5 text-[13px]">You need to sign in first.</div>
          <Button onClick={() => navigate('/')}>Go to sign in</Button>
        </PanelCard>
      </Shell>
    );
  }

  const handleSave = async () => {
    if (!companyName.trim() || !jobTitle.trim() || !rawDescription.trim()) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const saved = await saveJobDescription({
        company_name: companyName.trim(),
        job_title: jobTitle.trim(),
        raw_description: rawDescription.trim(),
      });
      setJobs((prev) => [saved, ...prev]);
      setCompanyName('');
      setJobTitle('');
      setRawDescription('');
      setSaveState('idle');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Something went wrong saving this job.');
      setSaveState('error');
    }
  };

  const startEdit = (job: StoredJobDescription) => {
    setEditForm({
      company_name: job.company_name,
      job_title: job.job_title,
      raw_description: job.raw_description,
    });
    setEditError(null);
    setEditState('idle');
    setEditingId(job.job_id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (job: StoredJobDescription) => {
    if (!editForm.company_name.trim() || !editForm.job_title.trim() || !editForm.raw_description.trim()) return;
    setEditState('saving');
    setEditError(null);
    try {
      const updated = await updateJobDescription(job.job_id, {
        company_name: editForm.company_name.trim(),
        job_title: editForm.job_title.trim(),
        raw_description: editForm.raw_description.trim(),
      });
      // job_id is preserved, so keep the original created_at to hold its place
      // in the most-recent-first list rather than jumping to the top.
      setJobs((prev) => prev.map((j) => (j.job_id === job.job_id ? { ...updated, created_at: j.created_at } : j)));
      if (result && result.jobId === job.job_id) setResult(null);
      if (previewState && previewState.jobId === job.job_id) setPreviewState(null);
      setEditState('idle');
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Something went wrong saving your changes.');
      setEditState('error');
    }
  };

  const handleGenerate = async (job: StoredJobDescription, force = false) => {
    // A cached CV is only a true match if the job is unchanged since it was
    // tailored — otherwise the cached result would be stale and we regenerate.
    // `force` skips this short-circuit entirely, for an explicit Regenerate click.
    const cached = getCVForJob(job.job_id);
    if (!force && cached && isJobRefMatching(cached.jobRef, jobRefOf(job))) {
      selectCV(job.job_id);
      navigate('/builder');
      return;
    }
    setResult(null);
    setGenerateState({ jobId: job.job_id, status: 'generating' });
    try {
      const data = await generateTailoredCV(job.job_id);
      const savedProfile = profile ?? (await getProfile().catch(() => null));
      saveGeneratedCV(savedProfile, data.generated_cv, job.job_id, jobRefOf(job));
      setResult({ jobId: job.job_id, generatedCv: data.generated_cv });
      setGenerateState(null);
    } catch (e) {
      setGenerateState({
        jobId: job.job_id,
        status: 'error',
        message: e instanceof Error ? e.message : 'Something went wrong generating a tailored CV.',
      });
    }
  };

  const handlePreview = async (job: StoredJobDescription) => {
    setPreviewState({ jobId: job.job_id, status: 'loading' });
    try {
      const preview = await tailorPreview(job.job_id);
      setPreviewState({ jobId: job.job_id, status: 'loaded', result: preview });
    } catch (e) {
      setPreviewState({
        jobId: job.job_id,
        status: 'error',
        message: e instanceof Error ? e.message : 'Something went wrong previewing matches.',
      });
    }
  };

  const handleOpenInEditor = (job: StoredJobDescription) => {
    selectCV(job.job_id);
    navigate('/builder');
  };

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="m-0 font-display text-[28px] text-ink">Job descriptions</h1>
        <p className="mt-1.5 text-xs leading-normal text-ink-soft">
          Paste a job posting, save it, then generate a CV tailored to it from your profile.
        </p>
      </div>

      <PanelCard>
        <SectionTitle>Add a job posting</SectionTitle>
        {saveError && <Notice tone="error">{saveError}</Notice>}
        <div className="flex gap-2">
          <Field label="Company" className="flex-1">
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Vertex Analytics" />
          </Field>
          <Field label="Job title" className="flex-1">
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Backend Software Engineer" />
          </Field>
        </div>
        <Field label="Job description">
          <TextArea
            rows={8}
            value={rawDescription}
            onChange={(e) => setRawDescription(e.target.value)}
            placeholder="Paste the full job posting text here."
          />
        </Field>
        <Button
          onClick={handleSave}
          disabled={saveState === 'saving' || !companyName.trim() || !jobTitle.trim() || !rawDescription.trim()}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save job'}
        </Button>
      </PanelCard>

      <PanelCard>
        <SectionTitle>Saved jobs</SectionTitle>
        {listState === 'loading' && <div className="text-xs text-ink-muted">Loading…</div>}
        {listState === 'error' && <Notice tone="error">Couldn't load your saved jobs.</Notice>}
        {listState === 'loaded' && jobs.length === 0 && (
          <div className="text-xs text-ink-muted">No jobs saved yet — add one above.</div>
        )}
        {jobs.map((job) => {
          const cachedCv = getCVForJob(job.job_id);
          const canViewCached = !!cachedCv && isJobRefMatching(cachedCv.jobRef, jobRefOf(job));
          return (
          <Card key={job.job_id}>
            {editingId === job.job_id ? (
              <div>
                {editError && <Notice tone="error">{editError}</Notice>}
                <div className="flex gap-2">
                  <Field label="Company" className="flex-1">
                    <Input
                      value={editForm.company_name}
                      onChange={(e) => setEditForm((f) => ({ ...f, company_name: e.target.value }))}
                      placeholder="e.g. Vertex Analytics"
                    />
                  </Field>
                  <Field label="Job title" className="flex-1">
                    <Input
                      value={editForm.job_title}
                      onChange={(e) => setEditForm((f) => ({ ...f, job_title: e.target.value }))}
                      placeholder="e.g. Backend Software Engineer"
                    />
                  </Field>
                </div>
                <Field label="Job description">
                  <TextArea
                    rows={6}
                    value={editForm.raw_description}
                    onChange={(e) => setEditForm((f) => ({ ...f, raw_description: e.target.value }))}
                    placeholder="Paste the full job posting text here."
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleSaveEdit(job)}
                    disabled={
                      editState === 'saving' ||
                      !editForm.company_name.trim() ||
                      !editForm.job_title.trim() ||
                      !editForm.raw_description.trim()
                    }
                  >
                    {editState === 'saving' ? 'Saving…' : 'Save changes'}
                  </Button>
                  <Button variant="ghost" onClick={cancelEdit} disabled={editState === 'saving'}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2.5">
                <div>
                  <div className="text-[13px] font-medium">{job.job_title}</div>
                  <div className="text-xs text-ink-soft">{job.company_name}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => startEdit(job)} className="whitespace-nowrap">
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handlePreview(job)}
                    disabled={previewState?.jobId === job.job_id && previewState.status === 'loading'}
                    className="whitespace-nowrap"
                  >
                    {previewState?.jobId === job.job_id && previewState.status === 'loading'
                      ? 'Matching…'
                      : 'Preview matches'}
                  </Button>
                  <Button
                    onClick={() => handleGenerate(job)}
                    disabled={generateState?.jobId === job.job_id && generateState.status === 'generating'}
                    className="whitespace-nowrap"
                  >
                    {generateState?.jobId === job.job_id && generateState.status === 'generating'
                      ? 'Tailoring…'
                      : canViewCached
                        ? 'View tailored CV'
                        : 'Tailor CV'}
                  </Button>
                  {canViewCached && (
                    <Button
                      variant="ghost"
                      onClick={() => handleGenerate(job, true)}
                      disabled={generateState?.jobId === job.job_id && generateState.status === 'generating'}
                      className="whitespace-nowrap"
                    >
                      {generateState?.jobId === job.job_id && generateState.status === 'generating'
                        ? 'Regenerating…'
                        : 'Regenerate'}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {previewState?.jobId === job.job_id && previewState.status === 'error' && (
              <Notice tone="error">{previewState.message}</Notice>
            )}
            {previewState?.jobId === job.job_id && previewState.result && (
              <PreviewResult result={previewState.result} />
            )}
            {generateState?.jobId === job.job_id && generateState.status === 'error' && (
              <Notice tone="error">{generateState.message}</Notice>
            )}
            {result && result.jobId === job.job_id && (
              <GeneratedResult
                generatedCv={result.generatedCv}
                job={job}
                profile={profile}
                templateId={getCVForJob(job.job_id)?.templateId}
                onOpen={() => handleOpenInEditor(job)}
              />
            )}
          </Card>
          );
        })}
      </PanelCard>
    </Shell>
  );
};

const PreviewResult: React.FC<{ result: TailorPreviewResult }> = ({ result }) => {
  const matches: Array<{ kind: string; name: string; matched: string[] }> = [
    ...result.matched_projects.map((p) => ({ kind: 'Project', name: p.name ?? '', matched: p.matched_terms })),
    ...result.matched_experiences.map((e) => ({ kind: 'Experience', name: e.title ?? '', matched: e.matched_terms })),
  ];

  return (
    <div className="mt-2.5 rounded-[10px] border border-sand bg-white p-3.5">
      <div className="mb-1.5 text-[11px] text-ink-muted">
        KEYWORD MATCHES
        {matches.length > 0 ? ` — found ${matches.length}` : ' — none found'}
      </div>

      {result.extracted_requirements.length > 0 && (
        <div className="mb-2 text-xs text-ink-soft">
          Requirements spotted: {result.extracted_requirements.join(', ')}
        </div>
      )}

      {matches.map((m, i) => (
        <div key={i} className="mb-2">
          <div className="text-xs font-medium">
            {m.kind}: {m.name || 'Untitled'}
          </div>
          {m.matched.length > 0 && (
            <div className="text-[11px] text-ink-muted">matched: {m.matched.join(', ')}</div>
          )}
        </div>
      ))}

      {matches.length === 0 && (
        <div className="text-xs text-ink-soft">
          No literal keyword overlap with the JD. This is the keyword-only view —{' '}
          <span className="font-semibold">Tailor CV</span> uses semantic matching and may still
          find relevant experience.
        </div>
      )}
    </div>
  );
};

const GeneratedResult: React.FC<{
  generatedCv: GeneratedCV;
  job: StoredJobDescription;
  profile: StoredProfile | null;
  templateId?: string;
  onOpen: () => void;
}> = ({ generatedCv, job, profile, templateId, onOpen }) => {
  const cvData = generatedCvToCVData(generatedCv, profile);

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] text-ink-muted">GENERATED CV PREVIEW</div>
        <div className="text-[11px] text-ink-muted">
          {job.job_title} · {job.company_name}
        </div>
      </div>

      <CVPreview cv={cvData} templateId={templateId} />

      <div className="mt-3 text-center">
        <Button onClick={onOpen}>Open full CV with details →</Button>
      </div>
    </div>
  );
};