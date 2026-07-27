'use client';

import { useEffect } from 'react';

/**
 * Installs `public/sw.js` — and, in development, makes sure no worker is left
 * running. A worker caching `next dev` output serves chunks that no longer
 * exist, which looks exactly like the "стили пропали" trap in the README.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }

    // Registering during load competes with the page's own requests for
    // bandwidth, which is scarce exactly where this matters.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
