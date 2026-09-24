import React from 'react';
import { CVData } from '../types';
import { Editable } from './editable';

interface Props {
  cv: CVData;
}

export const ModernTemplate: React.FC<Props> = ({ cv }) => {
  const c = cv.accentColor;

  return (
    <div
      className="cv-sheet"
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
      <div
        className="cv-no-break"
        style={{ background: c, padding: '36px 40px 30px', color: '#fff' }}
      >
        <div
          style={{
            fontSize: '34px',
            fontFamily: "'DM Serif Display', serif",
            letterSpacing: '-0.5px',
            marginBottom: '6px',
            lineHeight: 1.1,
          }}
        >
          <Editable as="div" field="name" value={cv.name || 'Your Name'} />
        </div>
        <div style={{ fontSize: '15px', fontWeight: 300, opacity: 0.85, marginBottom: '20px' }}>
          <Editable as="div" field="title" value={cv.title} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', fontSize: '11.5px', opacity: 0.8 }}>
          {cv.email && (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ marginRight: '4px' }}>✉</span>
              <Editable field="email" value={cv.email} />
            </span>
          )}
          {cv.phone && (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ marginRight: '4px' }}>✆</span>
              <Editable field="phone" value={cv.phone} />
            </span>
          )}
          {cv.location && (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ marginRight: '4px' }}>⊙</span>
              <Editable field="location" value={cv.location} />
            </span>
          )}
          {cv.website && (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ marginRight: '4px' }}>⊛</span>
              <Editable field="website" value={cv.website} />
            </span>
          )}
          {cv.linkedin && (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ marginRight: '4px' }}>in</span>
              <Editable field="linkedin" value={cv.linkedin} />
            </span>
          )}
        </div>
      </div>

      <div className="cv-columns" style={{ display: 'flex', flex: 1 }}>
        {/* Left column */}
        <div
          className="cv-column"
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
                  <div key={i} style={{ position: 'relative' }}>
                    <Editable
                      field={`skills.${i}.name`}
                      value={s.name}
                      as="div"
                      style={{ fontSize: '12px', color: '#3a3835', marginBottom: s.level ? '3px' : 0 }}
                    />
                    {s.level && (
                      <div style={{ height: '2px', background: '#e2dfd8', borderRadius: '2px' }}>
                        <div
                          style={{
                            height: '2px',
                            width: `${s.level * 10}%`,
                            background: c,
                            borderRadius: '2px',
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      data-remove-field={`skills.${i}`}
                      aria-label={`Remove skill ${s.name}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: '#9e9a91',
                        fontSize: '12px',
                        lineHeight: 1,
                        padding: '1px 2px',
                        borderRadius: '3px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cv.education.length > 0 && (
            <div className="cv-flow">
              <SectionLabel color={c}>Education</SectionLabel>
              <div className="cv-flow" style={{ marginTop: '10px' }}>
                {cv.education.map((edu, i) => (
                  <div key={edu.id} className="cv-no-break" style={{ position: 'relative', marginBottom: '16px' }}>
                    <Editable
                      field={`education.${i}.degree`}
                      value={edu.degree}
                      as="div"
                      style={{ fontSize: '12px', fontWeight: 500, color: '#1a1a18', lineHeight: 1.4 }}
                    />
                    <Editable
                      field={`education.${i}.institution`}
                      value={edu.institution}
                      as="div"
                      style={{ fontSize: '11px', color: '#6e6b63', marginTop: '2px' }}
                    />
                    <Editable
                      field={`education.${i}.period`}
                      value={edu.period}
                      as="div"
                      style={{ fontSize: '10px', color: '#9e9a91', marginTop: '2px' }}
                    />
                    <button
                      type="button"
                      data-remove-field={`education.${i}`}
                      aria-label={`Remove ${edu.degree || 'education'} entry`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: '#9e9a91',
                        fontSize: '12px',
                        lineHeight: 1,
                        padding: '1px 2px',
                        borderRadius: '3px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="cv-column" style={{ flex: 1, padding: '28px 32px' }}>
          {cv.summary && (
            <div style={{ marginBottom: '26px' }}>
              <SectionTitle color={c}>Profile</SectionTitle>
              <Editable
                field="summary"
                value={cv.summary}
                as="p"
                style={{ fontSize: '12.5px', lineHeight: 1.75, color: '#3a3835', marginTop: '10px', marginBottom: 0 }}
              />
            </div>
          )}

          {cv.experience.length > 0 && (
            <div className="cv-flow">
              <div style={{ marginBottom: '12px' }}>
                <SectionTitle color={c}>Experience</SectionTitle>
              </div>
{cv.experience.map((exp, i) => (
                  <div
                    key={exp.id}
                    className="cv-no-break"
                    style={{
                      position: 'relative',
                      marginBottom: '18px',
                      paddingBottom: i < cv.experience.length - 1 ? '18px' : 0,
                      borderBottom: i < cv.experience.length - 1 ? '1px solid #ece9e2' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div>
                        <Editable
                          field={`experience.${i}.role`}
                          value={exp.role}
                          as="div"
                          style={{ fontSize: '13.5px', fontWeight: 500 }}
                        />
                        <Editable
                          field={`experience.${i}.company`}
                          value={exp.company}
                          as="div"
                          style={{ fontSize: '12px', color: c, fontWeight: 500, marginTop: '1px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: '11px',
                            color: '#9e9a91',
                            whiteSpace: 'nowrap',
                            marginTop: '2px',
                          }}
                        >
                          <Editable field={`experience.${i}.period`} value={exp.period} />
                        </div>
                        <button
                          type="button"
                          data-remove-field={`experience.${i}`}
                          aria-label={`Remove ${exp.role || 'experience'} entry`}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            color: '#9e9a91',
                            fontSize: '12px',
                            lineHeight: 1,
                            padding: '1px 2px',
                            borderRadius: '3px',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {exp.description && (
                      <Editable
                        field={`experience.${i}.description`}
                        value={exp.description}
                        as="p"
                        style={{ fontSize: '12px', lineHeight: 1.7, color: '#5a5751', marginTop: '7px', marginBottom: 0 }}
                      />
                    )}
                  </div>
                ))}
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