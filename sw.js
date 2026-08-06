const CACHE_NAME = 'ron-bot-v25.28';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'core.js',
  'ui.js',
  'vision.js',
  'speech.js',
  'ai.js',
  'games.js',
  'friendship.js',
  'curiosity.js',
  'learning.js',
  'defender.js',
  'diary.js',
  'app.js',
  'sounds.js',
  'face-canvas.js',
  'music.js',
  'manifest.json',
  'icon.png',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // allSettled: si un asset falta (p.ej. un icono), no aborta todo el install
      .then(cache => Promise.allSettled(ASSETS.map(a => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // No interceptar APIs externas ni CDN de modelos
  if (url.includes('api.groq.com') || url.includes('jsdelivr.net') || url.includes('youtube.com')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
