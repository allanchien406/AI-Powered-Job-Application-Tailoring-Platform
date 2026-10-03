import React, { useState } from 'react';

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-[10px] mt-[18px] text-xs font-semibold tracking-[0.08em]">{children}</div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className,
}) => (
  <label className={`mb-[10px] block ${className || ''}`}>
    <div className="mb-1.5 text-[11px] text-ink-soft">{label}</div>
    {children}
  </label>
);

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={`w-full rounded-lg border border-sand-dark bg-white px-2.5 py-2 text-[13px] outline-none ${props.className || ''}`}
  />
);

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    className={`w-full resize-y rounded-lg border border-sand-dark bg-white px-2.5 py-2 text-[13px] outline-none ${props.className || ''}`}
  />
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' }
> = ({ variant = 'solid', className = '', ...props }) => (
  <button
    {...props}
    className={[
      'cursor-pointer rounded-lg border px-3 py-2 text-xs transition-colors',
      'disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'ghost'
        ? 'border-sand bg-white text-forest'
        : 'border-forest bg-forest text-white',
      className,
    ].join(' ')}
  />
);

export const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-3 rounded-[10px] border border-sand bg-eggshell p-3">{children}</div>
);

export const PanelCard: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={`mb-4 rounded-2xl border border-sand bg-white p-6 shadow-card ${className || ''}`}>
    {children}
  </div>
);

export type NoticeTone = 'error' | 'info' | 'success';

const NOTICE_CLASSES: Record<NoticeTone, string> = {
  error: 'border-note-error-border bg-note-error-bg text-note-error-text',
  info: 'border-note-info-border bg-note-info-bg text-note-info-text',
  success: 'border-note-success-border bg-note-success-bg text-note-success-text',
};

export const Notice: React.FC<{ tone?: NoticeTone; children: React.ReactNode }> = ({
  tone = 'error',
  children,
}) => (
  <div className={`mb-3.5 rounded-lg border p-2.5 text-xs ${NOTICE_CLASSES[tone]}`}>{children}</div>
);

export const Collapsible: React.FC<{
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-xs font-semibold tracking-[0.08em] text-ink"
      >
        <span>
          {title}
          {count !== undefined ? ` (${count})` : ''}
        </span>
        <span className="text-sm text-ink-muted">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
};

export const Tag: React.FC<{ children: React.ReactNode; onRemove: () => void }> = ({ children, onRemove }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1.5 text-xs text-[#3a352b]">
    {children}
    <button
      type="button"
      aria-label="Remove"
      onClick={onRemove}
      className="cursor-pointer border-0 bg-transparent px-0.5 py-1 text-xs text-[#7a6f5f]"
    >
      x
    </button>
  </span>
);