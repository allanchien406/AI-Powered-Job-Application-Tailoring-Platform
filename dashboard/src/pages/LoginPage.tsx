import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Button, Input, Field } from '../components/ui';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const login = useCVStore((state) => state.login);
  const storedEmail = useCVStore((state) => state.email);
  const [email, setEmail] = useState(storedEmail);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    login(email.trim().toLowerCase());
    navigate('/profile');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <form
        onSubmit={handleSubmit}
        className="w-[360px] rounded-2xl border border-sand bg-white p-10 shadow-card"
      >
        <h1 className="mb-2 mt-0 font-display text-[28px] text-ink">CV Tailor</h1>
        <p className="mb-6 text-xs leading-normal text-ink-soft">
          Paste your background once, save the jobs you're applying for, and get a CV tailored to
          each one.
        </p>
        <Field label="Email address">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="mb-3 w-full px-2.5 py-2.5 text-sm">
          Get Started
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate('/demo')}
          className="w-full px-2.5 py-2.5 text-[13px]"
        >
          See the offline demo (fake data) →
        </Button>
      </form>
    </div>
  );
};