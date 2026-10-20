const CACHE_NAME = 'ron-bot-v28.5';
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
  'bond.js',
  'safety.js',
  'follow.js',
  'llm.js',
  'memory.js',
  'identity.js',
  'bedtime.js',
  'whisper.js',
  'tts.js',
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
  if (event.request.method !== 'GET' || !url.startsWith(self.location.origin)) {
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