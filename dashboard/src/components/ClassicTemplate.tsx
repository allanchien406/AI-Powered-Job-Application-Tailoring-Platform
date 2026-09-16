import React from 'react';
import { CVData } from '../types';

interface Props {
  cv: CVData;
}

/**
 * ============================================================
 * GUIDANCE FOR IMPLEMENTING THIS TEMPLATE — replace this file's
 * body with your own design. This stub only exists so the
 * template picker has a second working option to switch to.
 * ============================================================
 *
 * What this component receives:
 *   `cv: CVData` (see ../types.ts) — already-generated, ready-to-render
 *   content. Don't fetch or transform anything here, just lay it out.
 *   Fields: name, title, email, phone, location, website, linkedin,
 *   summary, skills (string[]), experience (ExperienceEntry[]),
 *   education (EducationEntry[]), accentColor (a hex string the user
 *   picked — ModernTemplate uses it for headings/accents; use it or not,
 *   your call).
 *
 * Contract to keep (both consumers below depend on it):
 *   - Same `Props { cv: CVData }` shape — don't add required props.
 *   - Root element should size itself for print: ModernTemplate uses
 *     `width: 210mm; minHeight: 297mm` (A4) as its top-level style — match
 *     that so the PDF export (`utils/exportPDF.ts`, which snapshots the
 *     `#cv-preview` DOM node) and the scaled-down thumbnail
 *     (`components/CVPreview.tsx`, which renders this same component at
 *     `transform: scale(0.35)`) both work without extra plumbing.
 *   - Handle empty/missing fields gracefully (e.g. `cv.website` may be
 *     `''`) — see how ModernTemplate guards each optional field with
 *     `cv.website && ...` before rendering it.
 *
 * Where to look for a working example: ./ModernTemplate.tsx renders every
 * field this stub needs to cover — same data, different layout. Copy its
 * structure, not its exact visual style.
 *
 * Once you're happy with it, there's nothing else to wire up — it's
 * already registered in ./templates.ts and selectable from the picker
 * in CVBuilderPage.
 */
export const ClassicTemplate: React.FC<Props> = ({ cv }) => {
  return (
    <div
      style={{
        width: '210mm',
        minHeight: '297mm',
        background: '#fff',
        padding: '40px',
        fontFamily: 'serif',
        color: '#1a1a18',
      }}
    >
      {/* TODO: replace this placeholder with your own Classic-style layout. */}
      <h1>{cv.name || 'Your Name'}</h1>
      <p>{cv.title}</p>
      <p>{cv.summary}</p>
    </div>
  );
};
