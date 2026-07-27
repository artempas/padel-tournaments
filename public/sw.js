/**
 * Service worker — the app has to keep working on court, where the signal is
 * usually worse than the players.
 *
 * Rules:
 *   • navigations   — network first, cached copy next, /offline.html last;
 *   • /_next/static — cache first (file names are content-hashed, so they never
 *                     go stale);
 *   • /api/*        — never touched. Data must be live, and score PATCHes are
 *                     queued in IndexedDB by the app itself, not here.
 *
 * Registered only in production (see ServiceWorkerRegistrar): `next dev`
 * rebuilds chunks on every edit, and a worker caching them would serve 404s.
 *
 * Bump VERSION to drop every cache after a change to this file.
 */
const VERSION = 'v1';
const SHELL_CACHE = `padel-shell-${VERSION}`;
const PAGES_CACHE = `padel-pages-${VERSION}`;
const OFFLINE_URL = '/offline.html';

/** Public, non-personal things worth having before the network is gone. */
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== PAGES_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Cached pages belong to whoever was signed in, so the app asks for them to be
 * dropped on logout. The shell survives — nothing in it is personal.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'purge-pages') {
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that changes state goes straight to the network — and stays the
  // app's problem when it fails.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(pageFirst(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (PRECACHE.includes(url.pathname) || /\.(png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }

  // Everything else — RSC payloads of client-side navigations among them — is
  // left alone. When one fails offline, Next falls back to a full page load,
  // which lands on `pageFirst` above and finds the cached HTML.
});

async function pageFirst(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    // A followed redirect cannot be replayed from the cache — the browser
    // refuses a redirected response for a navigation — so it is not stored.
    if (response.ok && !response.redirected) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    // Served under the requested URL, not redirected to: reloading then retries
    // the page the organiser actually wanted. This works only because the
    // fallback is a plain HTML file — a React page handed back under a foreign
    // URL fails to hydrate, and its chunks would be missing anyway.
    const offline = await caches.match(OFFLINE_URL);
    return (
      offline ??
      new Response('Нет сети', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}
