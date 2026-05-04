import React, { useState } from 'react';
import { useCVStore } from '../store/useCVStore';

export const CVEditor: React.FC = () => {
  const cv = useCVStore((state) => state.cv);
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
      <SectionTitle>Basics</SectionTitle>
      <Field label="Name">
        <Input value={cv.name} onChange={(e) => updateField('name', e.target.value)} />
      </Field>
      <Field label="Title">
        <Input value={cv.title} onChange={(e) => updateField('title', e.target.value)} />
      </Field>
      <Field label="Email">
        <Input value={cv.email} onChange={(e) => updateField('email', e.target.value)} />
      </Field>
      <Field label="Phone">
        <Input value={cv.phone} onChange={(e) => updateField('phone', e.target.value)} />
      </Field>
      <Field label="Location">
        <Input value={cv.location} onChange={(e) => updateField('location', e.target.value)} />
      </Field>
      <Field label="Website">
        <Input value={cv.website} onChange={(e) => updateField('website', e.target.value)} />
      </Field>
      <Field label="LinkedIn">
        <Input value={cv.linkedin} onChange={(e) => updateField('linkedin', e.target.value)} />
      </Field>
      <Field label="Accent Color">
        <Input value={cv.accentColor} onChange={(e) => updateField('accentColor', e.target.value)} />
      </Field>
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

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', margin: '18px 0 10px' }}>
    {children}
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'block', marginBottom: '10px' }}>
    <div style={{ fontSize: '11px', color: '#6b665c', marginBottom: '6px' }}>{label}</div>
    {children}
  </label>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    style={{
      width: '100%',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid #ded7c9',
      fontSize: '13px',
      background: '#fff',
      outline: 'none',
    }}
  />
);

const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    style={{
      width: '100%',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid #ded7c9',
      fontSize: '13px',
      background: '#fff',
      outline: 'none',
      resize: 'vertical',
    }}
  />
);

const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' }
> = ({ variant = 'solid', ...props }) => (
  <button
    {...props}
    style={{
      padding: '8px 12px',
      borderRadius: '8px',
      border: variant === 'ghost' ? '1px solid #e1dacc' : '1px solid #2c4a3e',
      background: variant === 'ghost' ? '#fff' : '#2c4a3e',
      color: variant === 'ghost' ? '#2c4a3e' : '#fff',
      fontSize: '12px',
      cursor: 'pointer',
      marginBottom: '12px',
    }}
  />
);

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      padding: '12px',
      border: '1px solid #ece6d8',
      borderRadius: '10px',
      background: '#fbfaf7',
      marginBottom: '12px',
    }}
  >
    {children}
  </div>
);

const Tag: React.FC<{ children: React.ReactNode; onRemove: () => void }> = ({ children, onRemove }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 10px',
      background: '#f3efe7',
      borderRadius: '999px',
      fontSize: '12px',
      color: '#3a352b',
    }}
  >
    {children}
    <button
      type="button"
      onClick={onRemove}
      style={{
        border: 'none',
        background: 'transparent',
        color: '#7a6f5f',
        cursor: 'pointer',
        fontSize: '12px',
      }}
    >
      x
    </button>
  </span>
);
