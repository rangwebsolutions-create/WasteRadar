// Minimal service worker — exists only so Chrome/Android will consider
// WasteRadar "installable" as a PWA. It deliberately does NOT cache
// anything: every request just passes straight through to the network.
// That's a conscious choice for a fast-moving hackathon build — an
// eager cache here could easily end up serving a stale index.html or
// script.js right before a demo. If real offline support is wanted
// later, this is the place to add a cache strategy.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
