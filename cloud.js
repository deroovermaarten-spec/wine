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
  // Same for an event invite (events.js picks it up once you are signed in).
  const eventParam = params.get("event");
  if(eventParam) store.set("mw_event", eventParam.replace(/[^A-Za-z0-9]/g, "").slice(0, 32));

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
.mwsec select{font:inherit;font-size:.95rem;font-weight:400;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.mwcheck{display:flex;gap:8px;align-items:center;font-size:.9rem;font-weight:600}
.mwcheck input{width:18px;height:18px;accent-color:var(--accent)}
.rmrow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rmon{display:inline-flex;gap:6px;align-items:center;font-weight:600;color:var(--ok)}
.mwsec .btn svg{width:16px;height:16px}
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
.mwskins{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.mwskin{display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px;min-width:0}
.mwskin[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.mwskin .sw{display:flex;width:100%;height:30px;border-radius:8px;overflow:hidden;border:1px solid var(--line)}
.mwskin .sw i{flex:1}.mwskin .sw i:first-child{flex:2}
.mwskin b{font-size:.92rem;display:flex;align-items:center;gap:5px}.mwskin b .mwi{width:15px;height:15px;color:var(--accent)}
.mwskin small{color:var(--muted);font-size:.76rem;line-height:1.3}
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
.mwtech p{font-size:.74rem;color:var(--muted);word-break:break-all;margin:6px 0 0}
.mwapp{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none}
.mwapp::-webkit-details-marker{display:none}
.mwapp > span{flex:1}
.mwchev{color:var(--muted);transition:transform .2s}
.mwabout[open] .mwchev{transform:rotate(180deg)}
.mwabout:not([open]){gap:0}
.mwabout p.mwtag{margin:0}
.mwapp img{border-radius:12px;flex:none}
.mwapp span{display:flex;flex-direction:column;min-width:0}
.mwapp b{font:500 1.15rem var(--display)}
.mwapp small{color:var(--muted);font-size:.84rem}
.mwfacts{display:flex;flex-direction:column;border-top:1px solid var(--line)}
.mwfacts > div{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.mwfacts > div:last-child{border-bottom:0;padding-bottom:0}
.mwfacts .mwi{color:var(--accent);margin-top:1px}
.mwfacts span{display:flex;flex-direction:column;min-width:0;font-size:.88rem}
.mwfacts small{color:var(--muted);font-size:.82rem}
.mwcopy{display:flex;align-items:center;justify-content:center;gap:6px;color:var(--muted);font-size:.76rem;padding:4px 0 8px;text-align:center}
.mwcopy .mwi{width:14px;height:14px}
.mwglass{width:56px;height:84px;display:block;margin:0 auto;overflow:visible}
.mwglass .gl{fill:none;stroke:var(--ink);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
.mwglass .mwwine,.mwglass .mwstream{fill:#9b1c2c}
.mwglass .mwwine{transform:translateY(38px);animation:mwfill 1.8s .45s cubic-bezier(.3,.6,.4,1) forwards}
.mwglass .mwstream{transform-box:fill-box;transform-origin:top;transform:scaleY(0);animation:mwpour 2.4s .1s ease-in-out forwards}
@keyframes mwfill{to{transform:translateY(16px)}}
@keyframes mwpour{18%{transform:scaleY(1);opacity:1}85%{transform:scaleY(1);opacity:1}100%{transform:scaleY(1);opacity:0}}
@media (prefers-reduced-motion:reduce){.mwglass .mwwine{animation:none;transform:translateY(16px)}.mwglass .mwstream{display:none}}
.mwcheer{position:fixed;z-index:25;left:50%;top:50%;transform:translate(-50%,-50%);width:min(260px,calc(100% - 32px));background:var(--surface);color:var(--ink);
  border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 32px rgba(0,0,0,.2);padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;
  transition:opacity .4s}
.mwcheer b{font:400 1.2rem var(--display)}
.mwcheer span{font-size:.86rem;color:var(--muted)}
.mwcheer.out{opacity:0}`;
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
    copyright: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.4a4 4 0 1 0 0 5.2"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    glass: '<path d="M7 3h10c0 6-2 9-5 9.5C9 12 7 9 7 3z"/><path d="M12 12.5V20M8.5 21h7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    gear: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
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
        ${invite ? `<div class="box tonight"><b>Je bent uitgenodigd voor een gedeelde kelder.</b><span class="hint">Meld je aan of maak een account, dan word je meteen lid.</span></div>`
          : store.get("mw_event") ? `<div class="box tonight"><b>Je bent uitgenodigd voor een event.</b><span class="hint">Meld je aan of maak een account, dan zie je meteen welke wijnen er gedronken worden.</span></div>` : ""}
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
    if(already) return {id: d.cellarId, fresh: false};
    await fs.doc("cellars/" + d.cellarId).update({
      memberIds: firebase.firestore.FieldValue.arrayUnion(me.uid),
      ["members." + me.uid]: {name: me.name, email: me.email, role: "member"},
      lastJoin: {uid: me.uid, code}
    });
    return {id: d.cellarId, fresh: true};
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
    // The fact of the day is kept on the profile too: the browser's own storage does not always survive reopening the app.
    cloud.fact = (prof && prof.exists && prof.data().fact) || null;
    cloud.saveFact = v => { cloud.fact = v; return fs.doc("users/" + user.uid).set({fact: v}, {merge: true}).catch(() => {}); };
    $("status").textContent = "Je kelders worden geladen…";

    let notice = "", joined = false;
    const code = store.get("mw_join");
    if(code){
      store.set("mw_join", null);
      try{ const q = new URLSearchParams(location.search); q.delete("join"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }catch{}
      try{ const j = await joinWithCode(code); store.set("mw_cellar_" + user.uid, j.id); notice = "Je bent lid van de gedeelde kelder."; joined = j.fresh; }
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
      window.mwRender && window.mwRender(); // who may edit can change (owner's switch)
    }, () => {});
    paintHeader();
    if(pendingName) showWelcome();
    else if(joined) cheer("Welkom in de kelder!", `Je bent nu lid van "${cloud.cellar.name}". Schollekes!`);
    else if(store.get("mw_new")){
      const [first, id] = store.get("mw_new").split(":"); store.set("mw_new", null);
      if(id === cloud.cellar.id) cheer(first === "1" ? "Je eerste kelder!" : "Nieuwe kelder!", `"${cloud.cellar.name}" staat klaar. Schollekes!`);
    }

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
    // shared with events.js
    cloud.fs = fs;
    cloud.ui = {esc, ico, head, initial, glassSvg, cheer, msgOf, store};
    resolveReady({db, user: {id: async () => cloud.cellar.id, name: async () => name}, downloads: window.mwLocal.downloads,
      sample: window.MW_AI_URL && window.mwAi ? window.mwAi.make(window.MW_AI_URL, () => auth.currentUser.getIdToken()) : null, mcp: null});
  }

  // ---------- new or joined cellar: a small glass that fills with wine (CSS only, runs once) ----------
  let glassN = 0;
  function glassSvg(){
    const id = "mwBowl" + (++glassN);
    return `<svg class="mwglass" viewBox="0 0 64 96" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="M14 8h36c0 22-6 34-18 36C20 42 14 30 14 8z"/></clipPath></defs>
      <rect class="mwstream" x="31" y="-6" width="2" height="50" rx="1"/>
      <g clip-path="url(#${id})"><rect class="mwwine" x="0" y="8" width="64" height="40"/></g>
      <path class="gl" d="M14 8h36c0 22-6 34-18 36C20 42 14 30 14 8zM32 44v36M20 84h24"/></svg>`;
  }
  function cheer(title, text){
    const el = document.createElement("div"); el.className = "mwcheer"; el.setAttribute("role", "status");
    el.innerHTML = `${glassSvg()}<b>${esc(title)}</b><span>${esc(text)}</span>`;
    document.body.appendChild(el);
    const bye = () => { el.classList.add("out"); setTimeout(() => el.remove(), 400); };
    el.onclick = bye; setTimeout(bye, 3600);
  }

  // ---------- welcome: shown once, right after someone creates their account ----------
  function showWelcome(){
    const c = cloud.cellar, own = c.owner === cloud.me.uid;
    const sh = document.createElement("div"); sh.className = "sheet"; sh.id = "mwWelcome";
    sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="mwWelcomeTitle">
      ${glassSvg()}
      <div><span class="eyebrow">Enoteca di casa</span><h2 id="mwWelcomeTitle">Welkom, ${esc(cloud.me.name)}!</h2></div>
      ${own
        ? `<p>Fijn dat je er bent. Je hebt nu je eigen kelder, <b>${esc(c.name)}</b>. Hij is nog leeg en alleen jij ziet hem.</p>`
        : `<p>Fijn dat je er bent. Je bent nu lid van de kelder <b>${esc(c.name)}</b> en ziet dezelfde wijnen als de andere leden.</p>`}
      <section class="mwsec">${head("plus", "Je eerste fles")}<p>Voeg een wijn toe met de knop onderaan. Bewaar flessen in de kelder, of zet ze op je verlanglijst om ze later terug te vinden.</p></section>
      <section class="mwsec">${head("cellar", "Je kelder")}<p>Tik bovenaan op de naam van je kelder om hem een andere naam te geven, een nieuwe kelder te maken of iemand uit te nodigen.</p></section>
      <section class="mwsec">${head("heart", "Je smaak")}<p>Vul daar ook "Mijn smaak" in. Dan kun je filteren op wat jij lekker vindt.</p></section>
      <div class="actions"><button class="btn" type="button" id="mwWelcomeGo">Aan de slag</button></div></div>`;
    document.body.appendChild(sh);
    const close = () => { sh.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if(e.key === "Escape") close(); };
    $("mwWelcomeGo").onclick = close;
    sh.addEventListener("click", e => { if(e.target === sh) close(); });
    document.addEventListener("keydown", onKey);
    $("mwWelcomeGo").focus();
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
  // Sfeer: the southern skins from index.html (window.mwSkin), per device.
  function skinHtml(){
    const S = window.mwSkin; if(!S) return "";
    const cur = S.get();
    return `<section class="mwsec">${head("spark", "Sfeer", `<small>dit toestel</small>`)}
      <p>Kies een zuiderse kleur voor de app. Dag- en nachtmodus blijven werken.</p>
      <div class="mwskins">${S.list.map(k => `<button type="button" class="mwskin" data-a="skin" data-id="${k.id}" aria-pressed="${k.id === cur}">
        <span class="sw" aria-hidden="true">${k.c.map(c => `<i style="background:${c}"></i>`).join("")}</span>
        <b>${k.id === cur ? ico("check") : ""}${esc(k.name)}</b><small>${esc(k.where)}</small></button>`).join("")}</div>
    </section>`;
  }
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
    // settings always one tap away: a cog at the far right of the header, where people look for it
    if(!$("mwGear")){
      const g = document.createElement("button"); g.id = "mwGear"; g.type = "button"; g.className = "btn ghost sm";
      g.style.padding = "7px 9px"; g.setAttribute("aria-label", "Instellingen"); g.title = "Instellingen";
      g.innerHTML = ico("gear"); g.onclick = () => { $("mwPick") && ($("mwPick").hidden = true); openSheet(); };
      ($("hdrBtns") || b.parentNode).appendChild(g);
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
    const close = () => { sh.hidden = true; sheetMsg = ""; inviteLink = ""; prefDraft = null; aboutOpen = false; };
    // "toggle" does not bubble, so listen in the capture phase
    $("mwBody").addEventListener("toggle", e => { if(e.target.id === "mwAbout") aboutOpen = e.target.open; }, true);
    $("mwClose").onclick = close;
    sh.addEventListener("click", e => { if(e.target === sh) close(); });
    document.addEventListener("keydown", e => { if(e.key === "Escape" && !sh.hidden) close(); });
    $("mwBody").addEventListener("click", onSheetClick);
    $("mwBody").addEventListener("input", e => { const k = e.target.dataset.pf; if(k && prefDraft) prefDraft[k] = e.target.value; });
  }
  cloud.redraw = () => { if($("mwSheet") && !$("mwSheet").hidden) drawSheet(); }; // for remind.js
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
        ${owner ? `<div class="line"><input id="mwRename" value="${esc(c.name)}" aria-label="Naam van de kelder"><button class="btn ghost sm" type="button" data-a="rename">${ico("pencil")}Hernoem</button></div>
            <label class="mwcheck"><input type="checkbox" data-a="membersEdit" ${c.membersEdit ? "checked" : ""}> Leden mogen wijnen toevoegen en aanpassen</label>
            <p>${c.membersEdit ? "Iedereen in deze kelder kan wijnen scannen, flessen bijzetten of afboeken en proefnotities toevoegen." : "Alleen jij voegt wijnen toe of past ze aan. Leden kunnen alles bekijken."}</p>`
          : `<p>Je bent lid van <b>${esc(c.name)}</b>. ${c.membersEdit ? "Je ziet en bewerkt dezelfde wijnen als de anderen." : `Je kunt alle wijnen bekijken; alleen ${esc(ownerName)} voegt wijnen toe of past ze aan.`}</p>`}
      </section>

      <section class="mwsec">${head("users", "Wie kan meekijken", `<small>${members.length} ${members.length === 1 ? "persoon" : "personen"}</small>`)}
        <div>${members.map(([uid, m]) => `<div class="mwrow"><span class="mwav">${initial(m.name)}</span><span class="who"><b>${esc(m.name)}${uid === me.uid ? " (jij)" : ""}</b><small>${esc(uid === me.uid ? m.email : maskEmail(m.email))}</small>${m.role === "owner" ? `<span class="mwrole">Eigenaar</span>` : ""}</span>
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

      ${localCount && (owner || c.membersEdit) ? `<section class="mwsec">${head("phone", "Wijnen op dit toestel")}<p>Op dit toestel staan nog ${localCount} wijn${localCount === 1 ? "" : "en"} van voor je je aanmeldde. Zet ze in "${esc(c.name)}".</p>
        <div><button class="btn sm" type="button" data-a="migrate">${ico("upload")}Zet ze in deze kelder</button></div></section>` : ""}

      ${prefsHtml()}

      ${skinHtml()}

      ${window.mwRemind ? window.mwRemind.settingsHtml(head("bell", "Herinneringen", `<small>dit toestel</small>`)) : ""}

      <div class="mwdanger">
        ${owner ? (cloud.cellars.length > 1 ? `<button type="button" data-a="delcellar">${ico("trash")}Verwijder deze kelder</button>` : "") : `<button type="button" data-a="leave">${ico("logout")}Verlaat deze kelder</button>`}
        <details class="mwtech"><summary>${ico("info")}Technische gegevens</summary><p>Gebruikers-id: <span style="user-select:all">${esc(me.uid)}</span></p></details>
      </div>

      ${aboutHtml()}`;
    showVersion();
    if($("mwNew")) $("mwNew").value = keepNew;
    if($("mwRename") && keepName !== undefined && focus === "mwRename") $("mwRename").value = keepName;
    if(focus && $(focus)) $(focus).focus();
  }
  // Other members' e-mail, half hidden: "maarten@gmail.com" → "m•••••@g••••.com". Enough to tell people apart.
  function maskEmail(e){
    const [user, dom] = String(e || "").split("@");
    if(!dom) return user ? user[0] + "•••" : "";
    const dot = dom.lastIndexOf("."), host = dot > 0 ? dom.slice(0, dot) : dom, tld = dot > 0 ? dom.slice(dot) : "";
    const hide = s => s[0] + "•".repeat(Math.min(Math.max(s.length - 1, 3), 6));
    return hide(user) + "@" + hide(host) + tld;
  }

  // ---------- about the app + copyright, at the bottom of Settings ----------
  const FIRST_YEAR = 2026;
  let aboutOpen = false;
  function aboutHtml(){
    const y = new Date().getFullYear(), years = y > FIRST_YEAR ? `${FIRST_YEAR}–${y}` : String(FIRST_YEAR);
    // Folded by default; stays open while Settings is open (the sheet redraws often).
    return `<details class="mwsec mwabout" id="mwAbout"${aboutOpen ? " open" : ""}>
        <summary class="mwapp"><img src="icons/icon.svg" alt="" width="44" height="44"><span><b>MD projects</b><small>Over de app</small></span>
          <svg class="mwi mwchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
        <p class="mwtag">Je wijnkelder, gedeeld met wie je wilt.</p>
        <div class="mwfacts">
          <div>${ico("info")}<span><b>Versie</b><small id="mwVer">…</small></span></div>
          <div>${ico("shield")}<span><b>Je gegevens</b><small>Je wijnen staan in Google Firebase in de cloud. Alleen leden van een kelder zien die kelder. Geen reclame, en er wordt niets doorverkocht.</small></span></div>
          <div>${ico("spark")}<span><b>Slimme functies</b><small>Vragen, etiketten lezen en suggesties gebruiken Claude van Anthropic, via een eigen beveiligde server.</small></span></div>
          <div>${ico("bell")}<span><b>Meldingen</b><small>Alleen als je ze zelf aanzet, en alleen op dit toestel.</small></span></div>
        </div>
      </details>
      <footer class="mwcopy">${ico("copyright")}<span>${years} MD projects · Alle rechten voorbehouden</span></footer>`;
  }
  // The service worker's cache is named after the published build (mw-<commit>), so that is the version.
  function showVersion(){
    const el = $("mwVer"); if(!el) return;
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    if(!window.caches){ el.textContent = local ? "ontwikkelversie" : "onbekend"; return; }
    caches.keys().then(ks => {
      const k = ks.find(x => /^mw-/.test(x) && !/^mw-libs/.test(x));
      const v = k ? k.slice(3) : "";
      if($("mwVer")) $("mwVer").textContent = !v || v === "__BUILD__" ? "ontwikkelversie" : "build " + v.slice(0, 7);
    }).catch(() => {});
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
      if(a === "skin"){ window.mwSkin?.set(b.dataset.id || ""); drawSheet(); return; }
      if(a === "switch"){ if(b.dataset.id !== c.id){ store.set("mw_cellar_" + cloud.me.uid, b.dataset.id); location.reload(); } return; }
      if(a === "new"){ const n = $("mwNew").value.trim(); if(!n){ $("mwNew").focus(); return; } b.disabled = true; const first = !cloud.cellars.some(x => x.owner === cloud.me.uid); const id = await createCellar(n); store.set("mw_cellar_" + cloud.me.uid, id); store.set("mw_new", (first ? "1:" : "0:") + id); location.reload(); return; }
      if(a === "membersEdit"){ if(c.owner === cloud.me.uid) await fs.doc("cellars/" + c.id).update({membersEdit: !!b.checked}); return; }
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
