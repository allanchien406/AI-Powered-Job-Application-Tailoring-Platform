import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Button, Card, Field, Input, SectionTitle, Tag, TextArea } from '../components/ui';
import {
  parseProfileText,
  saveProfile,
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

type Stage = 'paste' | 'parsing' | 'review' | 'saving' | 'saved';

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

  const [stage, setStage] = useState<Stage>('paste');
  const [rawText, setRawText] = useState('');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [newSkill, setNewSkill] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!email) {
    return (
      <Shell>
        <Card>
          <div style={{ fontSize: '13px', marginBottom: '10px' }}>
            You need to sign in first.
          </div>
          <Button onClick={() => navigate('/')} style={{ marginBottom: 0 }}>
            Go to sign in
          </Button>
        </Card>
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
      await saveProfile(email, profile);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '28px', margin: 0, color: '#1a1a18' }}>
          Your background
        </h1>
        <span style={{ fontSize: '11px', color: '#9e9a91' }}>{email}</span>
      </div>
      <p style={{ fontSize: '12px', color: '#6b665c', marginBottom: '20px' }}>
        Paste it as prose — we'll turn it into a structured profile you can fix up before saving.
      </p>

      {error && (
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
          {error}
        </div>
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
          <Button onClick={handleParse} disabled={stage === 'parsing' || !rawText.trim()} style={{ marginTop: '14px', marginBottom: 0 }}>
            {stage === 'parsing' ? 'Reading through it…' : 'Build my profile'}
          </Button>
        </PanelCard>
      )}

      {(stage === 'review' || stage === 'saving') && (
        <>
          <p style={{ fontSize: '11px', color: '#9e9a91', marginBottom: '12px' }}>
            Review and correct anything below, then save. Nothing is stored until you hit Save.
          </p>

          <PanelCard>
            <Field label="Full name">
              <Input
                value={profile.full_name}
                onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
                placeholder="Your name"
              />
            </Field>

            <SectionTitle>Skills</SectionTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              {profile.skills.map((skill, i) => (
                <Tag key={`${skill}-${i}`} onRemove={() => setProfile((p) => ({ ...p, skills: p.skills.filter((_, idx) => idx !== i) }))}>
                  {skill}
                </Tag>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSkill.trim()) {
                    setProfile((p) => ({ ...p, skills: [...p.skills, newSkill.trim()] }));
                    setNewSkill('');
                  }
                }}
                placeholder="Add a skill and press Enter"
              />
            </div>
          </PanelCard>

          <PanelCard>
            <SectionTitle>Experience</SectionTitle>
            {profile.experience.map((exp, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <Input value={exp.title} onChange={(e) => updateExperience(i, { title: e.target.value })} placeholder="Role / title" />
                  <Input value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} placeholder="Company (optional)" />
                </div>
                <Input value={exp.period} onChange={(e) => updateExperience(i, { period: e.target.value })} placeholder="Period, e.g. 2020–2023 (optional)" style={{ marginBottom: '8px' }} />
                <TextArea rows={2} value={exp.description} onChange={(e) => updateExperience(i, { description: e.target.value })} placeholder="What you did" />
                <Button
                  variant="ghost"
                  onClick={() => setProfile((p) => ({ ...p, experience: p.experience.filter((_, idx) => idx !== i) }))}
                  style={{ marginTop: '8px', marginBottom: 0 }}
                >
                  Remove
                </Button>
              </Card>
            ))}
            <Button
              variant="ghost"
              onClick={() => setProfile((p) => ({ ...p, experience: [...p.experience, { title: '', company: '', period: '', description: '' }] }))}
              style={{ marginBottom: 0 }}
            >
              + Add experience
            </Button>
          </PanelCard>

          <PanelCard>
            <SectionTitle>Projects</SectionTitle>
            {profile.projects.map((proj, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <Input value={proj.name} onChange={(e) => updateProject(i, { name: e.target.value })} placeholder="Project name" />
                  <Input value={proj.period} onChange={(e) => updateProject(i, { period: e.target.value })} placeholder="Period (optional)" />
                </div>
                <TextArea rows={2} value={proj.description} onChange={(e) => updateProject(i, { description: e.target.value })} placeholder="What it is / what you built" />
                <Button
                  variant="ghost"
                  onClick={() => setProfile((p) => ({ ...p, projects: p.projects.filter((_, idx) => idx !== i) }))}
                  style={{ marginTop: '8px', marginBottom: 0 }}
                >
                  Remove
                </Button>
              </Card>
            ))}
            <Button
              variant="ghost"
              onClick={() => setProfile((p) => ({ ...p, projects: [...p.projects, { name: '', period: '', description: '' }] }))}
              style={{ marginBottom: 0 }}
            >
              + Add project
            </Button>
          </PanelCard>

          <PanelCard>
            <SectionTitle>Education</SectionTitle>
            {profile.education.map((edu, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <Input value={edu.institution} onChange={(e) => updateEducation(i, { institution: e.target.value })} placeholder="School / institution" />
                  <Input value={edu.period} onChange={(e) => updateEducation(i, { period: e.target.value })} placeholder="Period (optional)" />
                </div>
                <Input value={edu.degree} onChange={(e) => updateEducation(i, { degree: e.target.value })} placeholder="Degree / program" style={{ marginBottom: '8px' }} />
                <TextArea rows={2} value={edu.description} onChange={(e) => updateEducation(i, { description: e.target.value })} placeholder="Honors, relevant coursework, thesis (optional)" />
                <Button
                  variant="ghost"
                  onClick={() => setProfile((p) => ({ ...p, education: p.education.filter((_, idx) => idx !== i) }))}
                  style={{ marginTop: '8px', marginBottom: 0 }}
                >
                  Remove
                </Button>
              </Card>
            ))}
            <Button
              variant="ghost"
              onClick={() => setProfile((p) => ({ ...p, education: [...p.education, { institution: '', degree: '', period: '', description: '' }] }))}
              style={{ marginBottom: 0 }}
            >
              + Add education
            </Button>
          </PanelCard>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={handleSave} disabled={stage === 'saving'} style={{ marginBottom: 0 }}>
              {stage === 'saving' ? 'Saving…' : 'Save profile'}
            </Button>
            <Button variant="ghost" onClick={() => setStage('paste')} disabled={stage === 'saving'} style={{ marginBottom: 0 }}>
              Start over
            </Button>
          </div>
        </>
      )}

      {stage === 'saved' && (
        <PanelCard>
          <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>Profile saved ✓</div>
          <div style={{ fontSize: '12px', color: '#6b665c', marginBottom: '12px' }}>
            Saved under {email}. You can paste more text to rebuild it, or move on to tailoring a CV.
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={() => navigate('/jobs')} style={{ marginBottom: 0 }}>
              Add a job to tailor for →
            </Button>
            <Button variant="ghost" onClick={() => setStage('paste')} style={{ marginBottom: 0 }}>
              Edit again
            </Button>
          </div>
        </PanelCard>
      )}
    </Shell>
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
