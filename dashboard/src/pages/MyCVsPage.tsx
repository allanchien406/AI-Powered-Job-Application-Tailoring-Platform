import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Button, Card } from '../components/ui';
import { fetchCvs, fetchCv, deleteCv } from '../api/cvApi';

interface CvItem {
  cv_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export const MyCVsPage: React.FC = () => {
  const navigate = useNavigate();
  const email = useCVStore((state) => state.email);
  const loadCV = useCVStore((state) => state.loadCV);
  const resetCV = useCVStore((state) => state.resetCV);

  const [cvs, setCvs] = useState<CvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadList = async () => {
    setLoading(true);
    setError('');
    try {
      const items = await fetchCvs(email);
      setCvs(items);
    } catch (err) {
      setError('Failed to load CVs. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!email) {
      navigate('/');
      return;
    }
    loadList();
  }, [email]);

  const handleLoad = async (cvId: number) => {
    try {
      const cv = await fetchCv(email, cvId);
      loadCV(cv.cv_data);
      navigate(`/builder?cv_id=${cvId}`);
    } catch (err) {
      setError('Failed to load CV');
    }
  };

  const handleDelete = async (cvId: number) => {
    try {
      await deleteCv(email, cvId);
      setCvs((prev) => prev.filter((c) => c.cv_id !== cvId));
    } catch (err) {
      setError('Failed to delete CV');
    }
  };

  const handleNew = () => {
    resetCV();
    navigate('/builder');
  };

  return (
    <div
      style={{
        padding: '24px',
        background: '#f0ede6',
        minHeight: '100vh',
      }}
    >
      <div
        style={{
          maxWidth: '720px',
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <h1
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: '28px',
              margin: 0,
              color: '#1a1a18',
            }}
          >
            My CVs
          </h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={handleNew}>Create New CV</Button>
            <Button variant="ghost" onClick={() => navigate('/builder')}>
              Back to Editor
            </Button>
          </div>
        </div>

        <div
          style={{
            fontSize: '12px',
            color: '#6b665c',
            marginBottom: '16px',
          }}
        >
          Signed in as {email}
        </div>

        {loading && <p style={{ color: '#6b665c' }}>Loading...</p>}
        {error && (
          <Card>
            <p style={{ color: '#c0392b', margin: 0, fontSize: '13px' }}>{error}</p>
          </Card>
        )}

        {!loading && cvs.length === 0 && (
          <Card>
            <p style={{ color: '#6b665c', margin: '0 0 12px', fontSize: '13px' }}>
              No saved CVs yet. Create one to get started.
            </p>
            <Button onClick={handleNew}>Create New CV</Button>
          </Card>
        )}

        {cvs.map((cv) => (
          <Card key={cv.cv_id}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: '14px', color: '#1a1a18' }}>
                  {cv.name}
                </div>
                <div style={{ fontSize: '11px', color: '#9e9a91', marginTop: '4px' }}>
                  Last modified: {new Date(cv.updated_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button onClick={() => handleLoad(cv.cv_id)}>Load</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm('Delete this CV?')) handleDelete(cv.cv_id);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
