import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Button, Field, Input, SectionTitle, TextArea } from '../components/ui';
import {
  saveJobDescription,
  listJobDescriptions,
  generateTailoredCV,
  tailorPreview,
  getProfile,
  StoredJobDescription,
  GeneratedCV,
  PromptContext,
  TailorPreviewResult,
} from '../api/backend';

type ListState = 'loading' | 'loaded' | 'error';
type SaveState = 'idle' | 'saving' | 'error';
type GenerateState = { jobId: string; status: 'generating' } | { jobId: string; status: 'error'; message: string } | null;
type PreviewState = {
  jobId: string;
  status: 'loading' | 'loaded' | 'error';
  result?: TailorPreviewResult;
  message?: string;
} | null;
type OpenState = { jobId: string; status: 'opening' | 'error'; message?: string } | null;

export const JobDescriptionPage: React.FC = () => {
  const navigate = useNavigate();
  const email = useCVStore((state) => state.email);
  const loadGeneratedCV = useCVStore((state) => state.loadGeneratedCV);

  const [jobs, setJobs] = useState<StoredJobDescription[]>([]);
  const [listState, setListState] = useState<ListState>('loading');

  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [rawDescription, setRawDescription] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [generateState, setGenerateState] = useState<GenerateState>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const [openState, setOpenState] = useState<OpenState>(null);
  const [result, setResult] = useState<{
    jobId: string;
    promptContext: PromptContext;
    generatedCv: GeneratedCV;
  } | null>(null);

  useEffect(() => {
    if (!email) return;
    listJobDescriptions(email)
      .then((data) => {
        setJobs(data);
        setListState('loaded');
      })
      .catch(() => setListState('error'));
  }, [email]);

  if (!email) {
    return (
      <Shell>
        <Card>
          <div style={{ fontSize: '13px', marginBottom: '10px' }}>You need to sign in first.</div>
          <Button onClick={() => navigate('/')} style={{ marginBottom: 0 }}>
            Go to sign in
          </Button>
        </Card>
      </Shell>
    );
  }

  const handleSave = async () => {
    if (!companyName.trim() || !jobTitle.trim() || !rawDescription.trim()) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const saved = await saveJobDescription(email, {
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

  const handleGenerate = async (job: StoredJobDescription) => {
    setResult(null);
    setGenerateState({ jobId: job.job_id, status: 'generating' });
    try {
      const data = await generateTailoredCV(email, job.job_id);
      setResult({ jobId: job.job_id, promptContext: data.prompt_context, generatedCv: data.generated_cv });
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
      const result = await tailorPreview(email, job.job_id);
      setPreviewState({ jobId: job.job_id, status: 'loaded', result });
    } catch (e) {
      setPreviewState({
        jobId: job.job_id,
        status: 'error',
        message: e instanceof Error ? e.message : 'Something went wrong previewing matches.',
      });
    }
  };

  const handleOpenInEditor = async (
    job: StoredJobDescription,
    generatedCv: GeneratedCV,
  ) => {
    setOpenState({ jobId: job.job_id, status: 'opening' });
    try {
      const profile = await getProfile(email);
      loadGeneratedCV(
        profile,
        generatedCv,
        { companyName: job.company_name, jobTitle: job.job_title },
      );
      navigate('/builder');
    } catch (e) {
      setOpenState({
        jobId: job.job_id,
        status: 'error',
        message: e instanceof Error ? e.message : 'Something went wrong loading your profile.',
      });
    }
  };

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '28px', margin: 0, color: '#1a1a18' }}>
          Job descriptions
        </h1>
        <span style={{ fontSize: '11px', color: '#9e9a91' }}>{email}</span>
      </div>
      <p style={{ fontSize: '12px', color: '#6b665c', marginBottom: '20px' }}>
        Paste a job posting, save it, then generate a CV tailored to it from your profile.
      </p>

      <PanelCard>
        <SectionTitle>Add a job posting</SectionTitle>
        {saveError && (
          <div
            style={{
              fontSize: '12px',
              color: '#8a3a2f',
              background: '#f7e9e5',
              border: '1px solid #e6c3ba',
              borderRadius: '8px',
              padding: '10px',
              marginBottom: '14px',
            }}
          >
            {saveError}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <Field label="Company">
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Vertex Analytics" />
          </Field>
          <Field label="Job title">
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
          style={{ marginBottom: 0 }}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save job'}
        </Button>
      </PanelCard>

      <PanelCard>
        <SectionTitle>Saved jobs</SectionTitle>
        {listState === 'loading' && <div style={{ fontSize: '12px', color: '#9e9a91' }}>Loading…</div>}
        {listState === 'error' && <div style={{ fontSize: '12px', color: '#8a3a2f' }}>Couldn't load your saved jobs.</div>}
        {listState === 'loaded' && jobs.length === 0 && (
          <div style={{ fontSize: '12px', color: '#9e9a91' }}>No jobs saved yet — add one above.</div>
        )}
        {jobs.map((job) => (
          <Card key={job.job_id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{job.job_title}</div>
                <div style={{ fontSize: '12px', color: '#6b665c' }}>{job.company_name}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="ghost"
                  onClick={() => handlePreview(job)}
                  disabled={previewState?.jobId === job.job_id && previewState.status === 'loading'}
                  style={{ marginBottom: 0, whiteSpace: 'nowrap' }}
                >
                  {previewState?.jobId === job.job_id && previewState.status === 'loading'
                    ? 'Matching…'
                    : 'Preview matches'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleGenerate(job)}
                  disabled={generateState?.jobId === job.job_id && generateState.status === 'generating'}
                  style={{ marginBottom: 0, whiteSpace: 'nowrap' }}
                >
                  {generateState?.jobId === job.job_id && generateState.status === 'generating'
                    ? 'Tailoring…'
                    : 'Tailor CV'}
                </Button>
              </div>
            </div>
            {previewState?.jobId === job.job_id && previewState.status === 'error' && (
              <div style={{ fontSize: '12px', color: '#8a3a2f', marginTop: '8px' }}>
                {previewState.message}
              </div>
            )}
            {previewState?.jobId === job.job_id && previewState.result && (
              <PreviewResult result={previewState.result} />
            )}
            {generateState?.jobId === job.job_id && generateState.status === 'error' && (
              <div style={{ fontSize: '12px', color: '#8a3a2f', marginTop: '8px' }}>{generateState.message}</div>
            )}
            {openState?.jobId === job.job_id && openState.status === 'error' && (
              <div style={{ fontSize: '12px', color: '#8a3a2f', marginTop: '8px' }}>{openState.message}</div>
            )}
            {result && result.jobId === job.job_id && (
              <>
                <GeneratedResult result={result} />
                <div style={{ textAlign: 'right' }}>
                  <Button
                    variant="ghost"
                    onClick={() => handleOpenInEditor(job, result.generatedCv)}
                    disabled={openState?.jobId === job.job_id && openState.status === 'opening'}
                    style={{ marginBottom: 0 }}
                  >
                    {openState?.jobId === job.job_id && openState.status === 'opening'
                      ? 'Opening…'
                      : 'Open in editor →'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        ))}
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
    <div
      style={{
        marginTop: '10px',
        padding: '14px',
        borderRadius: '10px',
        border: '1px solid #e6e1d7',
        background: '#fff',
      }}
    >
      <div style={{ fontSize: '11px', color: '#9e9a91', marginBottom: '6px' }}>
        KEYWORD MATCHES
        {matches.length > 0 ? ` — found ${matches.length}` : ' — none found'}
      </div>

      {result.extracted_requirements.length > 0 && (
        <div style={{ fontSize: '12px', color: '#6b665c', marginBottom: '8px' }}>
          Requirements spotted: {result.extracted_requirements.join(', ')}
        </div>
      )}

      {matches.map((m, i) => (
        <div key={i} style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 500 }}>
            {m.kind}: {m.name || 'Untitled'}
          </div>
          {m.matched.length > 0 && (
            <div style={{ fontSize: '11px', color: '#9e9a91' }}>matched: {m.matched.join(', ')}</div>
          )}
        </div>
      ))}

      {matches.length === 0 && (
        <div style={{ fontSize: '12px', color: '#6b665c' }}>
          No literal keyword overlap with the JD. This is the keyword-only view —{' '}
          <span style={{ fontWeight: 600 }}>Tailor CV</span> uses semantic matching and may still
          find relevant experience.
        </div>
      )}
    </div>
  );
};

const GeneratedResult: React.FC<{
  result: { promptContext: PromptContext; generatedCv: GeneratedCV };
}> = ({ result }) => {
  const { generatedCv } = result;
  return (
    <div
      style={{
        marginTop: '10px',
        padding: '14px',
        borderRadius: '10px',
        border: '1px solid #e6e1d7',
        background: '#fff',
      }}
    >
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{generatedCv.title}</div>
      <div style={{ fontSize: '12px', color: '#3a352b', marginBottom: '12px' }}>{generatedCv.summary}</div>

      {generatedCv.experience.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: '#9e9a91', marginBottom: '6px' }}>EXPERIENCE</div>
          {generatedCv.experience.map((exp, i) => (
            <div key={i} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 500 }}>
                {exp.role} · {exp.company}
                {exp.period ? ` · ${exp.period}` : ''}
              </div>
              <div style={{ fontSize: '12px', color: '#6b665c' }}>{exp.description}</div>
            </div>
          ))}
        </>
      )}

      {generatedCv.education.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: '#9e9a91', margin: '10px 0 6px' }}>EDUCATION</div>
          {generatedCv.education.map((edu, i) => (
            <div key={i} style={{ fontSize: '12px', marginBottom: '4px' }}>
              {edu.degree} · {edu.institution}
              {edu.period ? ` · ${edu.period}` : ''}
            </div>
          ))}
        </>
      )}
    </div>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ minHeight: '100vh', background: '#f0ede6', padding: '40px 20px' }}>
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>{children}</div>
  </div>
);

const PanelCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      background: '#fff',
      padding: '24px',
      borderRadius: '16px',
      border: '1px solid #e6e1d7',
      boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
      marginBottom: '16px',
    }}
  >
    {children}
  </div>
);

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      padding: '14px',
      border: '1px solid #ece6d8',
      borderRadius: '10px',
      background: '#fbfaf7',
      marginBottom: '10px',
    }}
  >
    {children}
  </div>
);
