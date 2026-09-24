import React from 'react';
import { CVData, EntrySection } from '../types';
import { Editable } from './editable';

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
      className="cv-sheet"
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
      <div
        className="cv-no-break"
        style={{ textAlign: 'center', padding: '34px 40px 20px', borderBottom: `2px solid ${c}` }}
      >
        <div
          style={{
            fontSize: '30px',
            fontFamily: "'DM Serif Display', serif",
            letterSpacing: '-0.5px',
            color: c,
            marginBottom: '6px',
          }}
        >
          <Editable as="div" field="name" value={cv.name || 'Your Name'} />
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
          <Editable field="location" value={cv.location} />
          <Editable field="phone" value={cv.phone} />
          <Editable field="email" value={cv.email} />
          {cv.website && <Editable field="website" value={cv.website.replace(/^https?:\/\//, '')} />}
        </div>
      </div>

      <div className="cv-flow" style={{ padding: '24px 40px 36px' }}>
        {cv.summary && (
          <Section title="Professional Summary" color={c}>
            <Editable
              field="summary"
              value={cv.summary}
              as="p"
              style={{ fontSize: '12.5px', lineHeight: 1.75, color: '#3a3835', margin: 0 }}
            />
          </Section>
        )}

        {cv.education.length > 0 && (
          <Section title="Education" color={c}>
            {cv.education.map((edu, i) => (
              <div key={edu.id} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                  <Editable
                    field={`education.${i}.degree`}
                    value={edu.degree}
                    as="div"
                    style={{ fontSize: '13px', fontWeight: 500 }}
                  />
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexShrink: 0 }}>
                    <Editable
                      field={`education.${i}.period`}
                      value={edu.period}
                      as="div"
                      style={{ fontSize: '11px', color: '#9e9a91', fontStyle: 'italic' }}
                    />
                    <button
                      type="button"
                      data-remove-field={`education.${i}`}
                      aria-label={`Remove ${edu.degree || 'education'} entry`}
                      style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: '#9e9a91',
                        fontSize: '12px',
                        lineHeight: 1,
                        padding: '1px 2px',
                        borderRadius: '3px',
                        alignSelf: 'center',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <Editable
                  field={`education.${i}.institution`}
                  value={edu.institution}
                  as="div"
                  style={{ fontSize: '12px', color: '#6e6b63', fontStyle: 'italic', marginTop: '1px' }}
                />
                {edu.coursework && (
                  <Editable
                    field={`education.${i}.coursework`}
                    value={`Relevant coursework: ${edu.coursework}`}
                    as="div"
                    style={{ fontSize: '11.5px', color: '#5a5751', marginTop: '4px', lineHeight: 1.6 }}
                  />
                )}
              </div>
            ))}
          </Section>
        )}

        {cv.skills.length > 0 && (
          <Section title="Technical Skills" color={c}>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {cv.skills.map((s, i) => (
                <li key={i} style={{ position: 'relative', fontSize: '12px', color: '#3a3835', lineHeight: 1.7 }}>
                  <Editable field={`skills.${i}.name`} value={s.name} />
                  <button
                    type="button"
                    data-remove-field={`skills.${i}`}
                    aria-label={`Remove skill ${s.name}`}
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '0',
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
                </li>
              ))}
            </ul>
          </Section>
        )}

        {cv.projects && cv.projects.length > 0 && (
          <Section title="Relevant Projects" color={c}>
            {cv.projects.map((p, i) => (
              <EntryBlock key={p.id} path={`projects.${i}`} entry={p} color={c} />
            ))}
          </Section>
        )}

        {cv.research && cv.research.length > 0 && (
          <Section title="Research Experience" color={c}>
            {cv.research.map((r, i) => (
              <EntryBlock key={r.id} path={`research.${i}`} entry={r} color={c} />
            ))}
          </Section>
        )}

        {cv.additional && cv.additional.length > 0 && (
          <Section title="Additional Projects" color={c}>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {cv.additional.map((a, i) => (
                <li key={i} style={{ position: 'relative', fontSize: '12px', color: '#3a3835', lineHeight: 1.7 }}>
                  <Editable field={`additional.${i}`} value={a} />
                  <button
                    type="button"
                    data-remove-field={`additional.${i}`}
                    aria-label={`Remove additional project ${a}`}
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '0',
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
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="References" color={c} noBorder>
          <Editable
            field="referencesNote"
            value={cv.referencesNote || 'Available upon request.'}
            as="p"
            style={{ fontSize: '12px', color: '#5a5751', margin: 0 }}
          />
        </Section>
      </div>
    </div>
  );
};

const EntryBlock: React.FC<{ path: string; entry: EntrySection; color: string }> = ({ path, entry, color }) => (
  <div style={{ position: 'relative', marginBottom: '16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
      <div style={{ fontSize: '13px', fontWeight: 500 }}>
        <Editable field={`${path}.title`} value={entry.title} />
        {entry.org && (
          <Editable
            field={`${path}.org`}
            value={` | ${entry.org}`}
            style={{ fontWeight: 400, color: '#6e6b63' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexShrink: 0 }}>
        {entry.period && (
          <Editable
            field={`${path}.period`}
            value={entry.period}
            as="div"
            style={{ fontSize: '11px', color: '#9e9a91', fontStyle: 'italic', whiteSpace: 'nowrap' }}
          />
        )}
        <button
          type="button"
          data-remove-field={path}
          aria-label={`Remove ${entry.title || 'entry'}`}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: '#9e9a91',
            fontSize: '12px',
            lineHeight: 1,
            padding: '1px 2px',
            borderRadius: '3px',
            alignSelf: 'center',
          }}
        >
          ✕
        </button>
      </div>
    </div>
    <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
      {entry.bullets.map((b, i) => (
        <Editable
          key={i}
          field={`${path}.bullets.${i}`}
          value={b}
          as="li"
          style={{ fontSize: '12px', lineHeight: 1.7, color: '#5a5751' }}
        />
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