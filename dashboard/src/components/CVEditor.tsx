import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { SectionTitle, Field, Input, TextArea, Button, Card, Tag } from './ui';
import { saveCv } from '../api/cvApi';

export const CVEditor: React.FC = () => {
  const navigate = useNavigate();
  const cv = useCVStore((state) => state.cv);
  const email = useCVStore((state) => state.email);
  const aiSidebarOpen = useCVStore((state) => state.aiSidebarOpen);
  const toggleAISidebar = useCVStore((state) => state.toggleAISidebar);
  const updateField = useCVStore((state) => state.updateField);
  const addExperience = useCVStore((state) => state.addExperience);
  const updateExperience = useCVStore((state) => state.updateExperience);
  const removeExperience = useCVStore((state) => state.removeExperience);
  const addEducation = useCVStore((state) => state.addEducation);
  const updateEducation = useCVStore((state) => state.updateEducation);
  const removeEducation = useCVStore((state) => state.removeEducation);
  const addSkill = useCVStore((state) => state.addSkill);
  const removeSkill = useCVStore((state) => state.removeSkill);

  const [newSkill, setNewSkill] = useState('');
  const [saving, setSaving] = useState(false);
  const [cvName, setCvName] = useState('');

  const handleSave = async () => {
    if (!cvName.trim()) return;
    setSaving(true);
    try {
      await saveCv(email, cvName.trim(), cv);
      setCvName('');
    } catch (err) {
      console.error('Failed to save CV:', err);
    } finally {
      setSaving(false);
    }
  };

  const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ display: 'flex', gap: '10px' }}>{children}</div>
  );

  const HalfField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label style={{ display: 'block', marginBottom: '10px', flex: 1 }}>
      <div style={{ fontSize: '11px', color: '#6b665c', marginBottom: '6px' }}>{label}</div>
      {children}
    </label>
  );

  return (
    <div
      style={{
        width: '360px',
        minWidth: '320px',
        maxHeight: 'calc(100vh - 48px)',
        overflow: 'auto',
        padding: '18px',
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e6e1d7',
        boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
      }}
    >
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <Button onClick={() => navigate('/my-cvs')}>My CVs</Button>
        <Button
          variant={aiSidebarOpen ? 'solid' : 'ghost'}
          onClick={toggleAISidebar}
        >
          AI
        </Button>
        <Button onClick={() => navigate('/')}>Logout</Button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        <Input
          placeholder="CV name..."
          value={cvName}
          onChange={(e) => setCvName(e.target.value)}
          style={{ marginBottom: 0 }}
        />
        <Button onClick={handleSave} style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
          {saving ? 'Saving...' : 'Save CV'}
        </Button>
      </div>

      <SectionTitle>Basics</SectionTitle>
      <Row>
        <HalfField label="Name">
          <Input value={cv.name} onChange={(e) => updateField('name', e.target.value)} />
        </HalfField>
        <HalfField label="Title">
          <Input value={cv.title} onChange={(e) => updateField('title', e.target.value)} />
        </HalfField>
      </Row>
      <Row>
        <HalfField label="Email">
          <Input value={cv.email} onChange={(e) => updateField('email', e.target.value)} />
        </HalfField>
        <HalfField label="Phone">
          <Input value={cv.phone} onChange={(e) => updateField('phone', e.target.value)} />
        </HalfField>
      </Row>
      <Field label="Location">
        <Input value={cv.location} onChange={(e) => updateField('location', e.target.value)} />
      </Field>
      <Row>
        <HalfField label="Website">
          <Input value={cv.website} onChange={(e) => updateField('website', e.target.value)} />
        </HalfField>
        <HalfField label="LinkedIn">
          <Input value={cv.linkedin} onChange={(e) => updateField('linkedin', e.target.value)} />
        </HalfField>
      </Row>
      <Field label="Accent Color">
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="color"
            value={cv.accentColor}
            onChange={(e) => updateField('accentColor', e.target.value)}
            style={{
              width: '40px',
              height: '34px',
              padding: 0,
              border: '1px solid #ded7c9',
              borderRadius: '8px',
              cursor: 'pointer',
              background: 'none',
            }}
          />
          <Input
            value={cv.accentColor}
            onChange={(e) => updateField('accentColor', e.target.value)}
            style={{ flex: 1, marginBottom: 0 }}
          />
        </div>
      </Field>

      <SectionTitle>Professional Summary</SectionTitle>
      <Field label="Summary">
        <TextArea value={cv.summary} onChange={(e) => updateField('summary', e.target.value)} rows={5} />
      </Field>

      <SectionTitle>Skills</SectionTitle>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <Input
          placeholder="Add a skill"
          value={newSkill}
          onChange={(e) => setNewSkill(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newSkill.trim()) {
              addSkill(newSkill.trim());
              setNewSkill('');
            }
          }}
        />
        <Button
          onClick={() => {
            if (newSkill.trim()) {
              addSkill(newSkill.trim());
              setNewSkill('');
            }
          }}
        >
          Add
        </Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {cv.skills.map((skill) => (
          <Tag key={skill} onRemove={() => removeSkill(skill)}>
            {skill}
          </Tag>
        ))}
      </div>

      <SectionTitle>Experience</SectionTitle>
      {cv.experience.map((exp) => (
        <Card key={exp.id}>
          <Field label="Role">
            <Input value={exp.role} onChange={(e) => updateExperience(exp.id, 'role', e.target.value)} />
          </Field>
          <Field label="Company">
            <Input value={exp.company} onChange={(e) => updateExperience(exp.id, 'company', e.target.value)} />
          </Field>
          <Field label="Period">
            <Input value={exp.period} onChange={(e) => updateExperience(exp.id, 'period', e.target.value)} />
          </Field>
          <Field label="Description">
            <TextArea
              value={exp.description}
              onChange={(e) => updateExperience(exp.id, 'description', e.target.value)}
              rows={3}
            />
          </Field>
          <Button variant="ghost" onClick={() => removeExperience(exp.id)}>
            Remove
          </Button>
        </Card>
      ))}
      <Button onClick={addExperience}>Add Experience</Button>

      <SectionTitle>Education</SectionTitle>
      {cv.education.map((edu) => (
        <Card key={edu.id}>
          <Field label="Degree">
            <Input value={edu.degree} onChange={(e) => updateEducation(edu.id, 'degree', e.target.value)} />
          </Field>
          <Field label="Institution">
            <Input value={edu.institution} onChange={(e) => updateEducation(edu.id, 'institution', e.target.value)} />
          </Field>
          <Field label="Period">
            <Input value={edu.period} onChange={(e) => updateEducation(edu.id, 'period', e.target.value)} />
          </Field>
          <Button variant="ghost" onClick={() => removeEducation(edu.id)}>
            Remove
          </Button>
        </Card>
      ))}
      <Button onClick={addEducation}>Add Education</Button>
    </div>
  );
};
