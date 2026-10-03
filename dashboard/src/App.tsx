import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { CVBuilderPage } from './pages/CVBuilderPage';
import { FreeformDemoPage } from './pages/FreeformDemoPage';
import { ProfileIntakePage } from './pages/ProfileIntakePage';
import { JobDescriptionPage } from './pages/JobDescriptionPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { useCVStore } from './store/useCVStore';

export const App: React.FC = () => {
  const initFromSession = useCVStore((state) => state.initFromSession);

  useEffect(() => {
    initFromSession();
  }, [initFromSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/profile" element={<ProfileIntakePage />} />
        <Route path="/jobs" element={<JobDescriptionPage />} />
        <Route path="/builder" element={<CVBuilderPage />} />
        <Route path="/demo" element={<FreeformDemoPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};