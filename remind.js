/*
 * Drink reminders: a notification on your phone, also when the app is closed.
 *
 * - The app keeps a small summary of your cellar on the phone (IndexedDB "mw-remind"): which bottles
 *   are open and until when the wines in stock are at their best. sw.js reads it when a reminder
 *   arrives and writes the text, so no wine data ever goes to the server.
 * - The app tells the relay (worker/worker.js) only WHEN to wake this phone up: three days after you
 *   open a bottle, and the first Friday of the month when something should be drunk soon.
 * - Needs the relay's PUSH store and hourly cron (see README). On an iPhone it works once the app is
 *   on the home screen (iOS 16.4 or later).
 */
(() => {
  const $ = id => document.getElementById(id);
  const relay = () => window.MW_AI_URL || "";
  const supported = () => !!(relay() && window.MW_FIREBASE && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const iosInBrowser = () => /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone && !("PushManager" in window);
  const ls = {get: k => { try{ return localStorage.getItem(k); }catch{ return null; } }, set: (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch{} }};
  let busy = false, msg = "";

  function idb(){
    return new Promise((res, rej) => {
      const r = indexedDB.open("mw-remind", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function put(k, v){
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }

  // What the notification needs, nothing more.
  // Your choices, per phone (Settings → Herinneringen).
  // open: days after opening a bottle (0 = no reminder); cadence: week | month | off; hour: time of day.
  const DEF = {open: 3, cadence: "month", hour: 18};
  function prefs(){
    let p = {}; try{ p = JSON.parse(ls.get("mw_remind_prefs") || "{}") || {}; }catch{}
    return {open: [0, 2, 3, 5].includes(p.open) ? p.open : DEF.open, cadence: ["week", "month", "off"].includes(p.cadence) ? p.cadence : DEF.cadence,
      hour: [9, 12, 18, 20].includes(p.hour) ? p.hour : DEF.hour};
  }

  function summary(wines){
    const k = wines.filter(w => w.status === "kelder"), p = prefs();
    return {
      at: Date.now(), openDays: p.open,
      soon: p.cadence === "off" ? [] : k.filter(w => w.stock > 0 && w.to).map(w => ({n: w.name, v: w.vintage || "", to: w.to})).sort((a, b) => a.to - b.to).slice(0, 40),
      open: k.filter(w => w.openedAt).map(w => ({n: w.name, v: w.vintage || "", d: w.openedAt}))
    };
  }
  // Fridays at the chosen hour: every week for the next five, or the first of each of the next four months.
  function fridays(p){
    const out = [], d = new Date(); d.setHours(p.hour, 0, 0, 0);
    if(p.cadence === "week"){
      while(d.getDay() !== 5) d.setDate(d.getDate() + 1);
      for(let i = 0; i < 5; i++){ out.push(new Date(d)); d.setDate(d.getDate() + 7); }
    }else if(p.cadence === "month"){
      for(let m = 0; m < 4; m++){
        const f = new Date(d); f.setDate(1); f.setMonth(d.getMonth() + m);
        while(f.getDay() !== 5) f.setDate(f.getDate() + 1);
        out.push(f);
      }
    }
    return out;
  }
  // When to wake this phone up.
  function plan(s){
    const now = Date.now(), when = [], p = prefs();
    if(p.open) s.open.forEach(o => { const t = new Date(o.d + "T00:00:00"); t.setHours(p.hour); t.setDate(t.getDate() + p.open); if(+t > now) when.push(+t); });
    fridays(p).forEach(d => { if(+d > now && s.soon.some(x => x.to <= d.getFullYear() + 1)) when.push(+d); });
    return [...new Set(when)].sort((a, b) => a - b).slice(0, 12);
  }

  const b64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
  async function token(){ const u = window.firebase && firebase.auth && firebase.auth().currentUser; return u ? u.getIdToken() : ""; }
  async function tell(endpoint, when){
    const r = await fetch(relay() + "/push", {method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer " + await token()}, body: JSON.stringify({endpoint, when})});
    if(!r.ok){ let c = ""; try{ c = (await r.json()).error.code; }catch{} throw Object.assign(new Error(c || "HTTP " + r.status), {code: c}); }
  }
  const failText = e => e && e.code === "push_off" ? "Herinneringen zijn nog niet ingesteld op de server. Zie de README (Herinneringen)."
    : e && (e.code === "not_member" || e.code === "not_signed_in") ? "Herinneringen werken alleen als je aangemeld bent in een kelder."
    : "Herinneringen aanzetten lukte niet. Probeer later opnieuw.";

  async function subscription(){ const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }

  async function sync(force){
    if(!on() || !window.mwWines) return;
    const s = summary(window.mwWines());
    try{ await put("state", s); }catch{}
    const when = plan(s), sig = JSON.stringify(when);
    if(!force && sig === ls.get("mw_remind_sig")) return;
    try{
      const sub = await subscription();
      if(!sub){ ls.set("mw_remind", null); repaint(); return; }
      await tell(sub.endpoint, when); ls.set("mw_remind_sig", sig);
    }catch{}
  }

  async function enable(){
    if(busy) return; busy = true; msg = ""; repaint();
    try{
      const perm = await Notification.requestPermission();
      if(perm !== "granted"){ msg = "Meldingen staan uit voor deze app. Zet ze aan in de instellingen van je telefoon."; return; }
      const r = await fetch(relay() + "/push/key");
      const key = r.ok ? (await r.json()).key : "";
      if(!key) throw Object.assign(new Error("push_off"), {code: "push_off"});
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64(key)});
      ls.set("mw_remind", "1"); ls.set("mw_remind_sig", null);
      const s = summary(window.mwWines ? window.mwWines() : []);
      await put("state", s);
      await tell(sub.endpoint, plan(s)); ls.set("mw_remind_sig", JSON.stringify(plan(s)));
      msg = "Herinneringen staan aan. Pas hieronder aan wanneer.";
    }catch(e){ ls.set("mw_remind", null); msg = failText(e); }
    finally{ busy = false; repaint(); }
  }
  async function disable(){
    if(busy) return; busy = true;
    try{ const sub = await subscription(); if(sub){ try{ await tell(sub.endpoint, []); }catch{} await sub.unsubscribe(); } }catch{}
    ls.set("mw_remind", null); ls.set("mw_remind_sig", null); msg = ""; busy = false; repaint();
  }

  const on = () => ls.get("mw_remind") === "1";
  const repaint = () => { window.mwRender && window.mwRender(); window.mwCloud && window.mwCloud.redraw && window.mwCloud.redraw(); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const bell = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>`;
  const IOS_HINT = "Zet de app op je beginscherm (Delen → Zet op beginscherm) en open hem van daaruit. Dan kan hij je meldingen sturen.";

  // A line at the bottom of "Klaar om te drinken".
  function html(){
    if(iosInBrowser()) return `<p class="hint remind">${bell} Wil je hier een melding van? ${IOS_HINT}</p>`;
    if(!supported()) return "";
    const note = msg ? `<span class="hint">${esc(msg)}</span>` : "";
    return on()
      ? `<div class="remind"><span class="hint">${bell} Je krijgt een melding als een fles op moet.</span><button class="link" type="button" data-remind="settings">Instellingen</button>${msg && !msg.startsWith("Herinneringen staan aan") && !msg.startsWith("Testmelding") ? note : ""}</div>`
      : `<div class="remind"><button class="btn ghost sm" type="button" data-remind="on" ${busy ? "disabled" : ""}>${bell} ${busy ? "Even geduld…" : "Stuur me een herinnering"}</button>${note}</div>`;
  }

  // The "Herinneringen" block in Settings. head = the sheet's own section heading.
  function settingsHtml(head){
    const p = prefs(), opt = (v, cur, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
    const sec = body => `<section class="mwsec">${head}${body}</section>`;
    if(iosInBrowser()) return sec(`<p>${IOS_HINT}</p>`);
    if(!supported()) return sec(`<p>Meldingen werken niet in deze browser. Open de app op je telefoon.</p>`);
    const next = on() && window.mwWines ? plan(summary(window.mwWines()))[0] : 0;
    const when = next ? new Date(next).toLocaleString("nl-BE", {weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "";
    return sec(`<p>Een melding op deze telefoon, ook als de app dicht is. Elke telefoon heeft zijn eigen instelling.</p>
      ${msg ? `<p class="${/lukte|staan uit|nog niet ingesteld|alleen als/.test(msg) ? "err" : ""}">${esc(msg)}</p>` : ""}
      <div class="rmrow">${on()
        ? `<span class="rmon">${bell} Aan op dit toestel</span><button class="btn ghost sm" type="button" data-remind="off">Uitzetten</button>`
        : `<button class="btn sm" type="button" data-remind="on" ${busy ? "disabled" : ""}>${bell} ${busy ? "Even geduld…" : "Zet herinneringen aan"}</button>`}</div>
      <label class="mwlab">Open fles: herinner me na
        <select data-rp="open">${opt(2, p.open, "2 dagen")}${opt(3, p.open, "3 dagen")}${opt(5, p.open, "5 dagen")}${opt(0, p.open, "Niet")}</select></label>
      <label class="mwlab">Flessen die binnenkort op moeten
        <select data-rp="cadence">${opt("week", p.cadence, "Elke vrijdag")}${opt("month", p.cadence, "Eerste vrijdag van de maand")}${opt("off", p.cadence, "Niet")}</select></label>
      <label class="mwlab">Tijdstip
        <select data-rp="hour">${[9, 12, 18, 20].map(h => opt(h, p.hour, h + ":00")).join("")}</select></label>
      ${on() ? `<p>${when ? `Volgende herinnering: <b>${esc(when)}</b>.` : "Nu staat er niets gepland: geen open flessen en niets dat binnenkort op moet."}</p>
        <div><button class="btn ghost sm" type="button" data-remind="test">Stuur een testmelding</button></div>` : ""}`);
  }

  function setPref(k, v){
    const p = {...prefs(), [k]: k === "cadence" ? v : +v};
    ls.set("mw_remind_prefs", JSON.stringify(p)); msg = "";
    if(on()) sync(true).then(repaint); else repaint();
  }
  // Shows what a reminder looks like right now, through the service worker (same code as a real one).
  async function test(){
    try{
      if(window.mwWines) await put("state", summary(window.mwWines()));
      const reg = await navigator.serviceWorker.ready;
      (navigator.serviceWorker.controller || reg.active).postMessage("mw-test-remind");
      msg = "Testmelding verstuurd. Zie je niets? Kijk of meldingen voor deze app aan staan.";
    }catch{ msg = "De testmelding lukte niet."; }
    repaint();
  }

  let t = 0;
  const changed = () => { if(!on()) return; clearTimeout(t); t = setTimeout(() => sync(false), 4000); };

  document.addEventListener("click", e => {
    const b = e.target.closest("[data-remind]"); if(!b) return;
    const a = b.dataset.remind;
    if(a === "on") enable(); else if(a === "off") disable(); else if(a === "test") test();
    else if(a === "settings"){ const g = $("mwGear"); if(g) g.click(); }
  });
  document.addEventListener("change", e => { const s = e.target.closest("[data-rp]"); if(s) setPref(s.dataset.rp, s.value); });
  // Opening the app refreshes the plan (dates move on, bottles get opened).
  // Once a day it is sent again anyway, in case the server lost it.
  addEventListener("load", () => setTimeout(() => {
    const day = new Date().toISOString().slice(0, 10), force = ls.get("mw_remind_day") !== day;
    if(on()){ ls.set("mw_remind_day", day); sync(force); }
  }, 6000));

  window.mwRemind = {html, settingsHtml, changed, plan, summary, prefs};
})();
