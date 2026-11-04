/* Yeli service worker. Served by yeli/pwa.py, which puts CACHE_VERSION and PRECACHE in front of this file
   (so every deploy produces a new worker and a fresh cache).

   It only keeps the app shell (page, CSS, JS, icons) so Yeli opens instantly and shows its own
   "can't reach the server" message when you're offline. It never touches /api/, video or anything
   from another site: live streams always go straight to the network. */
'use strict';

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith('yeli-') && k !== CACHE_VERSION).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/sw.js') return;

    if (req.mode === 'navigate') {
        // Page: network first, so a deploy shows up straight away; the cached copy is only for offline.
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                if (res.ok) (await caches.open(CACHE_VERSION)).put('/', res.clone());
                return res;
            } catch {
                return (await caches.match('/')) || Response.error();
            }
        })());
        return;
    }

    if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest') {
        // Assets: cached copy first, refreshed in the background.
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_VERSION);
            const hit = await cache.match(req);
            const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
            if (hit) { refresh.catch(() => {}); return hit; }
            return refresh;
        })());
    }
});
