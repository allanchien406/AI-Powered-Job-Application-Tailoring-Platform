import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Shell } from '../components/Shell';
import { Button, Card, Field, Input, Notice, SectionTitle, Tag, TextArea, PanelCard, Collapsible } from '../components/ui';
import {
  parseProfileText,
  saveProfile,
  getProfile,
  Profile,
  ExperienceEntry,
  ProjectEntry,
  EducationEntry,
} from '../api/backend';

const PLACEHOLDER = `Just describe your background however it comes out.

e.g. "I've been a software engineer at Acme for 3 years, mostly backend work
with Python and Postgres. Before that I did a year of frontend at a startup.
On the side I built a budget-tracking app in React Native. I know Docker and
AWS too."`;

type Stage = 'loading' | 'paste' | 'parsing' | 'review' | 'saving' | 'saved';

const emptyProfile: Profile = {
  full_name: '',
  skills: [],
  projects: [],
  experience: [],
  education: [],
};

export const ProfileIntakePage: React.FC = () => {
  const navigate = useNavigate();
  const email = useCVStore((state) => state.email);

  const [stage, setStage] = useState<Stage>('loading');
  const [rawText, setRawText] = useState('');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [newSkill, setNewSkill] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    setStage('loading');
    setError(null);
    getProfile()
      .then((saved) => {
        if (cancelled) return;
        setProfile(saved);
        setStage('review');
      })
      .catch((e) => {
        if (cancelled) return;
        setStage('paste');
        if (!(e instanceof Error && e.message.includes('404'))) {
          setError(e instanceof Error ? e.message : 'Could not load your saved profile.');
        }
      });
    return () => {
      cancelled = true;
    };
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

  const handleParse = async () => {
    if (!rawText.trim()) return;
    setStage('parsing');
    setError(null);
    try {
      const parsed = await parseProfileText(rawText);
      setProfile(parsed);
      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong parsing your text.');
      setStage('paste');
    }
  };

  const handleSave = async () => {
    setStage('saving');
    setError(null);
    try {
      await saveProfile({ ...profile, email });
      setStage('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong saving your profile.');
      setStage('review');
    }
  };

  const updateExperience = (i: number, patch: Partial<ExperienceEntry>) =>
    setProfile((p) => ({
      ...p,
      experience: p.experience.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    }));

  const updateProject = (i: number, patch: Partial<ProjectEntry>) =>
    setProfile((p) => ({
      ...p,
      projects: p.projects.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    }));

  const updateEducation = (i: number, patch: Partial<EducationEntry>) =>
    setProfile((p) => ({
      ...p,
      education: p.education.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    }));

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="m-0 font-display text-[28px] text-ink">Your background</h1>
        <p className="mt-1.5 text-xs leading-normal text-ink-soft">
          {(stage === 'paste' || stage === 'parsing') &&
            'Paste it as prose — we\'ll turn it into a structured profile you can fix up before saving.'}
          {(stage === 'review' || stage === 'saving') &&
            'This is the profile saved to your account — edit anything, then save to update it.'}
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {stage === 'loading' && (
        <PanelCard>
          <div className="text-xs text-ink-muted">Loading your profile…</div>
        </PanelCard>
      )}

      {(stage === 'paste' || stage === 'parsing') && (
        <PanelCard>
          <SectionTitle>Tell us about yourself</SectionTitle>
          <TextArea
            rows={12}
            placeholder={PLACEHOLDER}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={stage === 'parsing'}
          />
          <Button
            onClick={handleParse}
            disabled={stage === 'parsing' || !rawText.trim()}
            className="mt-3.5"
          >
            {stage === 'parsing' ? 'Reading through it…' : 'Build my profile'}
          </Button>
        </PanelCard>
      )}

      {(stage === 'review' || stage === 'saving') && (
        <>
          <PanelCard>
            <Field label="Full name">
              <Input
                value={profile.full_name}
                onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
                placeholder="Your name"
              />
            </Field>

            <SectionTitle>Skills</SectionTitle>
            <div className="mb-2.5 flex flex-wrap gap-2">
              {profile.skills.map((skill, i) => (
                <Tag key={`${skill}-${i}`} onRemove={() => setProfile((p) => ({ ...p, skills: p.skills.filter((_, idx) => idx !== i) }))}>
                  {skill}
                </Tag>
              ))}
            </div>
            <Field label="Add a skill">
              <Input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSkill.trim()) {
                    setProfile((p) => ({ ...p, skills: [...p.skills, newSkill.trim()] }));
                    setNewSkill('');
                  }
                }}
                placeholder="e.g. Kubernetes — press Enter to add"
              />
            </Field>
          </PanelCard>

          <PanelCard>
            <Collapsible title="Experience" count={profile.experience.length}>
              {profile.experience.map((exp, i) => (
                <Card key={i}>
                  <div className="flex gap-2">
                    <Field label="Role" className="flex-1">
                      <Input
                        value={exp.title}
                        onChange={(e) => updateExperience(i, { title: e.target.value })}
                        placeholder="e.g. Backend Engineer"
                      />
                    </Field>
                    <Field label="Company" className="flex-1">
                      <Input
                        value={exp.company}
                        onChange={(e) => updateExperience(i, { company: e.target.value })}
                        placeholder="e.g. Acme Corp"
                      />
                    </Field>
                  </div>
                  <Field label="Period">
                    <Input
                      value={exp.period}
                      onChange={(e) => updateExperience(i, { period: e.target.value })}
                      placeholder="e.g. 2020–2023"
                    />
                  </Field>
                  <Field label="What you did">
                    <TextArea
                      rows={2}
                      value={exp.description}
                      onChange={(e) => updateExperience(i, { description: e.target.value })}
                      placeholder="e.g. Built and ran the intake API in Python + Postgres"
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    onClick={() => setProfile((p) => ({ ...p, experience: p.experience.filter((_, idx) => idx !== i) }))}
                  >
                    Remove
                  </Button>
                </Card>
              ))}
              <Button
                variant="ghost"
                onClick={() => setProfile((p) => ({ ...p, experience: [...p.experience, { title: '', company: '', period: '', description: '' }] }))}
              >
                + Add experience
              </Button>
            </Collapsible>
          </PanelCard>

          <PanelCard>
            <Collapsible title="Projects" count={profile.projects.length}>
              {profile.projects.map((proj, i) => (
                <Card key={i}>
                  <div className="flex gap-2">
                    <Field label="Project name" className="flex-1">
                      <Input
                        value={proj.name}
                        onChange={(e) => updateProject(i, { name: e.target.value })}
                        placeholder="e.g. Budget Tracker"
                      />
                    </Field>
                    <Field label="Period" className="flex-1">
                      <Input
                        value={proj.period}
                        onChange={(e) => updateProject(i, { period: e.target.value })}
                        placeholder="e.g. 2023"
                      />
                    </Field>
                  </div>
                  <Field label="What you built">
                    <TextArea
                      rows={2}
                      value={proj.description}
                      onChange={(e) => updateProject(i, { description: e.target.value })}
                      placeholder="e.g. A React + Postgres web app for tracking monthly budgets"
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    onClick={() => setProfile((p) => ({ ...p, projects: p.projects.filter((_, idx) => idx !== i) }))}
                  >
                    Remove
                  </Button>
                </Card>
              ))}
              <Button
                variant="ghost"
                onClick={() => setProfile((p) => ({ ...p, projects: [...p.projects, { name: '', period: '', description: '' }] }))}
              >
                + Add project
              </Button>
            </Collapsible>
          </PanelCard>

          <PanelCard>
            <Collapsible title="Education" count={profile.education.length}>
              {profile.education.map((edu, i) => (
                <Card key={i}>
                  <div className="flex gap-2">
                    <Field label="School" className="flex-1">
                      <Input
                        value={edu.institution}
                        onChange={(e) => updateEducation(i, { institution: e.target.value })}
                        placeholder="e.g. State University"
                      />
                    </Field>
                    <Field label="Period" className="flex-1">
                      <Input
                        value={edu.period}
                        onChange={(e) => updateEducation(i, { period: e.target.value })}
                        placeholder="e.g. 2016–2020"
                      />
                    </Field>
                  </div>
                  <Field label="Degree / program">
                    <Input
                      value={edu.degree}
                      onChange={(e) => updateEducation(i, { degree: e.target.value })}
                      placeholder="e.g. B.Sc. in Computer Science"
                    />
                  </Field>
                  <Field label="Details">
                    <TextArea
                      rows={2}
                      value={edu.description}
                      onChange={(e) => updateEducation(i, { description: e.target.value })}
                      placeholder="Honors, relevant coursework, thesis (optional)"
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    onClick={() => setProfile((p) => ({ ...p, education: p.education.filter((_, idx) => idx !== i) }))}
                    className="mt-2"
                  >
                    Remove
                  </Button>
                </Card>
              ))}
              <Button
                variant="ghost"
                onClick={() => setProfile((p) => ({ ...p, education: [...p.education, { institution: '', degree: '', period: '', description: '' }] }))}
              >
                + Add education
              </Button>
            </Collapsible>
          </PanelCard>

          <div className="flex gap-2.5">
            <Button onClick={handleSave} disabled={stage === 'saving'}>
              {stage === 'saving' ? 'Saving…' : 'Save profile'}
            </Button>
            <Button variant="ghost" onClick={() => setStage('paste')} disabled={stage === 'saving'}>
              Start over
            </Button>
          </div>
        </>
      )}

      {stage === 'saved' && (
        <PanelCard>
          <div className="mb-2 text-sm font-medium">Profile saved ✓</div>
          <div className="mb-3 text-xs text-ink-soft">
            Saved under {email}. You can paste more text to rebuild it, or move on to tailoring a CV.
          </div>
          <div className="flex gap-2.5">
            <Button onClick={() => navigate('/jobs')}>Add a job to tailor for →</Button>
            <Button variant="ghost" onClick={() => setStage('paste')}>Edit again</Button>
          </div>
        </PanelCard>
      )}
    </Shell>
  );
};