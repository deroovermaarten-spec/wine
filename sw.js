// Offline support: the app itself is cached on first visit, so it opens without a connection.
// VERSION is filled in automatically by the GitHub workflow on every publish (the commit id).
// Locally it stays "__BUILD__": then app files always come from the network, so edits show up at once.
const VERSION = "mw-__BUILD__";
const DEV = VERSION.includes("__BUILD__");
const SHELL = ["./", "index.html", "store.js", "firebase-config.js", "cloud.js", "events.js", "ai.js", "remind.js", "world.json", "manifest.webmanifest",
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

// ---------- drink reminders (see remind.js) ----------
// The relay only wakes the phone; the text is made here from the summary the app left on the phone.
function remindState(){
  return new Promise(res => {
    const r = indexedDB.open("mw-remind", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try{ const g = r.result.transaction("kv").objectStore("kv").get("state"); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }
      catch{ res(null); }
    };
  });
}
function remindText(s){
  const year = new Date().getFullYear(), today = new Date();
  const days = d => Math.round((today - new Date(d + "T12:00:00")) / 864e5);
  const name = x => x.n + (x.v ? " " + x.v : "");
  const list = xs => xs.slice(0, 3).map(name).join(", ") + (xs.length > 3 ? ` en ${xs.length - 3} andere` : "");
  // ids: the wines this reminder is about, so tapping it can open them
  const ids = xs => xs.map(x => x.id).filter(Boolean);
  if(s){
    const od = s.openDays === undefined ? 3 : s.openDays; // 0 = no reminders for open bottles
    const open = od ? s.open.filter(o => days(o.d) >= od) : [];
    if(open.length === 1) return {title: `${name(open[0])} staat al ${days(open[0].d)} dagen open`, body: "Drink hem op voor hij zijn frisheid verliest, of kook ermee.", ids: ids(open)};
    if(open.length > 1) return {title: `${open.length} flessen staan al een paar dagen open`, body: list(open), ids: ids(open)};
    const late = s.soon.filter(x => x.to < year), soon = s.soon.filter(x => x.to >= year && x.to <= year + 1);
    if(late.length) return {title: late.length === 1 ? "Een fles is over zijn hoogtepunt" : `${late.length} flessen zijn over hun hoogtepunt`, body: list(late) + (soon.length ? `. Ook binnenkort: ${list(soon)}` : ""), ids: ids([...late, ...soon])};
    if(soon.length) return {title: soon.length === 1 ? "Een fles om binnenkort te drinken" : `${soon.length} wijnen om binnenkort te drinken`, body: list(soon), ids: ids(soon)};
  }
  return {title: "Je wijnkelder", body: "Kijk even wat er klaar is om te drinken.", ids: []};
}
const showReminder = () => remindState().then(s => {
  const t = remindText(s);
  // One wine: open that wine. Several: open "Klaar om te drinken", where they are all listed.
  const go = t.ids.length === 1 ? {wine: t.ids[0]} : {go: "drinken"};
  const url = "./?" + (go.wine ? "wine=" + encodeURIComponent(go.wine) : "go=drinken");
  return self.registration.showNotification(t.title, {body: t.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "mw-drink", data: {url, go}});
});
self.addEventListener("push", e => { e.waitUntil(showReminder()); });
// "Stuur een testmelding" in Settings: the same notification, right now.
self.addEventListener("message", e => { if (e.data === "mw-test-remind") e.waitUntil(showReminder()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {};
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(cs => {
    const c = cs.find(x => new URL(x.url).origin === location.origin);
    // App already open: bring it forward and tell it where to go. Otherwise open it at that place.
    // Tell it first: on some phones focus() fails or returns nothing, and the message must still arrive.
    if (c){ c.postMessage({mwGo: d.go || {go: "drinken"}}); return c.focus().catch(() => {}); }
    return self.clients.openWindow(d.url || "./");
  }));
});
