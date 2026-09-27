import { describe, expect, it } from 'vitest';
import { getFieldByPath, pushArrayItem, removeAtPath, setFieldByPath } from './cvEdits';
import type { CVData } from '../types';

const base = (): CVData => ({
  name: 'Alex Rivera',
  title: 'Senior Engineer',
  email: 'a@example.com',
  phone: '',
  location: '',
  website: '',
  linkedin: '',
  summary: 'Short.',
  experience: [
    { id: 'e1', company: 'Acme', role: 'Engineer', period: '2020-2021', description: 'A.' },
    { id: 'e2', company: 'Beta', role: 'Engineer', period: '2021-2023', description: 'B.' },
  ],
  education: [{ id: 'd1', institution: 'UT', degree: 'BS', period: '2012-2016' }],
  skills: [{ name: 'Go' }, { name: 'Kafka' }],
  accentColor: '#2c4a3e',
});

describe('setFieldByPath', () => {
  it('sets a top-level string field', () => {
    const cv = base();
    setFieldByPath(cv, 'summary', 'Longer summary.');
    expect(cv.summary).toBe('Longer summary.');
  });

  it('sets an array element by index', () => {
    const cv = base();
    setFieldByPath(cv, 'skills.0.name', 'Rust');
    expect(cv.skills).toEqual([{ name: 'Rust' }, { name: 'Kafka' }]);
  });

  it('sets an optional skill level by path', () => {
    const cv = base();
    setFieldByPath(cv, 'skills.1.level', 7);
    expect(cv.skills[1].level).toBe(7);
  });

  it('sets a deeply nested field', () => {
    const cv = base();
    setFieldByPath(cv, 'experience.1.description', 'B2.');
    expect(cv.experience[1].description).toBe('B2.');
  });

  it('materializes a missing object node, e.g. an empty experience entry', () => {
    const cv = base();
    cv.experience.push({ id: 'e3' } as never);
    setFieldByPath(cv, 'experience.2.role', 'Missing role');
    expect((cv.experience[2] as Record<string, unknown>).role).toBe('Missing role');
    expect(cv.experience).toHaveLength(3);
  });

  it('appends when the numeric index is out of range', () => {
    const cv = base();
    setFieldByPath(cv, 'skills.2.name', 'New one');
    expect(cv.skills).toHaveLength(3);
    expect(cv.skills[2]).toMatchObject({ name: 'New one' });
  });
});

describe('getFieldByPath', () => {
  it('round-trips values set by path', () => {
    const cv = base();
    setFieldByPath(cv, 'experience.0.company', 'Widgets');
    expect(getFieldByPath(cv, 'experience.0.company')).toBe('Widgets');
    expect(getFieldByPath(cv, 'name')).toBe('Alex Rivera');
  });

  it('returns undefined for a missing path', () => {
    expect(getFieldByPath(base(), 'projects.0.title')).toBeUndefined();
  });
});

describe('removeAtPath', () => {
  it('removes the indexed element and shifts the rest', () => {
    const cv = base();
    removeAtPath(cv, 'skills.0');
    expect(cv.skills).toEqual([{ name: 'Kafka' }]);
  });

  it('re-indexes effectively via subsequent paths', () => {
    const cv = base();
    removeAtPath(cv, 'experience.0');
    expect(cv.experience[0].role).toBe('Engineer');
    expect(cv.experience).toHaveLength(1);
  });

  it('is a no-op for a path that does not resolve', () => {
    const cv = base();
    removeAtPath(cv, 'skills.9');
    expect(cv.skills).toHaveLength(2);
    removeAtPath(cv, 'name'); // not an array index
    expect(cv.name).toBe('Alex Rivera');
  });
});

describe('pushArrayItem', () => {
  it('appends to an existing array', () => {
    const cv = base();
    pushArrayItem(cv, 'skills', { name: 'Rust' });
    expect(cv.skills).toEqual([{ name: 'Go' }, { name: 'Kafka' }, { name: 'Rust' }]);
  });

  it('creates the array when the key is missing', () => {
    const cv = base();
    pushArrayItem(cv, 'projects', { id: 'p1', title: 'P' } as never);
    expect(cv.projects).toHaveLength(1);
    expect(cv.projects?.[0]).toMatchObject({ title: 'P' });
  });

  it('is a no-op for an empty path', () => {
    const cv = base();
    pushArrayItem(cv, '', 'x');
    expect(cv.skills).toHaveLength(2);
  });
});