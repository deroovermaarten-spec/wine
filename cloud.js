/*
 * Meerstraat wines — logins and shared cellars (Firebase Auth + Firestore).
 *
 * Off until firebase-config.js holds a project config. When on:
 *  - everyone signs in with e-mail and password;
 *  - each person gets their own cellar, and can create more;
 *  - the owner of a cellar invites others with a link; members see and edit the same wines;
 *  - the app keeps using the same small `db` interface as before, now pointing at
 *    cellars/{cellarId}/wines in Firestore (with offline cache).
 * Who may read or change what is enforced by firestore.rules, not by this file.
 *
 * Local testing against the Firebase emulator: open the app with ?emu=1.
 */
(() => {
  const params = new URLSearchParams(location.search);
  const EMU = params.has("emu");
  const cfg = EMU ? {apiKey: "demo-key", projectId: "demo-wine", authDomain: "localhost"} : window.MW_FIREBASE;
  if(!cfg) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const BASE = new URL("vendor/firebase/", document.baseURI).href;
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); });
  const store = {get: k => { try{ return localStorage.getItem(k); }catch{ return null; } }, set: (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch{} }};

  // Remember an invite code from the link before anything else changes the URL.
  const joinParam = params.get("join");
  if(joinParam) store.set("mw_join", joinParam.replace(/[^A-Za-z0-9]/g, "").slice(0, 32));

  let resolveReady;
  const cloud = window.mwCloud = {ready: new Promise(r => { resolveReady = r; }), me: null, cellar: null, cellars: []};
  let fb, auth, fs, pendingName = null;

  // ---------- UI ----------
  const css = `
.mwlogin{position:fixed;inset:0;z-index:30;background:var(--bg);overflow:auto;display:flex;justify-content:center;
  padding:max(40px,env(safe-area-inset-top,0px)) 16px 40px}
.mwlogin .in{width:100%;max-width:420px;display:flex;flex-direction:column;gap:16px}
.mwlogin form{display:flex;flex-direction:column;gap:10px}
.mwlogin input,.mwcell input{font:inherit;font-size:1rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px 12px;min-width:0}
.mwlogin .err,.mwcell .err{color:var(--accent);font-size:.88rem;margin:0}
.mwlogin .ok{color:var(--ok);font-size:.88rem;margin:0}
.mwchips{display:flex;flex-wrap:wrap;gap:6px}
.mwlab{display:flex;flex-direction:column;gap:4px;font-size:.78rem;font-weight:600}
.mwacct{display:inline-flex;align-items:center;gap:6px;max-width:180px}
.mwbell{position:relative;padding:7px 9px}
.mwbell .dot{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:#fff;font-size:.7rem;font-weight:700;line-height:18px;text-align:center}
.mwbellp{position:fixed;z-index:25;top:calc(env(safe-area-inset-top,0px) + 70px);right:max(16px,calc(50% - 360px));width:min(340px,calc(100% - 32px));max-height:70vh;overflow:auto;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px;display:flex;flex-direction:column;gap:8px}
.mwbellp[hidden]{display:none}
.mwbellp h3{margin:0;font-size:1rem}
.mwbellp .hint{margin:0;font-size:.85rem;color:var(--muted)}
.mwbelli{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;font:inherit;color:inherit;background:none;border:0;border-bottom:1px solid var(--line);padding:8px 0;cursor:pointer}
.mwbelli small{color:var(--muted)}
.mwbelli.new b::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:6px;vertical-align:middle}
.mwacct span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mwcell{display:flex;flex-direction:column;gap:12px}
.mwrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:.92rem}
.mwrow:last-child{border-bottom:0}
.mwrow .who{min-width:0;display:flex;flex-direction:column}
.mwrow .who small{color:var(--muted);overflow-wrap:anywhere}
.mwcell .line{display:flex;gap:8px;flex-wrap:wrap}
.mwcell .line input{flex:1 1 180px}
.mwpick{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:10px 12px;text-align:left;display:flex;justify-content:space-between;gap:10px;width:100%}
.mwpick[aria-current="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.mwpick small{color:var(--muted)}
.mwi{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mwtop{display:flex;justify-content:space-between;align-items:center;gap:10px;position:sticky;top:-20px;margin:-20px 0 0;padding:20px 0 6px;background:var(--surface);z-index:1}
.mwx{border:0;background:var(--bg);color:var(--ink);width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:none}
.mwsec{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.mwhead{display:flex;align-items:center;gap:10px}
.mwhead h3{margin:0;font-size:1rem;flex:1;min-width:0}
.mwhead small{color:var(--muted);font-size:.8rem;font-weight:600}
.mwbadge{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
.mwsec p{margin:0;font-size:.86rem;color:var(--muted)}
.mwsec p .mwi{width:15px;height:15px;vertical-align:-3px}
.mwme{display:flex;align-items:center;gap:12px;padding:14px;border-radius:14px;background:var(--accent-soft)}
.mwme .who{flex:1;min-width:0;display:flex;flex-direction:column}
.mwme .who small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mwav{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:.95rem;flex:none}
.mwme .mwav{width:46px;height:46px;font-size:1.2rem;background:var(--accent);color:var(--onaccent)}
.mwrow .mwav{margin-right:2px}
.mwrow .who{flex:1}
.mwrole{font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--gold);color:var(--onaccent);align-self:flex-start;margin-top:3px}
.mwic{border:1px solid var(--line);background:none;color:var(--muted);width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none}
.mwic.danger:hover,.mwic.danger:focus-visible{color:var(--accent);border-color:var(--accent)}
.mwsec .btn{gap:7px}
.mwsec .btn .mwi{width:16px;height:16px}
.mwpick{align-items:center}
.mwpick > span{display:flex;align-items:center;gap:8px;min-width:0}
.mwpick small{display:flex;align-items:center;gap:4px;flex:none}
.mwpick small .mwi{width:14px;height:14px}
.mwpick .tick{color:var(--accent)}
.mwdanger{display:flex;flex-direction:column;gap:6px;padding:4px 2px}
.mwdanger button{border:0;background:none;color:var(--accent);font:inherit;font-size:.9rem;font-weight:600;display:inline-flex;align-items:center;gap:8px;padding:8px 0;align-self:flex-start}
.mwtech summary{cursor:pointer;color:var(--muted);font-size:.8rem;display:inline-flex;align-items:center;gap:6px;list-style:none}
.mwtech summary::-webkit-details-marker{display:none}
.mwmanage{align-self:flex-start;margin-top:4px;display:inline-flex;align-items:center;gap:6px;text-decoration:none;font-weight:600}
.mwmanage .mwi{width:15px;height:15px}
.mwtech p{font-size:.74rem;color:var(--muted);word-break:break-all;margin:6px 0 0}`;
  const ICONS = {
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>',
    userPlus: '<circle cx="10" cy="8" r="3.6"/><path d="M3 20c0-3.9 3.1-7 7-7 1.5 0 2.9.5 4 1.3"/><path d="M19 14v6M16 17h6"/>',
    userMinus: '<circle cx="10" cy="8" r="3.6"/><path d="M3 20c0-3.9 3.1-7 7-7 1.5 0 2.9.5 4 1.3"/><path d="M16 17h6"/>',
    cellar: '<path d="M3 21V10l9-6 9 6v11"/><path d="M8 21v-5a4 4 0 0 1 8 0v5"/>',
    stack: '<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'
  };
  const ico = n => `<svg class="mwi" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  const initial = s => esc((String(s || "?").trim()[0] || "?").toUpperCase());
  const head = (icon, title, extra = "") => `<div class="mwhead"><span class="mwbadge">${ico(icon)}</span><h3>${title}</h3>${extra}</div>`;
  function injectCss(){ const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); }

  const ERR = {
    "auth/invalid-email": "Dat e-mailadres klopt niet.",
    "auth/missing-password": "Vul je wachtwoord in.",
    "auth/weak-password": "Kies een wachtwoord van minstens 6 tekens.",
    "auth/email-already-in-use": "Er bestaat al een account met dit e-mailadres. Meld je aan.",
    "auth/invalid-credential": "E-mailadres of wachtwoord klopt niet.",
    "auth/wrong-password": "E-mailadres of wachtwoord klopt niet.",
    "auth/user-not-found": "Er is geen account met dit e-mailadres.",
    "auth/too-many-requests": "Te veel pogingen. Probeer het over een paar minuten opnieuw.",
    "auth/network-request-failed": "Geen verbinding. Controleer je internet.",
    "permission-denied": "Dat mag je niet doen in deze kelder."
  };
  const msgOf = e => ERR[e && e.code] || "Dat lukte niet. Probeer opnieuw.";

  function showLogin(note){
    let el = $("mwLogin");
    if(!el){ el = document.createElement("div"); el.id = "mwLogin"; el.className = "mwlogin"; document.body.appendChild(el); }
    let mode = "in";
    const invite = store.get("mw_join");
    const draw = (msg, ok) => {
      const keep = {name: $("mwName")?.value || "", email: $("mwEmail")?.value || ""};
      el.innerHTML = `<div class="in">
        <div><span class="eyebrow">Enoteca di casa</span><h1>Mijn <em>wijnkelder</em></h1></div>
        ${invite ? `<div class="box tonight"><b>Je bent uitgenodigd voor een gedeelde kelder.</b><span class="hint">Meld je aan of maak een account, dan word je meteen lid.</span></div>` : ""}
        ${note ? `<p class="hint">${esc(note)}</p>` : ""}
        <div class="seg" role="group"><button type="button" data-m="in" aria-pressed="${mode === "in"}">Aanmelden</button><button type="button" data-m="up" aria-pressed="${mode === "up"}">Account maken</button></div>
        <form id="mwForm" novalidate>
          ${mode === "up" ? `<label>Je naam<input id="mwName" autocomplete="name" placeholder="bv. Maarten" required></label>` : ""}
          <label>E-mailadres<input id="mwEmail" type="email" autocomplete="email" inputmode="email" required></label>
          ${mode === "reset" ? "" : `<label>Wachtwoord<input id="mwPass" type="password" autocomplete="${mode === "up" ? "new-password" : "current-password"}" required></label>`}
          ${msg ? `<p class="${ok ? "ok" : "err"}">${esc(msg)}</p>` : ""}
          <button class="btn" type="submit">${mode === "in" ? "Aanmelden" : mode === "up" ? "Account maken" : "Stuur herstel-mail"}</button>
        </form>
        ${mode === "in" ? `<button class="link" type="button" data-m="reset" style="align-self:flex-start">Wachtwoord vergeten?</button>` : mode === "reset" ? `<button class="link" type="button" data-m="in" style="align-self:flex-start">Terug naar aanmelden</button>` : ""}
      </div>`;
      if($("mwName")) $("mwName").value = keep.name;
      $("mwEmail").value = keep.email;
      el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
      $("mwForm").onsubmit = async e => {
        e.preventDefault();
        const email = $("mwEmail").value.trim(), pass = $("mwPass") ? $("mwPass").value : "";
        const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
        try{
          if(mode === "reset"){ await auth.sendPasswordResetEmail(email); mode = "in"; draw("Check je mailbox voor een link om een nieuw wachtwoord te kiezen.", true); return; }
          if(mode === "up"){
            const name = $("mwName").value.trim();
            if(!name){ draw("Vul je naam in."); return; }
            pendingName = name;
            await auth.createUserWithEmailAndPassword(email, pass);
          } else {
            await auth.signInWithEmailAndPassword(email, pass);
          }
        }catch(err){ draw(msgOf(err)); }
      };
    };
    draw();
  }
  function hideLogin(){ const el = $("mwLogin"); if(el) el.remove(); }

  // ---------- cellars ----------
  const cellarsCol = () => fs.collection("cellars");
  async function myCellars(uid){
    const snap = await cellarsCol().where("memberIds", "array-contains", uid).get();
    return snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  }
  async function createCellar(name){
    const me = cloud.me, ref = cellarsCol().doc();
    await ref.set({name, owner: me.uid, memberIds: [me.uid], members: {[me.uid]: {name: me.name, email: me.email, role: "owner"}},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()});
    return ref.id;
  }
  async function joinWithCode(code){
    const inv = await fs.doc("invites/" + code).get();
    if(!inv.exists) throw Object.assign(new Error("invite"), {code: "invite-missing"});
    const d = inv.data();
    if(d.expiresAt && d.expiresAt.toMillis() < Date.now()) throw Object.assign(new Error("invite"), {code: "invite-expired"});
    const me = cloud.me;
    const already = await fs.doc("cellars/" + d.cellarId).get().then(s => s.exists && (s.data().memberIds || []).includes(me.uid)).catch(() => false);
    if(already) return d.cellarId;
    await fs.doc("cellars/" + d.cellarId).update({
      memberIds: firebase.firestore.FieldValue.arrayUnion(me.uid),
      ["members." + me.uid]: {name: me.name, email: me.email, role: "member"},
      lastJoin: {uid: me.uid, code}
    });
    return d.cellarId;
  }

  async function start(user){
    if(cloud.me) return;
    hideLogin();
    cloud.me = {uid: user.uid, name: "", email: user.email || ""};
    if(pendingName){ await user.updateProfile({displayName: pendingName}).catch(() => {}); await fs.doc("users/" + user.uid).set({name: pendingName, email: cloud.me.email}, {merge: true}).catch(() => {}); }
    const prof = pendingName ? null : await fs.doc("users/" + user.uid).get().catch(() => null);
    const name = pendingName || user.displayName || (prof && prof.exists && prof.data().name) || (user.email || "").split("@")[0];
    cloud.me.name = name;
    cloud.prefs = normPrefs(prof && prof.exists ? prof.data().prefs : null);
    $("status").textContent = "Je kelders worden geladen…";

    let notice = "";
    const code = store.get("mw_join");
    if(code){
      store.set("mw_join", null);
      try{ const q = new URLSearchParams(location.search); q.delete("join"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }catch{}
      try{ const id = await joinWithCode(code); store.set("mw_cellar_" + user.uid, id); notice = "Je bent lid van de gedeelde kelder."; }
      catch(e){ notice = e.code === "invite-expired" ? "Deze uitnodiging is verlopen. Vraag een nieuwe link." : e.code === "invite-missing" ? "Deze uitnodiging bestaat niet meer. Vraag een nieuwe link." : "Lid worden lukte niet: " + msgOf(e); }
    }

    let list = [];
    try{ list = await myCellars(user.uid); }catch(e){ $("status").textContent = "Je kelders konden niet geladen worden. " + msgOf(e); return; }
    if(!list.length){ await createCellar("Kelder van " + name); list = await myCellars(user.uid); }
    cloud.cellars = list;
    const want = store.get("mw_cellar_" + user.uid);
    cloud.cellar = list.find(c => c.id === want) || list[0];
    store.set("mw_cellar_" + user.uid, cloud.cellar.id);
    $("status").textContent = notice;

    // keep membership changes (renames, new members, being removed) up to date
    fs.doc("cellars/" + cloud.cellar.id).onSnapshot(s => {
      if(!s.exists){ return; }
      cloud.cellar = {id: s.id, ...s.data()};
      if(!(cloud.cellar.memberIds || []).includes(user.uid)){ store.set("mw_cellar_" + user.uid, null); location.reload(); return; }
      paintHeader(); if($("mwAcct") && typeof paintBell === "function") paintBell(); if(!$("mwSheet").hidden) drawSheet();
    }, () => {});
    paintHeader();

    const winesCol = fs.collection("cellars/" + cloud.cellar.id + "/wines");
    startBell(winesCol, user.uid);
    const db = {
      // includeMetadataChanges: also tell the app when the server confirms what the offline copy showed,
      // otherwise an unchanged cellar never reports "up to date" and the app keeps waiting.
      collection: path => (/^data\/users\//.test(path) ? Object.assign(Object.create(winesCol), {
        onSnapshot: (cb, err) => winesCol.onSnapshot({includeMetadataChanges: true}, cb, err),
        doc: (...a) => winesCol.doc(...a), get: (...a) => winesCol.get(...a)
      }) : fs.collection("unused")),
      doc: path => { throw Object.assign(new Error("not available"), {code: "unavailable", path}); }
    };
    resolveReady({db, user: {id: async () => cloud.cellar.id, name: async () => name}, downloads: window.mwLocal.downloads,
      sample: window.MW_AI_URL && window.mwAi ? window.mwAi.make(window.MW_AI_URL, () => auth.currentUser.getIdToken()) : null, mcp: null});
  }

  // ---------- taste profile: users/{uid}.prefs ----------
  const PREF_COLORS = {rood: "Rood", wit: "Wit", rose: "Rosé", mousserend: "Mousserend", dessert: "Dessert"};
  const splitList = v => String(v || "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 30);
  function normPrefs(p){
    p = p || {};
    return {colors: (Array.isArray(p.colors) ? p.colors : []).filter(c => PREF_COLORS[c]),
      grapes: Array.isArray(p.grapes) ? p.grapes : [], regions: Array.isArray(p.regions) ? p.regions : [],
      avoid: Array.isArray(p.avoid) ? p.avoid : [], note: String(p.note || "").slice(0, 300)};
  }
  const hasPrefs = p => p && (p.colors.length || p.grapes.length || p.regions.length || p.avoid.length || p.note);
  window.mwPrefs = {get: () => cloud.prefs || null, has: () => !!hasPrefs(cloud.prefs)};
  let prefDraft = null;
  function prefsHtml(){
    const d = prefDraft || (prefDraft = {...cloud.prefs, grapesTxt: cloud.prefs.grapes.join(", "), regionsTxt: cloud.prefs.regions.join(", "), avoidTxt: cloud.prefs.avoid.join(", ")});
    const sugg = (window.mwSuggest && window.mwSuggest()) || [];
    return `<section class="mwsec">${head("heart", "Mijn smaak", `<small>alleen jij</small>`)}
      <p>Daarmee kun je in de kelder filteren op "Mijn smaak", en houdt "Wat drink ik vanavond?" er rekening mee. Alleen jij past dit aan; het geldt in al je kelders.</p>
      <div class="mwchips">${Object.entries(PREF_COLORS).map(([k, v]) => `<button type="button" class="chip" data-pcolor="${k}" aria-pressed="${d.colors.includes(k)}"><span class="dot ${k}"></span>${v}</button>`).join("")}</div>
      <label class="mwlab">Favoriete druiven<input id="mwPG" data-pf="grapesTxt" list="mwSugg" value="${esc(d.grapesTxt)}" placeholder="bv. Albariño, Tempranillo"></label>
      <label class="mwlab">Favoriete streken of landen<input id="mwPR" data-pf="regionsTxt" list="mwSugg" value="${esc(d.regionsTxt)}" placeholder="bv. Rioja, Douro, Portugal"></label>
      <label class="mwlab">Liever niet<input id="mwPA" data-pf="avoidTxt" list="mwSugg" value="${esc(d.avoidTxt)}" placeholder="bv. Chardonnay, zoete wijn"></label>
      <label class="mwlab">In je eigen woorden (optioneel)<input id="mwPN" data-pf="note" value="${esc(d.note)}" placeholder="bv. fris en droog, niet te veel hout"></label>
      <datalist id="mwSugg">${sugg.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      <div><button class="btn sm" type="button" data-a="prefs">${ico("check")}Bewaar mijn smaak</button></div></section>`;
  }
  async function savePrefs(){
    const d = prefDraft;
    const p = normPrefs({colors: d.colors, grapes: splitList(d.grapesTxt), regions: splitList(d.regionsTxt), avoid: splitList(d.avoidTxt), note: d.note});
    await fs.doc("users/" + cloud.me.uid).set({prefs: p}, {merge: true});
    cloud.prefs = p; prefDraft = null;
    window.dispatchEvent(new Event("mwprefs"));
  }

  // ---------- bell: wines other members added ----------
  // Each new wine carries addedBy {uid, name} and createdAt. The bell lists those added by
  // someone else since you last looked; "last looked" is kept in your profile (users/{uid}),
  // so it is the same on every device.
  let bellNew = [], bellRecent = [], bellSeen = 0;
  async function startBell(winesCol, uid){
    const cid = cloud.cellar.id, prof = fs.doc("users/" + uid);
    try{ const p = await prof.get(); bellSeen = (p.exists && p.data().seen && p.data().seen[cid]) || 0; }catch{}
    if(!bellSeen){ bellSeen = Date.now(); prof.set({seen: {[cid]: bellSeen}}, {merge: true}).catch(() => {}); }
    const since = Date.now() - 30 * 864e5;
    winesCol.where("createdAt", ">", since).onSnapshot(snap => {
      bellRecent = snap.docs.map(d => ({id: d.id, ...d.data()}))
        .filter(w => w.addedBy && w.addedBy.uid && w.addedBy.uid !== uid)
        .sort((a, b) => b.createdAt - a.createdAt);
      bellNew = bellRecent.filter(w => w.createdAt > bellSeen);
      paintBell();
    }, () => {});
    window.mwBellSeen = () => {
      bellSeen = Date.now(); bellNew = [];
      prof.set({seen: {[cid]: bellSeen}}, {merge: true}).catch(() => {}); paintBell();
    };
  }
  function paintBell(){
    const shared = (cloud.cellar.memberIds || []).length > 1 || bellRecent.length;
    let b = $("mwBell");
    if(!shared){ if(b) b.hidden = true; return; }
    if(!b){
      b = document.createElement("button"); b.id = "mwBell"; b.type = "button"; b.className = "btn ghost sm mwbell";
      b.onclick = () => { const p = $("mwBellPanel"); if(!p.hidden){ p.hidden = true; return; } drawBellPanel(); p.style.top = Math.round(b.getBoundingClientRect().bottom + 8) + "px"; p.hidden = false; };
      ($("hdrBtns") || $("mwAcct").parentNode).prepend(b);
      const p = document.createElement("div"); p.id = "mwBellPanel"; p.className = "mwbellp"; p.hidden = true;
      p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Meldingen");
      document.body.appendChild(p);
      p.addEventListener("click", e => {
        const g = e.target.closest("[data-bellgo]");
        if(g){ p.hidden = true; window.mwBellSeen(); window.mwGoTo && window.mwGoTo(g.dataset.bellgo); }
        if(e.target.closest("[data-bellok]")){ p.hidden = true; window.mwBellSeen(); }
      });
      document.addEventListener("click", e => { if(!p.hidden && !p.contains(e.target) && !b.contains(e.target)) p.hidden = true; });
    }
    b.hidden = false;
    const n = bellNew.length;
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>${n ? `<span class="dot">${n > 9 ? "9+" : n}</span>` : ""}`;
    b.setAttribute("aria-label", n ? `${n} nieuwe wijn${n === 1 ? "" : "en"} toegevoegd door anderen` : "Meldingen");
    if(!$("mwBellPanel").hidden) drawBellPanel();
  }
  function drawBellPanel(){
    const when = t => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? "vandaag" : d === 1 ? "gisteren" : d + " dagen geleden"; };
    const list = bellNew.length ? bellNew : bellRecent.slice(0, 5);
    $("mwBellPanel").innerHTML = `<h3>${bellNew.length ? "Nieuw in " + esc(cloud.cellar.name) : "Niets nieuws"}</h3>
      ${!bellNew.length && list.length ? `<p class="hint">Eerder toegevoegd door anderen:</p>` : ""}
      ${list.length ? list.map(w => `<button type="button" class="mwbelli${w.createdAt > bellSeen ? " new" : ""}" data-bellgo="${esc(w.id)}"><b>${esc(w.name || "Wijn")}${w.vintage ? " " + esc(w.vintage) : ""}</b><small>${esc(w.addedBy.name || "Iemand")} · ${w.status === "wens" ? "verlanglijst" : "kelder"} · ${when(w.createdAt)}</small></button>`).join("")
        : `<p class="hint">Hier zie je het als iemand anders een wijn toevoegt aan deze kelder.</p>`}
      ${bellNew.length ? `<div><button class="btn ghost sm" type="button" data-bellok="1">Alles gezien</button></div>` : ""}`;
  }

  function openSheet(){
    $("mwSheet").hidden = false; drawSheet();
    myCellars(cloud.me.uid).then(l => { cloud.cellars = l; if(!$("mwSheet").hidden) drawSheet(); }).catch(() => {});
  }
  function togglePick(b){
    let p = $("mwPick");
    if(!p){
      p = document.createElement("div"); p.id = "mwPick"; p.className = "mwbellp mwpickp"; p.hidden = true;
      p.setAttribute("role", "menu"); p.setAttribute("aria-label", "Kies een kelder");
      document.body.appendChild(p);
      p.addEventListener("click", e => {
        const s = e.target.closest("[data-pick]");
        if(s){ if(s.dataset.pick !== cloud.cellar.id){ store.set("mw_cellar_" + cloud.me.uid, s.dataset.pick); location.reload(); } else p.hidden = true; }
        if(e.target.closest("[data-manage]")){ p.hidden = true; openSheet(); }
      });
      document.addEventListener("click", e => { if(!p.hidden && !p.contains(e.target) && !$("mwAcct").contains(e.target)) p.hidden = true; });
    }
    if(!p.hidden){ p.hidden = true; return; }
    const draw = () => {
      p.innerHTML = cloud.cellars.map(x => { const cur = x.id === cloud.cellar.id, n = (x.memberIds || []).length;
        return `<button type="button" class="mwbelli" role="menuitemradio" aria-checked="${cur}" data-pick="${esc(x.id)}"><b>${cur ? "✓ " : ""}${esc(cur ? cloud.cellar.name : x.name)}</b><small>${n > 1 ? n + " leden" : "alleen jij"}${x.owner !== cloud.me.uid ? " · gedeeld" : ""}</small></button>`; }).join("")
        + `<button type="button" class="link mwmanage" data-manage="1">${ico("gear")}Instellingen</button>`;
    };
    draw();
    const r = b.getBoundingClientRect();
    p.style.top = Math.round(r.bottom + 8) + "px"; p.style.left = Math.max(16, Math.round(r.left)) + "px"; p.style.right = "auto";
    p.hidden = false;
    myCellars(cloud.me.uid).then(l => { cloud.cellars = l; if(!p.hidden) draw(); }).catch(() => {});
  }

  // ---------- header + cellar sheet ----------
  function paintHeader(){
    let b = $("mwAcct");
    if(!b){
      const host = document.querySelector("header");
      b = document.createElement("button"); b.id = "mwAcct"; b.type = "button"; b.className = "btn ghost sm mwacct";
      // With more than one cellar the button is a quick switcher; managing (invites, account) sits one step further.
      b.onclick = () => { if(cloud.cellars.length > 1) togglePick(b); else openSheet(); };
      host.appendChild(b);
    }
    const n = (cloud.cellar.memberIds || []).length;
    const many = cloud.cellars.length > 1;
    b.innerHTML = `${ico(n > 1 ? "users" : "user")}<span>${esc(cloud.cellar.name)}</span>${many ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>` : ""}`;
    b.setAttribute("aria-label", (many ? "Kies een kelder: " : "Instellingen: ") + cloud.cellar.name);
  }

  let sheetMsg = "", inviteLink = "", localCount = null;
  function makeSheet(){
    const sh = document.createElement("div"); sh.className = "sheet"; sh.id = "mwSheet"; sh.hidden = true;
    sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="mwSheetTitle">
      <div class="mwtop"><h2 id="mwSheetTitle">Instellingen</h2><button class="mwx" type="button" id="mwClose" aria-label="Sluiten">${ico("close")}</button></div>
      <div class="mwcell" id="mwBody"></div></div>`;
    document.body.appendChild(sh);
    const close = () => { sh.hidden = true; sheetMsg = ""; inviteLink = ""; prefDraft = null; };
    $("mwClose").onclick = close;
    sh.addEventListener("click", e => { if(e.target === sh) close(); });
    document.addEventListener("keydown", e => { if(e.key === "Escape" && !sh.hidden) close(); });
    $("mwBody").addEventListener("click", onSheetClick);
    $("mwBody").addEventListener("input", e => { const k = e.target.dataset.pf; if(k && prefDraft) prefDraft[k] = e.target.value; });
  }
  function drawSheet(){
    const c = cloud.cellar, me = cloud.me, owner = c.owner === me.uid;
    const members = Object.entries(c.members || {}).filter(([uid]) => (c.memberIds || []).includes(uid))
      .sort((a, b) => (b[1].role === "owner") - (a[1].role === "owner"));
    if(localCount === null) countLocal();
    const keepNew = $("mwNew")?.value || "", keepName = $("mwRename")?.value, focus = document.activeElement?.id;
    const ownerName = (c.members?.[c.owner] || {}).name || "de eigenaar";
    $("mwBody").innerHTML = `
      ${sheetMsg ? `<p class="err">${esc(sheetMsg)}</p>` : ""}
      <div class="mwme"><span class="mwav">${initial(me.name)}</span>
        <span class="who"><b>${esc(me.name)}</b><small>${esc(me.email)}</small></span>
        <button class="btn ghost sm" type="button" data-a="logout">${ico("logout")}Afmelden</button></div>

      <section class="mwsec">${head("cellar", "Deze kelder", owner ? "" : `<small>van ${esc(ownerName)}</small>`)}
        ${owner ? `<div class="line"><input id="mwRename" value="${esc(c.name)}" aria-label="Naam van de kelder"><button class="btn ghost sm" type="button" data-a="rename">${ico("pencil")}Hernoem</button></div>`
          : `<p>Je bent lid van <b>${esc(c.name)}</b>. Je ziet en bewerkt dezelfde wijnen als de anderen.</p>`}
      </section>

      <section class="mwsec">${head("users", "Wie kan meekijken", `<small>${members.length} ${members.length === 1 ? "persoon" : "personen"}</small>`)}
        <div>${members.map(([uid, m]) => `<div class="mwrow"><span class="mwav">${initial(m.name)}</span><span class="who"><b>${esc(m.name)}${uid === me.uid ? " (jij)" : ""}</b><small>${esc(m.email)}</small>${m.role === "owner" ? `<span class="mwrole">Eigenaar</span>` : ""}</span>
          ${owner && uid !== me.uid ? `<button class="mwic danger" type="button" data-a="kick" data-uid="${esc(uid)}" aria-label="${esc(m.name)} verwijderen" title="Verwijder uit de kelder">${ico("userMinus")}</button>` : ""}</div>`).join("")}</div>
        ${inviteLink ? `<p>${ico("link")} Stuur deze link naar wie je wilt uitnodigen. Hij werkt 7 dagen.</p>
          <div class="line"><input id="mwLink" readonly value="${esc(inviteLink)}"><button class="btn sm" type="button" data-a="copy">${ico("copy")}Kopieer</button>${navigator.share ? `<button class="btn ghost sm" type="button" data-a="share">${ico("share")}Deel</button>` : ""}</div>`
          : `<div><button class="btn sm" type="button" data-a="invite">${ico("userPlus")}Nodig iemand uit</button></div>`}
      </section>

      <section class="mwsec">${head("stack", "Je kelders", `<small>${cloud.cellars.length}</small>`)}
        ${cloud.cellars.length > 1 ? `<p>Tik op een kelder om ernaar te wisselen.</p>` : ""}
        ${cloud.cellars.map(x => { const cur = x.id === c.id, n = (x.memberIds || []).length; return `<button class="mwpick" type="button" data-a="switch" data-id="${esc(x.id)}" aria-current="${cur}"><span>${cur ? `<span class="tick">${ico("check")}</span>` : ico("cellar")}<span>${esc(cur ? c.name : x.name)}</span></span><small>${n > 1 ? ico("users") + n : ico("user") + "alleen jij"}${x.owner !== me.uid ? " · gedeeld" : ""}</small></button>`; }).join("")}
        <div class="line"><input id="mwNew" placeholder="Naam nieuwe kelder, bv. Wijnclub" aria-label="Naam nieuwe kelder"><button class="btn ghost sm" type="button" data-a="new">${ico("plus")}Maak</button></div>
      </section>

      ${localCount ? `<section class="mwsec">${head("phone", "Wijnen op dit toestel")}<p>Op dit toestel staan nog ${localCount} wijn${localCount === 1 ? "" : "en"} van voor je je aanmeldde. Zet ze in "${esc(c.name)}".</p>
        <div><button class="btn sm" type="button" data-a="migrate">${ico("upload")}Zet ze in deze kelder</button></div></section>` : ""}

      ${prefsHtml()}

      <div class="mwdanger">
        ${owner ? (cloud.cellars.length > 1 ? `<button type="button" data-a="delcellar">${ico("trash")}Verwijder deze kelder</button>` : "") : `<button type="button" data-a="leave">${ico("logout")}Verlaat deze kelder</button>`}
        <details class="mwtech"><summary>${ico("info")}Technische gegevens</summary><p>Gebruikers-id: <span style="user-select:all">${esc(me.uid)}</span></p></details>
      </div>`;
    if($("mwNew")) $("mwNew").value = keepNew;
    if($("mwRename") && keepName !== undefined && focus === "mwRename") $("mwRename").value = keepName;
    if(focus && $(focus)) $(focus).focus();
  }
  async function countLocal(){
    localCount = 0;
    try{
      if(store.get("mw_migrated_" + cloud.me.uid)) return;
      const s = await window.mwLocal.db.collection("data/users/local").get();
      localCount = s.size; if(localCount && !$("mwSheet").hidden) drawSheet();
    }catch{}
  }
  async function onSheetClick(e){
    const pc = e.target.closest("[data-pcolor]");
    if(pc && prefDraft){ const k = pc.dataset.pcolor; prefDraft.colors = prefDraft.colors.includes(k) ? prefDraft.colors.filter(x => x !== k) : [...prefDraft.colors, k]; pc.setAttribute("aria-pressed", prefDraft.colors.includes(k)); return; }
    const b = e.target.closest("[data-a]"); if(!b) return;
    const a = b.dataset.a, c = cloud.cellar, F = firebase.firestore.FieldValue;
    sheetMsg = "";
    try{
      if(a === "switch"){ if(b.dataset.id !== c.id){ store.set("mw_cellar_" + cloud.me.uid, b.dataset.id); location.reload(); } return; }
      if(a === "new"){ const n = $("mwNew").value.trim(); if(!n){ $("mwNew").focus(); return; } b.disabled = true; const id = await createCellar(n); store.set("mw_cellar_" + cloud.me.uid, id); location.reload(); return; }
      if(a === "rename"){ const n = $("mwRename").value.trim(); if(n && n !== c.name){ await fs.doc("cellars/" + c.id).update({name: n}); cloud.cellars = cloud.cellars.map(x => x.id === c.id ? {...x, name: n} : x); } return; }
      if(a === "invite"){
        b.disabled = true;
        const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), x => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
        await fs.doc("invites/" + code).set({cellarId: c.id, cellarName: c.name, by: cloud.me.uid, byName: cloud.me.name,
          createdAt: F.serverTimestamp(), expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 7 * 864e5)});
        inviteLink = location.origin + location.pathname + "?join=" + code + (EMU ? "&emu=1" : "");
        drawSheet(); return;
      }
      if(a === "copy"){ try{ await navigator.clipboard.writeText(inviteLink); b.innerHTML = ico("check") + "Gekopieerd"; }catch{ $("mwLink").select(); } return; }
      if(a === "share"){ try{ await navigator.share({title: "Mijn wijnkelder", text: `${cloud.me.name} nodigt je uit voor de wijnkelder "${c.name}".`, url: inviteLink}); }catch{} return; }
      if(a === "kick"){
        const uid = b.dataset.uid, m = (c.members || {})[uid] || {};
        if(!confirm(`${m.name || "Dit lid"} verwijderen uit "${c.name}"?`)) return;
        await fs.doc("cellars/" + c.id).update({memberIds: F.arrayRemove(uid), ["members." + uid]: F.delete()}); return;
      }
      if(a === "leave"){
        if(!confirm(`"${c.name}" verlaten? Je ziet deze wijnen dan niet meer.`)) return;
        await fs.doc("cellars/" + c.id).update({memberIds: F.arrayRemove(cloud.me.uid), ["members." + cloud.me.uid]: F.delete()});
        store.set("mw_cellar_" + cloud.me.uid, null); location.reload(); return;
      }
      if(a === "delcellar"){
        const col = fs.collection("cellars/" + c.id + "/wines"), snap = await col.get(), n = snap.size;
        if(!confirm(`"${c.name}" definitief verwijderen${n ? `, met de ${n} wijn${n === 1 ? "" : "en"} erin` : ""}? Dit kan niet ongedaan gemaakt worden.${(c.memberIds || []).length > 1 ? " De andere leden verliezen de kelder ook." : ""}`)) return;
        b.disabled = true; b.textContent = "Bezig…";
        let batch = fs.batch(), k = 0;
        for(const d of snap.docs){ batch.delete(d.ref); if(++k % 400 === 0){ await batch.commit(); batch = fs.batch(); } }
        await batch.commit();
        await fs.doc("cellars/" + c.id).delete();
        store.set("mw_cellar_" + cloud.me.uid, null); location.reload(); return;
      }
      if(a === "migrate"){
        b.disabled = true; b.textContent = "Bezig…";
        const s = await window.mwLocal.db.collection("data/users/local").get();
        const col = fs.collection("cellars/" + c.id + "/wines");
        let batch = fs.batch(), n = 0;
        for(const d of s.docs){ batch.set(col.doc(d.id), d.data()); if(++n % 400 === 0){ await batch.commit(); batch = fs.batch(); } }
        await batch.commit();
        store.set("mw_migrated_" + cloud.me.uid, "1"); localCount = 0; sheetMsg = ""; drawSheet();
        $("status").textContent = `${n} wijn${n === 1 ? "" : "en"} overgezet naar "${c.name}".`; return;
      }
      if(a === "prefs"){ b.disabled = true; await savePrefs(); sheetMsg = ""; drawSheet(); $("status").textContent = "Je smaak is bewaard."; return; }
      if(a === "logout"){ await auth.signOut(); store.set("mw_cellar_" + cloud.me.uid, null); location.reload(); return; }
    }catch(err){ sheetMsg = msgOf(err); drawSheet(); }
  }

  // ---------- boot ----------
  (async () => {
    try{
      await loadScript(BASE + "firebase-app-compat.js");
      await Promise.all([loadScript(BASE + "firebase-auth-compat.js"), loadScript(BASE + "firebase-firestore-compat.js")]);
    }catch{ $("status").textContent = "Aanmelden kan niet geladen worden. Controleer je internet en herlaad."; return; }
    fb = firebase.initializeApp(cfg); auth = firebase.auth(); fs = firebase.firestore();
    fs.settings({ignoreUndefinedProperties: true});
    if(EMU){ auth.useEmulator("http://localhost:9099", {disableWarnings: true}); fs.useEmulator("localhost", 8085); }
    else fs.enablePersistence({synchronizeTabs: true}).catch(() => {});
    injectCss(); makeSheet();
    $("status").textContent = "";
    auth.onAuthStateChanged(u => { if(u) start(u); else if(!cloud.me) showLogin(); });
  })();
})();
