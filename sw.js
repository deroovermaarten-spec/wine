// Offline support: the app itself is cached on first visit, so it opens without a connection.
// Bump VERSION whenever a file below changes so phones pick up the new version.
const VERSION = "mw-v16";
const SHELL = ["./", "index.html", "store.js", "firebase-config.js", "cloud.js", "ai.js", "ocr.js", "world.json", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  // Fonts and the pdf/excel libraries: keep a copy once loaded.
  const cdn = /fonts\.(googleapis|gstatic)\.com$|cdnjs\.cloudflare\.com$/.test(url.hostname);
  if (!same && !cdn) return;
  if (same && req.mode === "navigate") {
    // Page: try the network first so updates arrive, fall back to the cached copy offline.
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put("index.html", c)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; });
    return hit || net;
  }));
});
