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
    navigate('/builder');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0ede6',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#fff',
          padding: '40px',
          borderRadius: '16px',
          border: '1px solid #e6e1d7',
          boxShadow: '0 8px 30px rgba(30, 22, 10, 0.08)',
          width: '360px',
        }}
      >
        <h1
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '28px',
            margin: '0 0 24px',
            color: '#1a1a18',
          }}
        >
          CV Builder
        </h1>
        <Field label="Email address">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Button
          type="submit"
          style={{ width: '100%', padding: '10px', fontSize: '14px', marginBottom: 0 }}
        >
          Get Started
        </Button>
      </form>
    </div>
  );
};
