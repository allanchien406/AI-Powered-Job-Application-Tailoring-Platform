import React from 'react';
import { CVData } from '../types';

interface Props {
  cv: CVData;
}

export const ModernTemplate: React.FC<Props> = ({ cv }) => {
  const c = cv.accentColor;

  return (
    <div
      style={{
        width: '210mm',
        minHeight: '297mm',
        background: '#fff',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '13px',
        color: '#1a1a18',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ background: c, padding: '36px 40px 30px', color: '#fff' }}>
        <div
          style={{
            fontSize: '34px',
            fontFamily: "'DM Serif Display', serif",
            letterSpacing: '-0.5px',
            marginBottom: '6px',
            lineHeight: 1.1,
          }}
        >
          {cv.name || 'Your Name'}
        </div>
        <div style={{ fontSize: '15px', fontWeight: 300, opacity: 0.85, marginBottom: '20px' }}>
          {cv.title}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', fontSize: '11.5px', opacity: 0.8 }}>
          {cv.email && <span>✉ {cv.email}</span>}
          {cv.phone && <span>✆ {cv.phone}</span>}
          {cv.location && <span>⊙ {cv.location}</span>}
          {cv.website && <span>⊛ {cv.website}</span>}
          {cv.linkedin && <span>in {cv.linkedin}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* Left column */}
        <div
          style={{
            width: '195px',
            flexShrink: 0,
            background: '#f8f6f2',
            padding: '28px 20px',
            borderRight: '1px solid #ece9e2',
          }}
        >
          {cv.skills.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <SectionLabel color={c}>Skills</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '10px' }}>
                {cv.skills.map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '12px', color: '#3a3835', marginBottom: '3px' }}>{s}</div>
                    <div style={{ height: '2px', background: '#e2dfd8', borderRadius: '2px' }}>
                      <div
                        style={{
                          height: '2px',
                          width: `${65 + (i * 11) % 35}%`,
                          background: c,
                          borderRadius: '2px',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cv.education.length > 0 && (
            <div>
              <SectionLabel color={c}>Education</SectionLabel>
              <div style={{ marginTop: '10px' }}>
                {cv.education.map((edu) => (
                  <div key={edu.id} style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#1a1a18', lineHeight: 1.4 }}>
                      {edu.degree}
                    </div>
                    <div style={{ fontSize: '11px', color: '#6e6b63', marginTop: '2px' }}>{edu.institution}</div>
                    <div style={{ fontSize: '10px', color: '#9e9a91', marginTop: '2px' }}>{edu.period}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: '28px 32px' }}>
          {cv.summary && (
            <div style={{ marginBottom: '26px' }}>
              <SectionTitle color={c}>Profile</SectionTitle>
              <p style={{ fontSize: '12.5px', lineHeight: 1.75, color: '#3a3835', marginTop: '10px' }}>
                {cv.summary}
              </p>
            </div>
          )}

          {cv.experience.length > 0 && (
            <div>
              <SectionTitle color={c}>Experience</SectionTitle>
              <div style={{ marginTop: '12px' }}>
                {cv.experience.map((exp, i) => (
                  <div
                    key={exp.id}
                    style={{
                      marginBottom: '18px',
                      paddingBottom: i < cv.experience.length - 1 ? '18px' : 0,
                      borderBottom: i < cv.experience.length - 1 ? '1px solid #ece9e2' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 500 }}>{exp.role}</div>
                        <div style={{ fontSize: '12px', color: c, fontWeight: 500, marginTop: '1px' }}>
                          {exp.company}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#9e9a91',
                          whiteSpace: 'nowrap',
                          marginLeft: '12px',
                          marginTop: '2px',
                        }}
                      >
                        {exp.period}
                      </div>
                    </div>
                    {exp.description && (
                      <p style={{ fontSize: '12px', lineHeight: 1.7, color: '#5a5751', marginTop: '7px' }}>
                        {exp.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div
    style={{
      fontSize: '9px',
      fontWeight: 500,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color,
    }}
  >
    {children}
  </div>
);

const SectionTitle: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div
    style={{
      fontSize: '9px',
      fontWeight: 500,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color,
      paddingBottom: '6px',
      borderBottom: `2px solid ${color}`,
    }}
  >
    {children}
  </div>
);