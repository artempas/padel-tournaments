import type { MetadataRoute } from 'next';

/**
 * Served at /manifest.webmanifest — this is what lets the app be installed on a
 * phone's home screen and open without browser chrome.
 *
 * The icons live in `public/` and are produced by `node scripts/generate-icons.mjs`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/tournaments',
    name: 'Падел Турниры',
    short_name: 'Падел',
    description: 'Американо-турниры по паделу: расписание, счёт и итоговая таблица',
    lang: 'ru',
    // Straight to the tournament list; a logged-out visitor is redirected to the
    // sign-in screen anyway.
    start_url: '/tournaments',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#070c16',
    theme_color: '#070c16',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
