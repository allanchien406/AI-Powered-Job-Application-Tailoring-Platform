import React from 'react';
import { ModernTemplate } from '../components/ModernTemplate';
import { CVEditor } from '../components/CVEditor';
import { AISidebar } from '../components/AISidebar';
import { useCVStore } from '../store/useCVStore';

export const CVBuilderPage: React.FC = () => {
  const cv = useCVStore((state) => state.cv);
  const aiSidebarOpen = useCVStore((state) => state.aiSidebarOpen);

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
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '24px',
            alignItems: 'flex-start',
          }}
        >
          <ModernTemplate cv={cv} />
          {aiSidebarOpen && <AISidebar />}
        </div>
      </div>
    </div>
  );
};
