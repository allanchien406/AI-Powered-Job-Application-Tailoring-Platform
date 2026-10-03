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

  const cardClass = 'rounded-2xl border border-sand bg-white p-7 shadow-card';

  return (
    <div className="min-h-screen bg-paper px-5 py-10">
      <div className="mx-auto max-w-[640px]">
        <div className="mb-2 flex items-baseline justify-between">
          <h1 className="m-0 font-display text-[28px] text-ink">Tell us about yourself</h1>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Exit demo
          </Button>
        </div>
        <p className="mb-6 text-xs text-ink-muted">
          Demo — every result below is fake, simulated data. Nothing here calls a real backend yet.
        </p>

        {(stage === 'intake' || stage === 'extracting') && (
          <div className={cardClass}>
            <SectionTitle>Your background</SectionTitle>
            <p className="-mt-1 mb-2.5 text-xs text-ink-soft">
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
              className="mt-3.5"
            >
              {stage === 'extracting' ? 'Reading through it…' : 'Build my profile'}
            </Button>
          </div>
        )}

        {(stage === 'profile' || stage === 'job' || stage === 'generating' || stage === 'result') && (
          <Card>
            <SectionTitle>Here's what we found</SectionTitle>
            <p className="-mt-1 mb-3 text-[11px] text-ink-muted">
              Simulated extraction — a real pass would read this out of what you typed above.
            </p>

            <div className="mb-1.5 text-xs font-medium">Skills</div>
            <div className="mb-3.5 flex flex-wrap gap-2">
              {skills.map((skill) => (
                <Tag key={skill} onRemove={() => setSkills(skills.filter((s) => s !== skill))}>
                  {skill}
                </Tag>
              ))}
            </div>

            <div className="mb-1.5 text-xs font-medium">Projects</div>
            {FAKE_PROFILE.projects.map((project) => (
              <div key={project.name} className="mb-2.5">
                <div className="text-[12.5px] font-medium">{project.name}</div>
                <div className="text-xs text-[#5a5751]">{project.description}</div>
              </div>
            ))}

            <div className="mb-1.5 text-xs font-medium">Experience</div>
            {FAKE_PROFILE.experience.map((exp) => (
              <div key={exp.title} className="mb-2.5">
                <div className="text-[12.5px] font-medium">{exp.title}</div>
                <div className="text-xs text-[#5a5751]">{exp.description}</div>
              </div>
            ))}

            {stage === 'profile' && (
              <Button onClick={() => setStage('job')} className="mt-1">
                Looks right — pick a job to tailor for
              </Button>
            )}
          </Card>
        )}

        {(stage === 'job' || stage === 'generating' || stage === 'result') && (
          <div className={`${cardClass} mt-4`}>
            <SectionTitle>Target job</SectionTitle>
            <p className="-mt-1 mb-2.5 text-xs text-ink-soft">
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
              <Button onClick={handleGenerate} className="mt-3.5">
                Generate tailored CV
              </Button>
            )}
            {stage === 'generating' && (
              <div className="mt-3.5 text-xs text-ink-muted">Tailoring your CV…</div>
            )}
          </div>
        )}

        {stage === 'result' && (
          <div className={`${cardClass} mt-4`}>
            <SectionTitle>Tailored for this job</SectionTitle>
            <p className="-mt-1 mb-3.5 text-[11px] text-ink-muted">
              Simulated generation — shaped like the real tailoring-service response
              (title / summary / experience) from PLAN.md.
            </p>
            <div className="mb-2.5 font-display text-base text-ink">{FAKE_GENERATED_CV.title}</div>
            <p className="mb-4 text-[12.5px] leading-[1.7] text-[#3a3835]">
              {FAKE_GENERATED_CV.summary}
            </p>
            <div className="mb-2 text-xs font-medium">Experience</div>
            {FAKE_GENERATED_CV.experience.map((exp) => (
              <div key={exp.role} className="mb-3">
                <div className="flex justify-between">
                  <div className="text-[12.5px] font-medium">
                    {exp.role} · {exp.company}
                  </div>
                  <div className="text-[11px] text-ink-muted">{exp.period}</div>
                </div>
                <div className="mt-0.5 text-xs text-[#5a5751]">{exp.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};