import React, { useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useCVStore } from '../store/useCVStore';
import { setFieldByPath, removeAtPath, pushArrayItem } from '../utils/cvEdits';
import { Field, Input, TextArea } from './ui';

/**
 * Live editable view of the selected CV. Every textbox is a controlled input
 * bound to the CV by a dot-path; each keystroke dispatches `updateCV`, which
 * persists the change and re-renders the preview pages on the right. Editing
 * there instead writes to the same store, so the two panels stay in sync.
 */
export const CVViewer: React.FC = () => {
  const cv = useCVStore((state) => state.viewerCv);
  const viewerMeta = useCVStore((state) => state.viewerMeta);
  const viewerCvId = useCVStore((state) => state.viewerCvId);
  const updateCV = useCVStore((state) => state.updateCV);

  const set = useCallback(
    (path: string, value: string) => {
      if (!viewerCvId) return;
      updateCV(viewerCvId, (draft) => setFieldByPath(draft, path, value));
    },
    [viewerCvId, updateCV],
  );

  const removeSkill = (i: number) => {
    if (!viewerCvId) return;
    updateCV(viewerCvId, (draft) => removeAtPath(draft, `skills.${i}`));
  };

  const addSkill = () => {
    if (!viewerCvId) return;
    updateCV(viewerCvId, (draft) => pushArrayItem(draft, 'skills', { name: '' }));
  };

  const setSkillLevel = useCallback(
    (i: number, raw: string) => {
      if (!viewerCvId) return;
      updateCV(viewerCvId, (draft) => {
        const entry = draft.skills[i];
        if (!entry) return;
        if (raw === '') {
          delete entry.level;
        } else {
          const level = Number(raw);
          if (Number.isInteger(level) && level >= 1 && level <= 10) entry.level = level;
        }
      });
    },
    [viewerCvId, updateCV],
  );

  const removeEntry = (list: string, i: number) => {
    if (!viewerCvId) return;
    updateCV(viewerCvId, (draft) => removeAtPath(draft, `${list}.${i}`));
  };

  const addExperience = () => {
    if (!viewerCvId) return;
    updateCV(viewerCvId, (draft) => {
      draft.experience.push({ id: uuid(), company: '', role: '', period: '', description: '' });
    });
  };

  const addEducation = () => {
    if (!viewerCvId) return;
    updateCV(viewerCvId, (draft) => {
      draft.education.push({ id: uuid(), institution: '', degree: '', period: '' });
    });
  };

  if (!cv || !viewerCvId) return null;

  return (
    <div className="w-[360px] min-w-[320px] self-start rounded-xl border border-sand bg-white p-[18px] shadow-card">
      <Section>Basics</Section>
      <Field label="Name">
        <Input value={cv.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="Title">
        <Input value={cv.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Email">
        <Input value={cv.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-x-2.5">
        <Field label="Phone">
          <Input value={cv.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={cv.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
      </div>
      <Field label="Website">
        <Input value={cv.website} onChange={(e) => set('website', e.target.value)} />
      </Field>
      <Field label="LinkedIn">
        <Input value={cv.linkedin} onChange={(e) => set('linkedin', e.target.value)} />
      </Field>

      <Section>Target job</Section>
      <Row label="Company">{viewerMeta?.companyName || '—'}</Row>
      <Row label="Title">{viewerMeta?.jobTitle || '—'}</Row>

      <Section>Professional Summary</Section>
      <Field label="Professional Summary">
        <TextArea
          rows={5}
          value={cv.summary}
          onChange={(e) => set('summary', e.target.value)}
          placeholder="Write a summary…"
        />
      </Field>

      <Section>Skills</Section>
      <div className="flex flex-col gap-1.5">
        {cv.skills.map((skill, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={skill.name}
              onChange={(e) => set(`skills.${i}.name`, e.target.value)}
              placeholder="Add a skill…"
              className="min-w-0 flex-1"
            />
            <select
              value={skill.level ?? ''}
              onChange={(e) => setSkillLevel(i, e.target.value)}
              aria-label={`Level for ${skill.name || 'skill'} ${i + 1}`}
              className="w-[66px] shrink-0 appearance-none rounded-lg border border-sand-dark bg-white px-1.5 py-2 text-center text-[13px] outline-none"
              title="Skill level — pick None to hide the bar"
            >
              <option value="">None</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove skill ${skill.name || i + 1}`}
              onClick={() => removeSkill(i)}
              className="shrink-0 cursor-pointer rounded-lg border border-sand-dark px-2 py-[7px] text-xs text-ink-muted transition-colors hover:border-note-error-border hover:text-note-error-text"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addSkill}
        className="mt-2 cursor-pointer rounded-lg border border-dashed border-forest/40 px-2.5 py-1.5 text-xs text-forest transition-colors hover:border-forest"
      >
        + Add skill
      </button>

      <Section>Experience</Section>
      {cv.experience.map((exp, i) => (
        <div key={exp.id} className="relative mb-4 rounded-lg border border-sand bg-cream/40 p-2.5">
          <button
            type="button"
            aria-label={`Remove ${exp.role || 'experience'} entry`}
            onClick={() => removeEntry('experience', i)}
            className="absolute right-1.5 top-1.5 cursor-pointer rounded-md border border-sand-dark px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-note-error-border hover:text-note-error-text"
          >
            ✕
          </button>
          <Field label="Role">
            <Input value={exp.role} onChange={(e) => set(`experience.${i}.role`, e.target.value)} />
          </Field>
          <Field label="Company">
            <Input value={exp.company} onChange={(e) => set(`experience.${i}.company`, e.target.value)} />
          </Field>
          <Field label="Period">
            <Input value={exp.period} onChange={(e) => set(`experience.${i}.period`, e.target.value)} />
          </Field>
          <Field label="Description">
            <TextArea rows={3} value={exp.description} onChange={(e) => set(`experience.${i}.description`, e.target.value)} />
          </Field>
        </div>
      ))}
      <button
        type="button"
        onClick={addExperience}
        className="mb-1 cursor-pointer rounded-lg border border-dashed border-forest/40 px-2.5 py-1.5 text-xs text-forest transition-colors hover:border-forest"
      >
        + Add experience
      </button>

      <Section>Education</Section>
      {cv.education.map((edu, i) => (
        <div key={edu.id} className="relative mb-4 rounded-lg border border-sand bg-cream/40 p-2.5">
          <button
            type="button"
            aria-label={`Remove ${edu.degree || 'education'} entry`}
            onClick={() => removeEntry('education', i)}
            className="absolute right-1.5 top-1.5 cursor-pointer rounded-md border border-sand-dark px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-note-error-border hover:text-note-error-text"
          >
            ✕
          </button>
          <Field label="Degree">
            <Input value={edu.degree} onChange={(e) => set(`education.${i}.degree`, e.target.value)} />
          </Field>
          <Field label="Institution">
            <Input value={edu.institution} onChange={(e) => set(`education.${i}.institution`, e.target.value)} />
          </Field>
          <Field label="Period">
            <Input value={edu.period} onChange={(e) => set(`education.${i}.period`, e.target.value)} />
          </Field>
        </div>
      ))}
      <button
        type="button"
        onClick={addEducation}
        className="cursor-pointer rounded-lg border border-dashed border-forest/40 px-2.5 py-1.5 text-xs text-forest transition-colors hover:border-forest"
      >
        + Add education
      </button>
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