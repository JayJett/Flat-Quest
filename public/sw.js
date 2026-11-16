// Deliberately cache only a generic offline page. Never cache household data,
// tokens, signed photos, API responses or HTML containing an auth callback.
const CACHE = 'flatquest-offline-v2'
const FALLBACK = new URL('offline.html', self.registration.scope).href
// Nothing here can go stale (only the offline page is cached), so a new worker takes over
// straight away instead of waiting for every tab to close.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(FALLBACK)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('flatquest-offline-') && key !== CACHE)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || !event.request.url.startsWith(self.registration.scope)) return
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(FALLBACK)) || Response.error()))
})
