// Keeps the app shell openable when the connection drops. Live data (/api,
// the websocket) is never cached: stale office state is worse than none.
const SHELL = 'office-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Hashed build files never change: serve from cache, fill on first sight.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  // The page itself: fresh when online, last copy when not.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put('/', res.clone())); return res; })
        .catch(() => caches.match('/')),
    );
  }
});
