import React from 'react';
import { useCVStore } from '../store/useCVStore';

export const CVViewer: React.FC = () => {
  const cv = useCVStore((state) => state.viewerCv);
  const viewerMeta = useCVStore((state) => state.viewerMeta);

  if (!cv) return null;

  return (
    <div className="w-[360px] min-w-[320px] self-start rounded-xl border border-sand bg-white p-[18px] shadow-card">
      <Section>Basics</Section>
      <Row label="Name">{cv.name}</Row>
      <Row label="Title">{cv.title}</Row>
      <Row label="Email">{cv.email}</Row>

      <Section>Target job</Section>
      <Row label="Company">{viewerMeta?.companyName || '—'}</Row>
      <Row label="Title">{viewerMeta?.jobTitle || '—'}</Row>

      <Section>Professional Summary</Section>
      <p className="mt-1 text-xs leading-[1.7] text-[#3a352b]">{cv.summary}</p>

      <Section>Skills</Section>
      <div className="flex flex-wrap gap-2">
        {cv.skills.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center rounded-full bg-cream px-2.5 py-1.5 text-xs text-[#3a352b]"
          >
            {skill}
          </span>
        ))}
      </div>

      <Section>Experience</Section>
      {cv.experience.map((exp) => (
        <div key={exp.id} className="mb-3.5">
          <div className="text-[13px] font-medium">{exp.role}</div>
          <div className="mt-0.5 text-[11px] text-ink-soft">
            {exp.company}
            {exp.period ? ` · ${exp.period}` : ''}
          </div>
          {exp.description && (
            <p className="mt-1.5 text-xs leading-[1.6] text-[#5a5751]">{exp.description}</p>
          )}
        </div>
      ))}

      <Section>Education</Section>
      {cv.education.map((edu) => (
        <div key={edu.id} className="mb-3">
          <div className="text-xs font-medium">{edu.degree}</div>
          <div className="mt-0.5 text-[11px] text-ink-soft">
            {edu.institution}
            {edu.period ? ` · ${edu.period}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
};

const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-[10px] mt-[18px] text-xs font-semibold tracking-[0.08em] text-ink">
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="mb-[10px]">
    <div className="mb-0.5 text-[11px] text-ink-soft">{label}</div>
    <div className="text-[13px] text-ink">{children}</div>
  </div>
);