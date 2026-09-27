import { CVData } from '../types';

/**
 * Dot-path addressing into a CV so text sections can be edited individually
 * and reached from either the preview frames or the left form panel:
 *
 *   "name", "summary", "skills.0", "experience.2.role",
 *   "education.1.institution", "projects.0.bullets.2"
 *
 * Numeric segments index arrays. Designed to mutate an immer draft (see
 * `updateCV` in useCVStore.ts) or a plain mutable JS object.
 */
export function setFieldByPath(target: CVData, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return;

  let cursor: unknown = target as unknown;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = (cursor as Record<string, unknown>)?.[seg];
    if (next === undefined || next === null || typeof next !== 'object') {
      // Materialize a missing node so late-created fields (e.g. a contact
      // keystroked into an empty section) still land in the right shape.
      (cursor as Record<string, unknown>)[seg] = {};
    }
    cursor = (cursor as Record<string, unknown>)[seg];
  }

  const last = segments[segments.length - 1];
  if (cursor === undefined || cursor === null || typeof cursor !== 'object') return;
  const record = cursor as Record<string, unknown>;

  if (/^\d+$/.test(last) && Array.isArray(cursor)) {
    const idx = Number(last);
    if (idx >= (cursor as unknown[]).length) (cursor as unknown[]).push(value);
    else (cursor as unknown[])[idx] = value;
  } else {
    record[last] = value;
  }
}

/** Read a value back out of a CV by its dot path (for verification tooling). */
export function getFieldByPath(target: CVData, path: string): unknown {
  return pathPtr(target, path.split('.').filter(Boolean));
}

/** Navigate an existing object/array trail; returns undefined on a missing segment. */
function pathPtr(target: unknown, segments: string[]): unknown {
  let cursor: unknown = target;
  for (const seg of segments) {
    if (cursor === undefined || cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/** Remove an array element at a dot path ending in a numeric index, e.g.
 * `removeAtPath(draft, 'skills.2')`. No-op if the path doesn't resolve. */
export function removeAtPath(target: CVData, path: string): void {
  const segments = path.split('.').filter(Boolean);
  const indexSeg = segments[segments.length - 1];
  if (!/^\d+$/.test(indexSeg)) return;
  const parent = pathPtr(target, segments.slice(0, -1));
  if (!Array.isArray(parent)) return;
  const idx = Number(indexSeg);
  if (idx >= 0 && idx < parent.length) parent.splice(idx, 1);
}

/** Append an item to the array at `arrayPath` (e.g. `'skills'`), creating the
 * array if it doesn't exist yet. */
export function pushArrayItem<T>(target: CVData, arrayPath: string, value: T): void {
  const segments = arrayPath.split('.').filter(Boolean);
  if (segments.length === 0) return;
  const existing = pathPtr(target, segments);
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  const parent = pathPtr(target, segments.slice(0, -1));
  const key = segments[segments.length - 1];
  if (parent !== undefined && parent !== null && typeof parent === 'object' && key) {
    (parent as Record<string, unknown>)[key] = [value];
  }
}