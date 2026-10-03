import React from 'react';
import { CVData } from '../types';
import { ModernTemplate } from './ModernTemplate';
import { ClassicTemplate } from './ClassicTemplate';
import { EmbeddedTemplate } from './EmbeddedTemplate';

export interface CVTemplate {
  id: string;
  label: string;
  component: React.FC<{ cv: CVData }>;
}

/** Add a new template by adding its file (copy ClassicTemplate.tsx's shape)
 * and registering it here — CVBuilderPage's picker and CVPreview both read
 * from this list, nothing else needs to change. */
export const TEMPLATES: CVTemplate[] = [
  { id: 'modern', label: 'Modern', component: ModernTemplate },
  { id: 'classic', label: 'Classic', component: ClassicTemplate },
  { id: 'embedded', label: 'Embedded', component: EmbeddedTemplate },
];

export const DEFAULT_TEMPLATE_ID = TEMPLATES[0].id;

export function getTemplate(id: string | undefined | null): CVTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
