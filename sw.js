// Service worker: caches ONLY the app's own static files (so it installs and opens offline). Never touches Google API/sign-in requests,
// and never stores spreadsheet data.
const CACHE = 'gst-tracker-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'logic.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;       // let the browser handle everything else
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net;                                                          // stale-while-revalidate
  }));
});
