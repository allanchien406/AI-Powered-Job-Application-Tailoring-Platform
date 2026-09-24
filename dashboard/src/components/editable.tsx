import React from 'react';

type EditableTag = 'div' | 'span' | 'p' | 'li';

interface EditableProps {
  /** Dot path into CVData that this text maps to, e.g. "experience.2.role". */
  field: string;
  value?: string;
  as?: EditableTag;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * A text node rendered as a contentEditablespan. The template renders this
 * normally inside its measurer pass; when PaginatedCV clones the DOM into the
 * A4 page frames the `data-field` attribute and contentEditable flag carry
 * over, and its delegated listeners read `textContent` back out on every
 * `input` event and write it to the store via `onEdit(path, value)`. The same
 * `field` path drives the corresponding textbox in CVViewer, which is what
 * makes the two sides stay in sync.
 */
export const Editable: React.FC<EditableProps> = ({
  field,
  value = '',
  as = 'span',
  style,
  className,
}) => {
  const Tag = as;
  return (
    <Tag
      data-field={field}
      contentEditable
      suppressContentEditableWarning
      className={className}
      // Keep literal newlines as forced breaks so text read back with the
      // browser's own line breaks (see PaginatedCV's `innerText` read) renders
      // and measures identically in the measurer pass and the page frames.
      style={{ whiteSpace: 'pre-wrap', ...style }}
    >
      {value}
    </Tag>
  );
};