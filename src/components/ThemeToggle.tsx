'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export default function ThemeToggle() {
  // Starts null so we render nothing until we can read the theme the
  // no-flash inline script already applied to <html data-theme>.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  }

  if (!theme) return <span className="tap w-11 shrink-0" aria-hidden="true" />;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}
      className="tap flex w-11 shrink-0 items-center justify-center rounded-xl border border-line text-base"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
