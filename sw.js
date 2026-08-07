/* Eclipse Road Trip — service worker v3
   Tiles are deliberately NOT intercepted: the browser loads them natively,
   exactly like the working Run Sheet page. Offline maps come from the
   embedded chart fallback in the page itself. */
const VERSION = 'eclipse-trip-v3';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k.startsWith('eclipse-trip-') && !k.startsWith(VERSION))
        .map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req) ||
      (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Map tiles: hands off — native browser loading, no interception at all.
  if (url.hostname === 'tile.openstreetmap.org' ||
      url.hostname.endsWith('cartocdn.com')) {
    return;
  }

  // Road routes: fresh when online, cached geometry offline.
  if (url.hostname === 'router.project-osrm.org') {
    e.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // Leaflet from cdnjs: versioned, cache-first.
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Same-origin: network-first so new deploys appear immediately;
  // cached shell serves it offline.
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, SHELL_CACHE, './index.html'));
  }
});
