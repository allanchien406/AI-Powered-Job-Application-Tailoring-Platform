import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCVStore } from '../store/useCVStore';
import { Button } from './ui';

const NAV_ITEMS = [
  { label: 'Profile', path: '/profile' },
  { label: 'Jobs', path: '/jobs' },
  { label: 'My CV', path: '/builder' },
];

export const Shell: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({
  children,
  wide = false,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const email = useCVStore((state) => state.email);
  const logout = useCVStore((state) => state.logout);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-sand bg-white px-6 py-2.5">
        <div
          className="cursor-pointer whitespace-nowrap font-display text-xl tracking-[-0.2px] text-forest"
          onClick={() => navigate(email ? '/profile' : '/')}
        >
          CV Tailor
        </div>

        <nav className="flex gap-1.5">
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.path}
              variant={pathname === item.path ? 'solid' : 'ghost'}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </Button>
          ))}
        </nav>

        {email && (
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="text-[11px] text-ink-muted">{email}</span>
            <Button
              variant="ghost"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Logout
            </Button>
          </div>
        )}
      </header>

      <div className={`mx-auto px-5 py-7 ${wide ? 'max-w-[1100px]' : 'max-w-[660px]'}`}>{children}</div>
    </div>
  );
};