/* Eclipse Road Trip — service worker */
const VERSION = 'eclipse-trip-v1';
const SHELL_CACHE = VERSION + '-shell';
const TILE_CACHE = VERSION + '-tiles';
const RUNTIME_CACHE = VERSION + '-runtime';
const TILE_LIMIT = 600;

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

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > limit) {
    await cache.delete(keys[0]);
    return trimCache(name, limit);
  }
}

async function staleWhileRevalidate(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) {
      cache.put(req, res.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return res;
  }).catch(() => cached);
  return cached || network;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
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
  const url = new URL(req.url);

  // Map tiles: serve cached instantly, refresh in background, cap the cache.
  if (url.hostname === 'tile.openstreetmap.org' ||
      url.hostname.endsWith('cartocdn.com')) {
    e.respondWith(staleWhileRevalidate(req, TILE_CACHE, TILE_LIMIT));
    return;
  }

  // Road routes: prefer fresh, fall back to the cached geometry offline.
  if (url.hostname === 'router.project-osrm.org') {
    e.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // Leaflet from cdnjs: versioned, cache-first.
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Same-origin: shell-cache first; navigations fall back to index.
  if (url.origin === self.location.origin) {
    e.respondWith(
      cacheFirst(req, SHELL_CACHE).catch(async () => {
        if (req.mode === 'navigate') {
          const cache = await caches.open(SHELL_CACHE);
          return cache.match('./index.html');
        }
        throw new Error('offline');
      })
    );
  }
});
