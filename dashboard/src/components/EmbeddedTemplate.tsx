 import React from 'react';
import { CVData, EntrySection } from '../types';

interface Props {
  cv: CVData;
}

/**
 * Single-column, section-based template (navy accent, DM Serif header).
 * Mirrors the structure of Allan's docx CV: Summary, Education, Skills,
 * Projects, Research Experience, Additional Projects, References.
 *
 * Reads `cv.projects` / `cv.research` (EntrySection[], defined in
 * ../types.ts) instead of the flat `cv.experience` list the other
 * templates use — generatedCvToCVData (utils/cv.ts) derives them by
 * splitting `experience` on whether `company` is "Not specified" (the
 * signal tailoring-service leaves on merged-in projects). `additional`
 * and `referencesNote` have no generator yet, so those sections render
 * empty/fallback until something populates them.
 */

export const EmbeddedTemplate: React.FC<Props> = ({ cv }) => {
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
        padding: '0',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', padding: '34px 40px 20px', borderBottom: `2px solid ${c}` }}>
        <div
          style={{
            fontSize: '30px',
            fontFamily: "'DM Serif Display', serif",
            letterSpacing: '-0.5px',
            color: c,
            marginBottom: '6px',
          }}
        >
          {cv.name || 'Your Name'}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '4px 16px',
            fontSize: '11.5px',
            color: '#6e6b63',
          }}
        >
          {cv.location && <span>{cv.location}</span>}
          {cv.phone && <span>{cv.phone}</span>}
          {cv.email && <span>{cv.email}</span>}
          {cv.website && (
            <a href={cv.website} style={{ color: '#1155CC', textDecoration: 'underline' }}>
              {cv.website.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 40px 36px' }}>
        {cv.summary && (
          <Section title="Professional Summary" color={c}>
            <p style={{ fontSize: '12.5px', lineHeight: 1.75, color: '#3a3835', margin: 0 }}>{cv.summary}</p>
          </Section>
        )}

        {cv.education.length > 0 && (
          <Section title="Education" color={c}>
            {cv.education.map((edu) => (
              <div key={edu.id} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{edu.degree}</div>
                  <div style={{ fontSize: '11px', color: '#9e9a91', fontStyle: 'italic' }}>{edu.period}</div>
                </div>
                <div style={{ fontSize: '12px', color: '#6e6b63', fontStyle: 'italic', marginTop: '1px' }}>
                  {edu.institution}
                </div>
                {edu.coursework && (
                  <div style={{ fontSize: '11.5px', color: '#5a5751', marginTop: '4px', lineHeight: 1.6 }}>
                    Relevant coursework: {edu.coursework}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {cv.skills.length > 0 && (
          <Section title="Technical Skills" color={c}>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {cv.skills.map((s, i) => (
                <li key={i} style={{ fontSize: '12px', color: '#3a3835', lineHeight: 1.7 }}>
                  {s}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {cv.projects && cv.projects.length > 0 && (
          <Section title="Relevant Projects" color={c}>
            {cv.projects.map((p) => (
              <EntryBlock key={p.id} entry={p} color={c} />
            ))}
          </Section>
        )}

        {cv.research && cv.research.length > 0 && (
          <Section title="Research Experience" color={c}>
            {cv.research.map((r) => (
              <EntryBlock key={r.id} entry={r} color={c} />
            ))}
          </Section>
        )}

        {cv.additional && cv.additional.length > 0 && (
          <Section title="Additional Projects" color={c}>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {cv.additional.map((a, i) => (
                <li key={i} style={{ fontSize: '12px', color: '#3a3835', lineHeight: 1.7 }}>
                  {a}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="References" color={c} noBorder>
          <p style={{ fontSize: '12px', color: '#5a5751', margin: 0 }}>
            {cv.referencesNote || 'Available upon request.'}
          </p>
        </Section>
      </div>
    </div>
  );
};

const EntryBlock: React.FC<{ entry: EntrySection; color: string }> = ({ entry, color }) => (
  <div style={{ marginBottom: '16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <div style={{ fontSize: '13px', fontWeight: 500 }}>
        {entry.title}
        {entry.org && (
          <span style={{ fontWeight: 400, color: '#6e6b63' }}> &nbsp;|&nbsp; {entry.org}</span>
        )}
      </div>
      {entry.period && (
        <div style={{ fontSize: '11px', color: '#9e9a91', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
          {entry.period}
        </div>
      )}
    </div>
    <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
      {entry.bullets.map((b, i) => (
        <li key={i} style={{ fontSize: '12px', lineHeight: 1.7, color: '#5a5751' }}>
          {b}
        </li>
      ))}
    </ul>
  </div>
);

const Section: React.FC<{ title: string; color: string; noBorder?: boolean; children: React.ReactNode }> = ({
  title,
  color,
  noBorder,
  children,
}) => (
  <div style={{ marginBottom: '22px' }}>
    <div
      style={{
        fontSize: '10.5px',
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color,
        paddingBottom: '5px',
        marginBottom: '10px',
        borderBottom: noBorder ? 'none' : `1px solid ${color}`,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);
