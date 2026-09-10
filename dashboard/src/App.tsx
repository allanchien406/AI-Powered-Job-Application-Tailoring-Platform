import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { CVBuilderPage } from './pages/CVBuilderPage';
import { MyCVsPage } from './pages/MyCVsPage';
import { FreeformDemoPage } from './pages/FreeformDemoPage';
import { ProfileIntakePage } from './pages/ProfileIntakePage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/profile" element={<ProfileIntakePage />} />
        <Route path="/builder" element={<CVBuilderPage />} />
        <Route path="/my-cvs" element={<MyCVsPage />} />
        <Route path="/demo" element={<FreeformDemoPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
