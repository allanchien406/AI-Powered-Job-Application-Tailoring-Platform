import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';
import { Button } from '../components/ui';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then(() => {
        if (active) navigate('/profile', { replace: true });
      })
      .catch(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, [navigate]);

  if (checkingSession) {
    return <div className="min-h-screen bg-paper" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="w-[360px] rounded-2xl border border-sand bg-white p-10 text-center shadow-card">
        <h1 className="mb-2 mt-0 font-display text-[28px] text-ink">CV Tailor</h1>
        <p className="mb-6 text-xs leading-normal text-ink-soft">
          Paste your background once, save the jobs you're applying for, and get a CV tailored to
          each one.
        </p>
        <Button
          onClick={() => signInWithRedirect()}
          className="mb-3 w-full px-2.5 py-2.5 text-sm"
        >
          Sign in / Sign up
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate('/demo')}
          className="w-full px-2.5 py-2.5 text-[13px]"
        >
          See the offline demo (fake data) →
        </Button>
      </div>
    </div>
  );
};
