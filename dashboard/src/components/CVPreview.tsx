import React from 'react';
import { CVData } from '../types';
import { DEFAULT_TEMPLATE_ID, getTemplate } from './templates';

/** A print-grade, scaled-down render of the full A4 template — used as
 * the "here's your finished CV" preview instead of a text dump. */
export const CVPreview: React.FC<{ cv: CVData; scale?: number; templateId?: string }> = ({
  cv,
  scale = 0.35,
  templateId = DEFAULT_TEMPLATE_ID,
}) => {
  const widthMm = Math.round(210 * scale * 10) / 10;
  const heightMm = Math.round(297 * scale * 10) / 10;
  const Template = getTemplate(templateId).component;

  return (
    <div
      className="mx-auto overflow-hidden rounded-lg border border-sand bg-white shadow-card"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: '210mm',
          height: '297mm',
        }}
      >
        <Template cv={cv} />
      </div>
    </div>
  );
};