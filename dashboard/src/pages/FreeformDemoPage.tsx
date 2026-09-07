import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, SectionTitle, Tag, TextArea } from '../components/ui';

/**
 * DEMO ONLY — simulates the "paste your background, don't fill in a form"
 * intake flow from PLAN.md. Every "extracted"/"generated" result here is
 * hardcoded fake data returned after a fake delay, not a real API call —
 * there is no backend wired up yet. This exists to let the actual UX be
 * looked at and reacted to before any of it is real.
 */

interface FakeProfile {
  full_name: string;
  skills: string[];
  projects: { name: string; description: string }[];
  experience: { title: string; description: string }[];
}

interface FakeGeneratedCv {
  title: string;
  summary: string;
  experience: { company: string; role: string; period: string; description: string }[];
}

const PLACEHOLDER_BACKGROUND = `I've been a software engineer for about 5 years, mostly working on backend and cloud stuff.

Built a CI/CD pipeline for a side project called "2048 CI/CD Project" using AWS CodePipeline, ECS and ECR — that was a fun one to get working end to end.

Right now I'm a Research Engineer working on the Bittide protocol implementation.

I know AWS, Python, Docker pretty well, picked up Terraform recently.`;

const PLACEHOLDER_JOB = `Catalyst Cloud is hiring a Junior DevOps Engineer.
We are looking for someone with AWS, Linux, and CI/CD experience who's comfortable picking up new tools quickly.`;

// Fake "extraction" result — always the same regardless of input, since
// nothing is actually parsing the text yet.
const FAKE_PROFILE: FakeProfile = {
  full_name: 'Allan Chien',
  skills: ['AWS', 'Python', 'Docker', 'Terraform'],
  projects: [
    {
      name: '2048 CI/CD Project',
      description: 'Built a CI/CD pipeline using AWS CodePipeline, ECS, and ECR.',
    },
  ],
  experience: [
    {
      title: 'Research Engineer',
      description: 'Working on the Bittide protocol implementation.',
    },
  ],
};

// Fake "generated CV" result, shaped like tailoring-service's real
// generated_cv response (title/summary/experience) from PLAN.md.
const FAKE_GENERATED_CV: FakeGeneratedCv = {
  title: 'DevOps Engineer',
  summary:
    'Backend-leaning engineer with hands-on AWS and CI/CD experience, including building a full pipeline with CodePipeline, ECS, and ECR — comfortable picking up new infrastructure tooling quickly.',
  experience: [
    {
      company: 'Personal project',
      role: 'CI/CD Pipeline Builder',
      period: 'Recent',
      description:
        'Designed and built a CI/CD pipeline on AWS using CodePipeline, ECS, and ECR — directly relevant to Catalyst Cloud’s CI/CD and AWS requirements.',
    },
    {
      company: 'Research lab',
      role: 'Research Engineer',
      period: 'Current',
      description: 'Working on the Bittide protocol implementation, day-to-day Linux environment.',
    },
  ],
};

type Stage = 'intake' | 'extracting' | 'profile' | 'job' | 'generating' | 'result';

export const FreeformDemoPage: React.FC = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('intake');
  const [backgroundText, setBackgroundText] = useState('');
  const [jobText, setJobText] = useState('');
  const [skills, setSkills] = useState(FAKE_PROFILE.skills);

  const handleExtract = () => {
    setStage('extracting');
    setTimeout(() => {
      setSkills(FAKE_PROFILE.skills);
      setStage('profile');
    }, 1100);
  };

  const handleGenerate = () => {
    setStage('generating');
    setTimeout(() => setStage('result'), 1400);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0ede6', padding: '40px 20px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '28px', margin: 0, color: '#1a1a18' }}>
            Tell us about yourself
          </h1>
          <Button variant="ghost" onClick={() => navigate('/')} style={{ marginBottom: 0 }}>
            Exit demo
          </Button>
        </div>
        <p style={{ fontSize: '12px', color: '#9e9a91', marginBottom: '24px' }}>
          Demo — every result below is fake, simulated data. Nothing here calls a real backend yet.
        </p>

        {(stage === 'intake' || stage === 'extracting') && (
          <div
            style={{
              background: '#fff',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #e6e1d7',
              boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
            }}
          >
            <SectionTitle>Your background</SectionTitle>
            <p style={{ fontSize: '12px', color: '#6b665c', marginTop: '-4px', marginBottom: '10px' }}>
              Paste or type your experience however it comes out — work history, projects, skills, whatever
              you've got. No forms, no required fields.
            </p>
            <TextArea
              rows={10}
              placeholder={PLACEHOLDER_BACKGROUND}
              value={backgroundText}
              onChange={(e) => setBackgroundText(e.target.value)}
              disabled={stage === 'extracting'}
            />
            <Button
              onClick={handleExtract}
              disabled={stage === 'extracting'}
              style={{ marginTop: '14px', marginBottom: 0 }}
            >
              {stage === 'extracting' ? 'Reading through it…' : 'Build my profile'}
            </Button>
          </div>
        )}

        {(stage === 'profile' || stage === 'job' || stage === 'generating' || stage === 'result') && (
          <Card>
            <SectionTitle>Here's what we found</SectionTitle>
            <p style={{ fontSize: '11px', color: '#9e9a91', marginTop: '-4px', marginBottom: '12px' }}>
              Simulated extraction — a real pass would read this out of what you typed above.
            </p>

            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Skills</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              {skills.map((skill) => (
                <Tag key={skill} onRemove={() => setSkills(skills.filter((s) => s !== skill))}>
                  {skill}
                </Tag>
              ))}
            </div>

            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Projects</div>
            {FAKE_PROFILE.projects.map((project) => (
              <div key={project.name} style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 500 }}>{project.name}</div>
                <div style={{ fontSize: '12px', color: '#5a5751' }}>{project.description}</div>
              </div>
            ))}

            <div style={{ fontSize: '12px', fontWeight: 500, margin: '10px 0 6px' }}>Experience</div>
            {FAKE_PROFILE.experience.map((exp) => (
              <div key={exp.title} style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 500 }}>{exp.title}</div>
                <div style={{ fontSize: '12px', color: '#5a5751' }}>{exp.description}</div>
              </div>
            ))}

            {stage === 'profile' && (
              <Button onClick={() => setStage('job')} style={{ marginTop: '4px', marginBottom: 0 }}>
                Looks right — pick a job to tailor for
              </Button>
            )}
          </Card>
        )}

        {(stage === 'job' || stage === 'generating' || stage === 'result') && (
          <div
            style={{
              background: '#fff',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #e6e1d7',
              boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
              marginTop: '16px',
            }}
          >
            <SectionTitle>Target job</SectionTitle>
            <p style={{ fontSize: '12px', color: '#6b665c', marginTop: '-4px', marginBottom: '10px' }}>
              Paste the job description — no need to save it first, just paste and go.
            </p>
            <TextArea
              rows={5}
              placeholder={PLACEHOLDER_JOB}
              value={jobText}
              onChange={(e) => setJobText(e.target.value)}
              disabled={stage !== 'job'}
            />
            {stage === 'job' && (
              <Button onClick={handleGenerate} style={{ marginTop: '14px', marginBottom: 0 }}>
                Generate tailored CV
              </Button>
            )}
            {stage === 'generating' && (
              <div style={{ marginTop: '14px', fontSize: '12px', color: '#9e9a91' }}>Tailoring your CV…</div>
            )}
          </div>
        )}

        {stage === 'result' && (
          <div
            style={{
              background: '#fff',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #e6e1d7',
              boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
              marginTop: '16px',
            }}
          >
            <SectionTitle>Tailored for this job</SectionTitle>
            <p style={{ fontSize: '11px', color: '#9e9a91', marginTop: '-4px', marginBottom: '14px' }}>
              Simulated generation — shaped like the real tailoring-service response
              (title / summary / experience) from PLAN.md.
            </p>
            <div style={{ fontSize: '16px', fontFamily: "'DM Serif Display', serif", marginBottom: '10px' }}>
              {FAKE_GENERATED_CV.title}
            </div>
            <p style={{ fontSize: '12.5px', lineHeight: 1.7, color: '#3a3835', marginBottom: '16px' }}>
              {FAKE_GENERATED_CV.summary}
            </p>
            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>Experience</div>
            {FAKE_GENERATED_CV.experience.map((exp) => (
              <div key={exp.role} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 500 }}>
                    {exp.role} · {exp.company}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9e9a91' }}>{exp.period}</div>
                </div>
                <div style={{ fontSize: '12px', color: '#5a5751', marginTop: '3px' }}>{exp.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
