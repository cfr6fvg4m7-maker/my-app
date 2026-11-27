// オフラインでも開けるようにするための Service Worker。
// アプリのファイルを変更したら CACHE の番号を上げる(例: v2 → v3)。
const CACHE = 'manaba-pwa-v38';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'calendar.js',
  'manifest.webmanifest',
  'bookmarklet.html',
  'bookmarklet.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先、つながらないときはキャッシュ(更新がすぐ反映されるように)。
// GitHub Pages はブラウザに10分キャッシュさせるので、no-cache で毎回確認する。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
