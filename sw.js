// Offline support: the app itself is cached on first visit, so it opens without a connection.
// VERSION is filled in automatically by the GitHub workflow on every publish (the commit id).
// Locally it stays "__BUILD__": then app files always come from the network, so edits show up at once.
const VERSION = "mw-__BUILD__";
const DEV = VERSION.includes("__BUILD__");
const SHELL = ["./", "index.html", "store.js", "firebase-config.js", "cloud.js", "ai.js", "world.json", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

// Libraries and fonts rarely change, so they live in their own cache that survives app updates.
// Change the number only when a file in vendor/ or fonts/ itself changes.
const LIBS = "mw-libs-1";
const LIB_FILES = ["vendor/firebase/firebase-app-compat.js", "vendor/firebase/firebase-auth-compat.js",
  "vendor/firebase/firebase-firestore-compat.js", "fonts/fonts.css",
  "fonts/BodoniModa-normal-500-latin.woff2", "fonts/BodoniModa-normal-500-latin-ext.woff2",
  "fonts/BodoniModa-italic-500-latin.woff2", "fonts/BodoniModa-italic-500-latin-ext.woff2",
  "fonts/TitilliumWeb-normal-400-latin.woff2", "fonts/TitilliumWeb-normal-400-latin-ext.woff2",
  "fonts/TitilliumWeb-normal-600-latin.woff2", "fonts/TitilliumWeb-normal-600-latin-ext.woff2",
  "fonts/TitilliumWeb-normal-700-latin.woff2", "fonts/TitilliumWeb-normal-700-latin-ext.woff2",
  "fonts/IBMPlexMono-normal-500-latin.woff2", "fonts/IBMPlexMono-normal-500-latin-ext.woff2"];
const isLib = url => url.origin === location.origin && /\/(vendor|fonts)\//.test(url.pathname);

self.addEventListener("install", e => {
  e.waitUntil(Promise.all([
    // cache:"reload" skips the browser's HTTP cache, so a new version never stores stale copies of old files.
    caches.open(VERSION).then(c => c.addAll(SHELL.map(f => new Request(f, {cache: "reload"})))),
    // Only fetch the libraries this phone does not have yet.
    caches.open(LIBS).then(c => Promise.all(LIB_FILES.map(f => c.match(f).then(hit => hit || c.add(f).catch(() => {})))))
  ]).then(() => { if (DEV) return self.skipWaiting(); }));
  // Otherwise the new version waits until the page says "update now" (see index.html).
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== LIBS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  // The pdf/excel libraries from the CDN: keep a copy once loaded.
  const cdn = url.hostname === "cdnjs.cloudflare.com";
  if (!same && !cdn) return;

  if (same && req.mode === "navigate") {
    // Page: try the network first so updates arrive, fall back to the cached copy offline.
    // (A navigation request can't be copied with new options, so fetch its URL.)
    e.respondWith(fetch(req.url, {cache: "no-cache", credentials: "same-origin"}).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put("index.html", c)); } return r; })
      .catch(() => caches.match("index.html")));
    return;
  }

  const bucket = isLib(url) || cdn ? LIBS : VERSION;
  const net = () => fetch(DEV && bucket === VERSION ? new Request(req, {cache: "no-cache"}) : req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(bucket).then(x => x.put(req, c)); } return r; });
  if (DEV && bucket === VERSION) { e.respondWith(net().catch(() => caches.match(req))); return; }
  e.respondWith(caches.match(req, {ignoreSearch: bucket === LIBS}).then(hit => hit || net()));
});
