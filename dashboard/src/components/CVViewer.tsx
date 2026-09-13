import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Button } from './ui';
import { exportToPDF } from '../utils/exportPDF';

export const CVViewer: React.FC = () => {
  const navigate = useNavigate();
  const cv = useCVStore((state) => state.viewerCv);
  const viewerMeta = useCVStore((state) => state.viewerMeta);
  const logout = useCVStore((state) => state.logout);

  const [exporting, setExporting] = useState(false);

  if (!cv) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportToPDF('cv-preview', 'tailored-cv');
    } catch (err) {
      console.error('Failed to export PDF:', err);
    } finally {
      setExporting(false);
    }
  };

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
        <Button onClick={() => navigate('/jobs')} style={{ marginBottom: 0 }}>
          My Jobs
        </Button>
        <Button onClick={handleExport} disabled={exporting} style={{ marginBottom: 0 }}>
          {exporting ? 'Exporting…' : 'Export PDF'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            logout();
            navigate('/');
          }}
          style={{ marginBottom: 0 }}
        >
          Logout
        </Button>
      </div>

      <Section>Basics</Section>
      <Row label="Name">{cv.name}</Row>
      <Row label="Title">{cv.title}</Row>
      <Row label="Email">{cv.email}</Row>

      <Section>Target job</Section>
      <Row label="Company">{viewerMeta?.companyName || '—'}</Row>
      <Row label="Title">{viewerMeta?.jobTitle || '—'}</Row>

      <Section>Professional Summary</Section>
      <p style={{ fontSize: '12px', lineHeight: 1.7, color: '#3a352b', marginTop: '4px' }}>
        {cv.summary}
      </p>

      <Section>Skills</Section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {cv.skills.map((skill) => (
          <span
            key={skill}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 10px',
              background: '#f3efe7',
              borderRadius: '999px',
              fontSize: '12px',
              color: '#3a352b',
            }}
          >
            {skill}
          </span>
        ))}
      </div>

      <Section>Experience</Section>
      {cv.experience.map((exp) => (
        <div key={exp.id} style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500 }}>{exp.role}</div>
          <div style={{ fontSize: '11px', color: '#6b665c', marginTop: '2px' }}>
            {exp.company}
            {exp.period ? ` · ${exp.period}` : ''}
          </div>
          {exp.description && (
            <p style={{ fontSize: '12px', lineHeight: 1.6, color: '#5a5751', margin: '6px 0 0' }}>
              {exp.description}
            </p>
          )}
        </div>
      ))}

      <Section>Education</Section>
      {cv.education.map((edu) => (
        <div key={edu.id} style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 500 }}>{edu.degree}</div>
          <div style={{ fontSize: '11px', color: '#6b665c', marginTop: '2px' }}>
            {edu.institution}
            {edu.period ? ` · ${edu.period}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
};

const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize: '12px',
      fontWeight: 600,
      letterSpacing: '0.08em',
      color: '#1a1a18',
      margin: '18px 0 10px',
    }}
  >
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: '10px' }}>
    <div style={{ fontSize: '11px', color: '#6b665c', marginBottom: '2px' }}>{label}</div>
    <div style={{ fontSize: '13px', color: '#1a1a18' }}>{children}</div>
  </div>
);