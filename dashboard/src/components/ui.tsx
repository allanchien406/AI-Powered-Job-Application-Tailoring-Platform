import React from 'react';

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', margin: '18px 0 10px' }}>
    {children}
  </div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'block', marginBottom: '10px' }}>
    <div style={{ fontSize: '11px', color: '#6b665c', marginBottom: '6px' }}>{label}</div>
    {children}
  </label>
);

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    style={{
      width: '100%',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid #ded7c9',
      fontSize: '13px',
      background: '#fff',
      outline: 'none',
      ...(props.style || {}),
    }}
  />
);

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    style={{
      width: '100%',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid #ded7c9',
      fontSize: '13px',
      background: '#fff',
      outline: 'none',
      resize: 'vertical',
      ...(props.style || {}),
    }}
  />
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' }
> = ({ variant = 'solid', ...props }) => (
  <button
    {...props}
    style={{
      padding: '8px 12px',
      borderRadius: '8px',
      border: variant === 'ghost' ? '1px solid #e1dacc' : '1px solid #2c4a3e',
      background: variant === 'ghost' ? '#fff' : '#2c4a3e',
      color: variant === 'ghost' ? '#2c4a3e' : '#fff',
      fontSize: '12px',
      cursor: 'pointer',
      marginBottom: '12px',
      ...(props.style || {}),
    }}
  />
);

export const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      padding: '12px',
      border: '1px solid #ece6d8',
      borderRadius: '10px',
      background: '#fbfaf7',
      marginBottom: '12px',
    }}
  >
    {children}
  </div>
);

export const Tag: React.FC<{ children: React.ReactNode; onRemove: () => void }> = ({ children, onRemove }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 10px',
      background: '#f3efe7',
      borderRadius: '999px',
      fontSize: '12px',
      color: '#3a352b',
    }}
  >
    {children}
    <button
      type="button"
      onClick={onRemove}
      style={{
        border: 'none',
        background: 'transparent',
        color: '#7a6f5f',
        cursor: 'pointer',
        fontSize: '12px',
      }}
    >
      x
    </button>
  </span>
);
