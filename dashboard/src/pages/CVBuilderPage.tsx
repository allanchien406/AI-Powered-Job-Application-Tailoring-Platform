import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ModernTemplate } from '../components/ModernTemplate';
import { CVViewer } from '../components/CVViewer';
import { useCVStore } from '../store/useCVStore';
import { Button } from '../components/ui';

export const CVBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const viewerCv = useCVStore((state) => state.viewerCv);

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
      {viewerCv ? (
        <>
          <CVViewer />
          <div
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              maxHeight: 'calc(100vh - 48px)',
              overflow: 'auto',
            }}
          >
            <div id="cv-preview">
              <ModernTemplate cv={viewerCv} />
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 'calc(100vh - 48px)',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              background: '#fff',
              padding: '48px',
              borderRadius: '16px',
              border: '1px solid #e6e1d7',
              boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
            }}
          >
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: '22px',
                color: '#1a1a18',
                marginBottom: '8px',
              }}
            >
              No tailored CV yet
            </div>
            <p style={{ fontSize: '13px', color: '#6b665c', marginBottom: '16px' }}>
              Generate a tailored CV from a saved job description, then it will show up here for
              review and export.
            </p>
            <Button onClick={() => navigate('/jobs')} style={{ marginBottom: 0 }}>
              Go to my jobs
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};