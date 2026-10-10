/* SOCIAL Park CCTV — network-first shell + auto-update */
const CACHE = 'soscial-cctv-v1.8.2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Never cache API, streams, or update manifest
  if (
    url.pathname.includes('/api/') ||
    url.pathname.includes('/hls') ||
    url.pathname.includes('.m3u8') ||
    url.pathname.includes('.ts') ||
    url.pathname.includes('version.json')
  ) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // HTML / app shell: network-first so new cameras & UI land quickly
  const isShell =
    url.pathname.endsWith('/social') ||
    url.pathname.endsWith('/social/') ||
    url.pathname.endsWith('/soscial') ||
    url.pathname.endsWith('/soscial/') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.includes('/soscial/index.html') ||
    url.pathname.includes('/social/index.html');

  if (isShell) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((res) => {
        const copy = res.clone();
        if (res.ok && (url.pathname.includes('/soscial/') || url.pathname.includes('/social/'))) {
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
