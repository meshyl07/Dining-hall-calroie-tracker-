// Network-first so the app and menus are always fresh when online; falls back
// to the last cached copy when the dining hall Wi-Fi drops out.
const CACHE = 'dhct-v1';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/menus.js',
  'js/ui.js',
  'js/charts.js',
  'js/dates.js',
  'js/halls.js',
  'js/nutrition.js',
  'js/views/today.js',
  'js/views/dining.js',
  'js/views/trends.js',
  'js/views/you.js',
  'js/views/onboarding.js',
  'js/views/food-sheet.js',
  'icon.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Cache-busting query params (?t=...) shouldn't create a new cache entry per request.
  const key = url.pathname.includes('/data/') ? url.origin + url.pathname : req;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(key).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
      ),
  );
});
