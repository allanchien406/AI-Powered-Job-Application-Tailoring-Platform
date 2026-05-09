import React, { useState } from 'react';
import { useCVStore } from '../store/useCVStore';
import { SectionTitle, TextArea, Button, Card } from './ui';

interface AiCardProps {
  title: string;
  description: string;
  disabled?: boolean;
}

const AiCard: React.FC<AiCardProps> = ({ title, description, disabled }) => (
  <Card>
    <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a18', marginBottom: '4px' }}>
      {title}
    </div>
    <div style={{ fontSize: '11px', color: '#9e9a91', lineHeight: 1.5, marginBottom: '10px' }}>
      {description}
    </div>
    <div
      style={{
        fontSize: '12px',
        color: '#6b665c',
        background: '#f8f6f2',
        padding: '10px',
        borderRadius: '8px',
        marginBottom: '10px',
        lineHeight: 1.6,
        minHeight: '32px',
      }}
    >
      {disabled
        ? 'Not yet analyzed'
        : 'AI analysis will appear here once connected to the backend.'}
    </div>
    <Button disabled variant="ghost" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
      {disabled ? 'Coming soon' : 'Run'}
    </Button>
  </Card>
);

const aiTools: AiCardProps[] = [
  {
    title: 'Interviewer First Impressions',
    description:
      'What would an interviewer think at first glance? Analyzes tone, confidence, and impact of your summary and experience entries.',
  },
  {
    title: 'Readability Score',
    description:
      'Measures sentence complexity, jargon density, and overall clarity. Targets a Grade 10-12 reading level for broad appeal.',
  },
  {
    title: 'Job Alignment',
    description:
      'Compares your CV against the job description above. Highlights matching skills, experience gaps, and keyword coverage.',
    disabled: true,
  },
  {
    title: 'ATS Compatibility',
    description:
      'Checks if your CV structure and keywords will parse correctly through common applicant tracking systems.',
    disabled: true,
  },
  {
    title: 'Suggested Improvements',
    description:
      'Actionable edits to strengthen bullet points, add metrics, and rephrase passive language into active impact statements.',
    disabled: true,
  },
  {
    title: 'Cover Letter Draft',
    description:
      'Generates a tailored cover letter based on your CV and the target job description. Editable before export.',
    disabled: true,
  },
];

export const AISidebar: React.FC = () => {
  const toggleAISidebar = useCVStore((state) => state.toggleAISidebar);
  const [jobDescription, setJobDescription] = useState('');

  return (
    <div
      style={{
        width: '340px',
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: '#1a1a18',
          }}
        >
          AI Tools
        </div>
        <Button variant="ghost" onClick={toggleAISidebar} style={{ marginBottom: 0 }}>
          Hide
        </Button>
      </div>

      <SectionTitle>Job Context</SectionTitle>
      <TextArea
        placeholder="Paste a job description here to enable alignment checks..."
        value={jobDescription}
        onChange={(e) => setJobDescription(e.target.value)}
        rows={6}
      />

      <SectionTitle>Insights</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {aiTools.map((tool) => (
          <AiCard key={tool.title} {...tool} />
        ))}
      </div>
    </div>
  );
};
