import React from 'react';
import { ModernTemplate } from './components/ModernTemplate';
import { CVEditor } from './components/CVEditor';
import { useCVStore } from './store/useCVStore';

export const App: React.FC = () => {
  const cv = useCVStore((state) => state.cv);

  return (
    <div
      style={{
        padding: '24px',
        background: '#f0ede6',
        minHeight: '100vh',
        display: 'flex',
        gap: '24px',
        alignItems: 'flex-start',
      }}
    >
      <CVEditor />
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <ModernTemplate cv={cv} />
      </div>
    </div>
  );
};
