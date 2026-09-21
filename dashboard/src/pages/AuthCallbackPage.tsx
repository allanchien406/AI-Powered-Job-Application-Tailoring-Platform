import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        navigate('/profile', { replace: true });
      } else if (payload.event === 'signInWithRedirect_failure') {
        setError('Sign-in failed. Please try again.');
      }
    });

    // Amplify may finish processing the redirect before this listener is
    // registered — check directly too, in case the Hub event already fired.
    getCurrentUser()
      .then(() => navigate('/profile', { replace: true }))
      .catch(() => {
        /* not signed in yet — wait for the Hub event above */
      });

    return unsubscribe;
  }, [navigate]);

  if (error) {
    return <div className="p-8 text-center text-sm text-ink">{error}</div>;
  }
  return <div className="p-8 text-center text-sm text-ink-soft">Signing you in…</div>;
};
