/*
 * MD projects — usage counts and the builder's "Beheer" tab.
 *
 *  - Every person keeps one small record, stats/{uid}, with counts only: first and last time seen, on how many
 *    days the app was opened (per month and in total), how many cellars, wines (in cellars they own),
 *    scores they gave and smart-feature requests. Never wine names, notes, scores themselves or e-mail.
 *  - Smart-feature requests are also counted per feature and per place in the app (aiUse: "task|place"), and the
 *    questions in "Vraag het aan je kelder" per kind (askKind). The kind is guessed on the phone from keywords;
 *    the question itself is never stored or sent anywhere for this.
 *  - Only the person writes their own record; only an admin reads them all (firestore.rules). Who is an admin
 *    is set by hand in the Firebase console: a document admins/{uid} (any content). The app cannot create it.
 *  - For an admin, Settings gets a fourth tab, "Beheer", with the totals and the heaviest users first.
 *  - The owner also sees the AI budget there: what the smart features cost this month, from the AI relay
 *    (worker/worker.js, GET /usage), with a forecast for the month. Over 75% or on course to overspend, the
 *    app says so once a day when the owner opens it.
 */
(() => {
  const cloud = window.mwCloud;
  window.mwStats = {ai(){}};
  window.mwAdmin = {is: () => false, html: () => "", load(){}};
  if(!cloud) return;

  const css = `
.mwadm{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.mwadm div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;background:var(--bg);border:1px solid var(--line);min-width:0}
.mwadm b{font:600 1.35rem/1.1 var(--display);color:var(--ink)}
.mwadm small{color:var(--muted);font-size:.76rem;line-height:1.25}
.mwurow{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.mwurow:last-child{border-bottom:0}
.mwurow .rk{width:22px;flex:none;text-align:right;color:var(--muted);font-weight:700;font-size:.85rem;padding-top:9px}
.mwurow .who{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.mwurow .who b{font-size:.95rem;overflow-wrap:anywhere}
.mwurow .who small{color:var(--muted);font-size:.8rem}
.mwurow .bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.mwurow .bar i{display:block;height:100%;background:var(--accent);border-radius:3px}
.mwchipz{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:.78rem;color:var(--muted)}
.mwchipz span b{color:var(--ink);font-weight:700}
#mwTab-beheer{color:var(--gold)}
#mwTab-beheer[aria-selected="true"]{background:var(--gold);color:var(--onaccent)}
.mwadmonly{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:12px;font-size:.84rem;font-weight:700;
  color:var(--gold);background:color-mix(in srgb,var(--gold) 14%,var(--surface));border:1px solid var(--gold)}
.mwadmonly .mwi{width:16px;height:16px}
.mwsec.adm{border-color:color-mix(in srgb,var(--gold) 55%,var(--line))}
.mwaibars{display:flex;flex-direction:column;gap:9px;margin-top:4px}
.mwaibar{display:flex;flex-direction:column;gap:3px}
.mwaibar .t{display:flex;justify-content:space-between;gap:8px;font-size:.88rem}
.mwaibar .t b{font-weight:700;color:var(--ink)}
.mwaibar .t span{color:var(--muted);white-space:nowrap;font-family:var(--mono,inherit);font-size:.8rem}
.mwaibar .bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.mwaibar .bar i{display:block;height:100%;background:var(--gold);border-radius:3px}
.mwaibar small{color:var(--muted);font-size:.76rem;line-height:1.3}
.mwbudtop{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.mwbudtop b{font:600 2rem/1 var(--display);color:var(--ink)}
.mwbudtop span{color:var(--muted);font-size:.9rem}
.mwbudbar{position:relative;height:12px;border-radius:6px;background:var(--line);margin:10px 0 4px}
.mwbudbar i{display:block;height:100%;border-radius:6px;background:#3f8f5a}
.mwbudbar em{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;background:var(--ink);opacity:.55}
.mwbud.warn .mwbudbar i{background:var(--gold)}
.mwbud.bad .mwbudbar i{background:var(--accent)}
.mwbudmsg{font-weight:700;color:var(--ink)}
.mwbud.warn .mwbudmsg{color:var(--gold)}
.mwbud.bad .mwbudmsg{color:var(--accent)}
.mwbuddays{display:flex;align-items:flex-end;gap:3px;height:64px;margin-top:4px}
.mwbuddays span{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:2px;min-width:0}
.mwbuddays i{display:block;width:100%;background:var(--gold);border-radius:3px 3px 0 0}
.mwbuddays small{font-size:.62rem;color:var(--muted)}
.mwbudnote{position:fixed;z-index:24;left:16px;right:16px;bottom:calc(88px + env(safe-area-inset-bottom));max-width:420px;margin:0 auto;box-sizing:border-box;
  display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:16px;background:var(--surface);color:var(--ink);
  border:1px solid var(--gold);border-left:5px solid var(--gold);box-shadow:0 10px 30px rgba(0,0,0,.18)}
.mwbudnote.bad{border-color:var(--accent)}
.mwbudnote b{display:flex;align-items:center;gap:6px;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}
.mwbudnote.bad b{color:var(--accent)}
.mwbudnote b .mwi{width:16px;height:16px}
.mwbudnote span{font-size:.92rem;line-height:1.35}
.mwbudnote div{display:flex;justify-content:flex-end;align-items:center;gap:14px}
.mwbudform{display:flex;flex-direction:column;gap:8px}
.mwbudform label{display:flex;flex-direction:column;gap:4px;font-size:.82rem;color:var(--muted)}
.mwadmh{margin:14px 0 2px;font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.mwadmseg{display:flex;gap:6px;margin:2px 0 6px}
.mwadmseg button{font:inherit;font-size:.8rem;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.mwadmseg button[aria-pressed="true"]{background:var(--gold);border-color:var(--gold);color:var(--onaccent)}
.mwsec.adm .mwbadge{background:color-mix(in srgb,var(--gold) 18%,var(--surface));color:var(--gold)}`;

  const pad = n => String(n).padStart(2, "0");
  const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sum = o => Object.values(o || {}).reduce((a, n) => a + (+n || 0), 0);
  const ms = t => (t && t.toMillis ? t.toMillis() : 0);

  let fs, F, uid, ref, admin = false, rows = null, loading = false, err = "", aiAll = false, spend = null, spendErr = "", budgetEdit = false;

  // ---------- counting (everyone) ----------
  // What kind of question someone asks in "Vraag het aan je kelder". Only the kind is kept, never the question.
  const KINDS = [
    ["eten", /\b(eten|gerecht|diner|lunch|menu|koken|kook|vlees|vis|kaas|kazen|pasta|risotto|pizza|kip|lam|lams|rund|steak|varken|wild|eend|bbq|barbecue|dessert|aperitief|hapje|tapas|sushi|curry|schaal|oester|zalm|stoof|soep|salade|truffel|chocolade)|bij (de|het|een|mijn|ons) /i],
    ["kopen", /\b(kopen|koop|bijkopen|aankopen|aanschaf|winkel|prijs|budget|euro|cadeau|geschenk|investering|aanvullen|ontbreekt|mist)|€/i],
    ["drinken", /\b(eerst op|op dronk|drinkklaar|klaar om|vanavond|morgen|weekend|openen|opentrekken|open ik|nu drinken|drinken|bewaren|houdbaar|te oud|over zijn|wachten|decanteren|schenken|temperatuur)/i],
    ["kennis", /\b(wat is|wat zijn|waarom|verschil|uitleg|leg uit|hoe wordt|hoe maak|betekent|betekenis|appellatie|classificatie|jaargang|druif|druiven|streek|terroir|geschiedenis)/i],
    ["kelder", /\b(hoeveel|overzicht|mijn kelder|in huis|voorraad|heb ik|staan er|beste|hoogste|favoriet|lijst|telt|duurste|oudste|jongste)/i]
  ];
  const askKind = q => (KINDS.find(([, rx]) => rx.test(String(q || ""))) || ["anders"])[0];
  // Where the request came from: the scan passes where the wine goes, the rest is the tab that is open.
  const placeNow = () => document.querySelector(".tabs [aria-selected='true']")?.dataset.tab || "app";
  const clean = v => String(v || "").replace(/[^a-zA-Z]/g, "").slice(0, 20) || "anders";

  window.mwStats.askKind = askKind;
  window.mwStats.ai = (task, stat) => {
    if(!ref) return;
    const month = dayOf(new Date()).slice(0, 7);
    ref.set({ai: {[month]: F.increment(1)}, aiTotal: F.increment(1)}, {merge: true}).catch(() => {});
    // Kept apart, so the plain count above still works where the rules for these fields are not published yet.
    const st = stat || {}, up = {aiUse: {[month]: {[clean(task) + "|" + clean(st.where || placeNow())]: F.increment(1)}}};
    if(task === "ask") up.askKind = {[month]: {[clean(st.kind || "anders")]: F.increment(1), ...(st.follow ? {doorvraag: F.increment(1)} : {})}};
    ref.set(up, {merge: true}).catch(() => {});
  };

  async function countOpen(){
    const snap = await ref.get().catch(() => null);
    const d = snap && snap.exists ? snap.data() : {};
    const today = dayOf(new Date()), month = today.slice(0, 7);
    const up = {name: String(cloud.me.name || "").slice(0, 80), last: F.serverTimestamp(), opens: F.increment(1), cellars: cloud.cellars.length};
    if(!d.first) up.first = F.serverTimestamp();
    if(d.day !== today){ up.day = today; up.daysTotal = F.increment(1); up.days = {[month]: F.increment(1)}; }
    await ref.set(up, {merge: true}).catch(() => {});
    countWines(d);
  }

  // Wines in the open cellar, once the server has answered (the app listens to the same list, so no extra reads).
  // Wines count only for cellars you own, so a shared cellar is not counted twice; scores are your own.
  function countWines(d){
    const c = cloud.cellar, owned = new Set(cloud.cellars.filter(x => x.owner === uid).map(x => x.id));
    const un = fs.collection("cellars/" + c.id + "/wines").onSnapshot({includeMetadataChanges: true}, s => {
      if(s.metadata.fromCache) return;
      un();
      const keep = m => Object.fromEntries(Object.entries(m || {}).filter(([id]) => cloud.cellars.some(x => x.id === id)));
      const wines = Object.fromEntries(Object.entries(keep(d.wines)).filter(([id]) => owned.has(id)));
      if(owned.has(c.id)) wines[c.id] = s.size;
      const scored = keep(d.scored);
      scored[c.id] = s.docs.filter(w => +((w.data().scores || {})[uid]) > 0).length;
      ref.set({wines, scored}, {mergeFields: ["wines", "scored"]}).catch(() => {});
    }, () => {});
  }

  // ---------- the Beheer tab (admin only) ----------
  async function load(force){
    if(!admin || loading || (rows && !force)) return;
    loading = true; err = "";
    try{
      const s = await fs.collection("stats").get();
      rows = s.docs.map(x => ({id: x.id, ...x.data()}));
    }catch(e){ err = "De gegevens konden niet geladen worden. Kloppen de regels in Firebase?"; }
    await loadSpend();
    loading = false;
    cloud.redraw && cloud.redraw();
  }

  function seen(t){
    if(!t) return "nog niet";
    const d = new Date(t), today = dayOf(new Date()), y = new Date(); y.setDate(y.getDate() - 1);
    const hm = d.toLocaleTimeString("nl-BE", {hour: "2-digit", minute: "2-digit"});
    if(dayOf(d) === today) return "vandaag om " + hm;
    if(dayOf(d) === dayOf(y)) return "gisteren om " + hm;
    return d.toLocaleDateString("nl-BE", {day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric"});
  }

  // ---------- AI budget (owner only, from the AI relay) ----------
  async function usageCall(body){
    const url = String(window.MW_AI_URL || "").replace(/\/+$/, "");
    if(!url) throw {nice: "De slimme functies staan uit (geen AI-server ingesteld)."};
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(url + "/usage", {method: body ? "POST" : "GET", headers: {"Authorization": "Bearer " + token, ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined});
    if(res.status === 403) throw {nice: "Alleen de eigenaar van de AI-server ziet het budget."};
    if(res.status === 404 || res.status === 405 || (res.ok && !(res.headers.get("Content-Type") || "").includes("json"))) throw {nice: "De AI-server telt de kosten nog niet. Zet eerst de nieuwe worker.js op Cloudflare."};
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.usd === undefined) throw {nice: j.error?.code === "no_storage" ? "Koppel eerst de opslag (PUSH) aan de AI-server in Cloudflare." : "De AI-server telt de kosten nog niet. Zet eerst de nieuwe worker.js op Cloudflare."};
    return j;
  }
  async function loadSpend(){
    try{ spend = await usageCall(); spendErr = ""; }catch(e){ spend = null; spendErr = e.nice || "Het budget kon niet geladen worden."; }
  }
  // This month so far, and where it ends if the coming days look like the past ones.
  function forecast(sp){
    const now = new Date(), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const used = (sp.usd || 0) + (sp.before || 0), dayNow = now.getDate() - 1 + (now.getHours() * 60 + now.getMinutes()) / 1440;
    const perDay = dayNow > 0.5 ? (sp.usd || 0) / dayNow : 0; // the counted part only; "before" is a one-off
    const end = used + perDay * (days - dayNow), b = sp.budget || 0;
    let outDay = 0;
    if(b && perDay > 0 && end > b) outDay = Math.min(days, Math.ceil(dayNow + Math.max(0, b - used) / perDay));
    return {used, perDay, end, b, pct: b ? used / b : 0, endPct: b ? end / b : 0, outDay, days};
  }
  const usd = n => "$" + (n >= 100 ? String(Math.round(n)) : n > 0 && n < 0.1 ? n.toFixed(3) : n.toFixed(2)).replace(".", ",");
  function budgetHtml(monthName){
    const ui = cloud.ui, esc = ui.esc;
    if(!spend) return `<section class="mwsec adm">${ui.head("chart", "AI-budget")}<p>${esc(spendErr || "Laden…")}</p></section>`;
    const f = forecast(spend), lvl = !f.b ? "" : (f.pct >= 0.9 || f.endPct > 1.05) ? "bad" : (f.pct >= 0.75 || f.endPct > 0.9) ? "warn" : "ok";
    const tasks = Object.fromEntries(Object.entries(spend.tasks || {}).map(([k, v]) => [k, v.usd || 0]));
    const msg = !f.b ? "Stel je budget in om te zien hoe ver je staat."
      : f.pct >= 1 ? `Je budget voor ${monthName} is op.`
      : f.outDay ? `Aan dit tempo is je budget op rond ${f.outDay} ${monthName}.`
      : `Aan dit tempo eindig je ${monthName} rond ${usd(f.end)}, binnen je budget.`;
    const days = Object.entries(spend.days || {}).sort().slice(-14), dmax = Math.max(0.01, ...days.map(([, v]) => v));
    return `<section class="mwsec adm mwbud ${lvl}">${ui.head("chart", "AI-budget", `<small>${esc(monthName)}</small>`)}
      <div class="mwbudtop"><b>${usd(f.used)}</b><span>${f.b ? `van ${usd(f.b)} · ${Math.round(f.pct * 100)}%` : "verbruikt"}</span></div>
      ${f.b ? `<div class="mwbudbar" role="img" aria-label="${Math.round(f.pct * 100)}% van je budget verbruikt"><i style="width:${Math.min(100, f.pct * 100).toFixed(1)}%"></i><em style="left:${Math.min(100, f.endPct * 100).toFixed(1)}%" title="Verwacht einde van de maand"></em></div>` : ""}
      <p class="mwbudmsg">${esc(msg)}</p>
      <div class="mwadm">
        <div><b>${usd(f.perDay)}</b><small>per dag gemiddeld</small></div>
        <div><b>${usd(f.end)}</b><small>verwacht eind ${esc(monthName)}</small></div>
        <div><b>${spend.n || 0}</b><small>vragen geteld</small></div>
        <div><b>${spend.last ? usd(spend.last.usd) : "–"}</b><small>vorige maand</small></div>
      </div>
      ${days.length ? `<p class="mwadmh">Per dag</p><div class="mwbuddays">${days.map(([d, v]) => `<span title="${esc(+d + " " + monthName + ": " + usd(v))}"><i style="height:${Math.max(4, Math.round(v / dmax * 100))}%"></i><small>${+d}</small></span>`).join("")}</div>` : ""}
      <p class="mwadmh">Wat kost het meest</p>${bars(tasks, t => TASKS[t] || t, t => { const x = spend.tasks[t]; return x && x.n ? `${x.n} vragen · ${usd(x.usd / x.n)} per vraag` : ""; }, Object.keys(TASKS), usd)}
      ${budgetEdit ? `<div class="mwbudform"><label>Budget per maand ($)<input id="mwBudUsd" type="number" min="0" step="1" inputmode="decimal" value="${f.b || ""}"></label>
          <label>Al verbruikt in ${esc(monthName)} vóór de teller liep ($)<input id="mwBudBefore" type="number" min="0" step="0.01" inputmode="decimal" value="${spend.before || ""}"></label>
          <div class="cardfoot"><button class="link" type="button" data-adm="budcancel">Annuleren</button><button class="btn sm" type="button" data-adm="budsave">Bewaar</button></div></div>`
        : `<div><button class="btn ghost sm" type="button" data-adm="budedit">${f.b ? "Budget aanpassen" : "Budget instellen"}</button></div>`}
      <p>${ico("shield")} Een schatting op basis van de tokens die elke vraag gebruikte en de prijzen van Anthropic, in dollar zoals Anthropic factureert. De factuur in de Anthropic Console blijft de echte stand.${spend.stored ? "" : " Let op: de AI-server heeft geen opslag (PUSH), dus de teller begint opnieuw na een herstart."}</p>
    </section>`;
  }
  // Once a day, when the owner opens the app: a word if the budget is nearly used or on course to run out.
  async function budgetNudge(){
    let day = ""; try{ day = localStorage.getItem("mw_budnudge") || ""; }catch{}
    const today = dayOf(new Date()); if(day === today) return;
    let sp; try{ sp = await usageCall(); }catch{ return; }
    spend = sp; spendErr = "";
    const f = forecast(sp); if(!f.b) return;
    const monthName = new Date().toLocaleDateString("nl-BE", {month: "long"});
    let t = "";
    if(f.pct >= 1) t = `Je AI-budget voor ${monthName} is op: ${usd(f.used)} van ${usd(f.b)}.`;
    else if(f.pct >= 0.75) t = `Je hebt ${Math.round(f.pct * 100)}% van je AI-budget gebruikt (${usd(f.used)} van ${usd(f.b)}).`;
    else if(f.outDay) t = `Aan dit tempo is je AI-budget op rond ${f.outDay} ${monthName}.`;
    if(!t) return;
    try{ localStorage.setItem("mw_budnudge", today); }catch{}
    const lvl = f.pct >= 0.9 || f.endPct > 1.05 ? "bad" : "warn";
    const el = document.createElement("div"); el.className = "mwbudnote " + lvl; el.setAttribute("role", "status");
    el.innerHTML = `<b>${ico("chart")}AI-budget</b><span>${cloud.ui.esc(t)}</span>
      <div><button class="link" type="button" data-bn="ok">Oké</button><button class="btn sm" type="button" data-bn="open">Bekijk</button></div>`;
    el.onclick = e => {
      const b = e.target.closest("[data-bn]"); if(!b) return;
      el.remove();
      if(b.dataset.bn === "open"){ document.getElementById("mwGear")?.click(); setTimeout(() => document.getElementById("mwTab-beheer")?.click(), 150); }
    };
    document.body.appendChild(el);
  }

  const TASKS = {ask: "Vraag het aan je kelder", scan: "Etiket scannen", fact: "Weetje van de dag", factMore: "Nog een weetje",
    pairing: "Gerechten bij een wijn", pick: "Wat drink ik vanavond", serve: "Schenkadvies", house: "Over het wijnhuis", geo: "Wijnkaart (streken plaatsen)", legacy: "Oude app-versie"};
  const AUTO = new Set(["fact", "geo"]); // the app asks these by itself
  const PLACES = {kelder: "Kelder", wens: "Verlanglijst", proef: "Geproefd", stats: "Inzichten", later: "Achteraf (offline gescand)", app: "Elders in de app"};
  const KIND_L = {eten: "Welke wijn bij eten", drinken: "Wat drink ik (eerst)", kopen: "Wat koop ik", kennis: "Wijnkennis", kelder: "Over mijn kelder", anders: "Iets anders"};
  const KIND_H = {eten: "gerechten, kaas, een diner", drinken: "op dronk, vanavond, bewaren, schenken", kopen: "bijkopen, budget, cadeau",
    kennis: "wat is, verschil, druif, streek", kelder: "hoeveel, beste, overzicht", anders: "past in geen van de andere"};
  const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
  // Sum the per-month maps of every person, for this month or for all months.
  function aiTotals(list, month){
    const use = {}, kind = {}, users = new Set();
    let n = 0, split = 0, follow = 0;
    for(const r of list){
      const months = m => Object.entries(m || {}).filter(([k]) => aiAll || k === month).map(([, v]) => v || {});
      n += aiAll ? (+r.aiTotal || sum(r.ai)) : r.aiM;
      for(const m of months(r.aiUse)) for(const [k, v] of Object.entries(m)){ add(use, k, +v || 0); split += +v || 0; if(+v) users.add(r.id); }
      for(const m of months(r.askKind)) for(const [k, v] of Object.entries(m)){ if(k === "doorvraag") follow += +v || 0; else add(kind, k, +v || 0); }
    }
    const byTask = {}, byPlace = {}, cross = {};
    for(const [k, v] of Object.entries(use)){
      const [t, p] = k.split("|"); add(byTask, t, v); add(byPlace, p, v);
      (cross[t] ||= {}); add(cross[t], p, v);
    }
    return {n, split, follow, users: users.size, byTask, byPlace, cross, kind};
  }
  function bars(obj, label, sub, order, fmt){
    const at = k => { const i = (order || []).indexOf(k); return i < 0 ? 99 : i; };
    const rows = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || at(a[0]) - at(b[0]));
    if(!rows.length) return `<p class="hint">Nog niets geteld.</p>`;
    const tot = rows.reduce((a, [, v]) => a + v, 0), top = rows[0][1], esc = cloud.ui.esc;
    return `<div class="mwaibars">${rows.map(([k, v]) => `<div class="mwaibar"><div class="t"><b>${esc(label(k))}</b><span>${fmt ? fmt(v) : v} · ${Math.round(v / tot * 100)}%</span></div>
      <span class="bar" aria-hidden="true"><i style="width:${Math.max(2, Math.round(v / top * 100))}%"></i></span>${sub && sub(k) ? `<small>${sub(k)}</small>` : ""}</div>`).join("")}</div>`;
  }
  function aiHtml(list, month, monthName){
    const ui = cloud.ui, esc = ui.esc, a = aiTotals(list, month), when = aiAll ? "sinds het begin" : "in " + monthName;
    const asks = Object.values(a.kind).reduce((x, v) => x + v, 0), rest = a.n - a.split;
    const placesOf = t => Object.entries(a.cross[t] || {}).sort((x, y) => y[1] - x[1]).map(([p, v]) => `${esc(PLACES[p] || p)} ${v}`).join(" · ");
    return `<section class="mwsec adm">${ui.head("spark", "Slimme vragen", `<small>${esc(when)}</small>`)}
      <div class="mwadmseg" role="group" aria-label="Periode"><button type="button" data-adm="aimonth" aria-pressed="${!aiAll}">Deze maand</button><button type="button" data-adm="aiall" aria-pressed="${aiAll}">Altijd</button></div>
      <div class="mwadm">
        <div><b>${a.n}</b><small>slimme vragen ${esc(when)}</small></div>
        <div><b>${a.users}</b><small>${a.users === 1 ? "persoon gebruikte" : "personen gebruikten"} ze</small></div>
        <div><b>${asks}</b><small>vragen aan je kelder</small></div>
        <div><b>${a.follow}</b><small>daarvan doorvragen</small></div>
      </div>
      <p class="mwadmh">Welke functie</p>${bars(a.byTask, t => TASKS[t] || t, t => [AUTO.has(t) ? "vraagt de app zelf" : "", placesOf(t)].filter(Boolean).join(" · "), Object.keys(TASKS))}
      <p class="mwadmh">Waar in de app</p>${bars(a.byPlace, p => PLACES[p] || p, null, Object.keys(PLACES))}
      <p class="mwadmh">Soort vragen aan je kelder</p>${bars(a.kind, k => KIND_L[k] || k, k => esc(KIND_H[k] || ""), Object.keys(KIND_L))}
      <p>${ico("shield")} De soort vraag raadt de app op de telefoon zelf, aan de hand van woorden zoals “kaas” of “kopen”. De vraag zelf wordt nergens bewaard.${rest > 0 ? ` ${rest} ${rest === 1 ? "vraag is" : "vragen zijn"} van vóór deze indeling en staan daarom alleen in het totaal.` : ""}</p>
    </section>`;
  }

  function html(){
    const ui = cloud.ui, esc = ui.esc;
    if(!rows) return `${only()}<section class="mwsec adm">${ui.head("chart", "Gebruik van de app")}<p>${esc(err || "Laden…")}</p></section>`;
    const now = new Date(), today = dayOf(now), month = today.slice(0, 7), week = Date.now() - 7 * 864e5;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthName = now.toLocaleDateString("nl-BE", {month: "long"});
    const list = rows.map(r => ({...r, m: +(r.days || {})[month] || 0, last: ms(r.last), first: ms(r.first), w: sum(r.wines), sc: sum(r.scored), aiM: +(r.ai || {})[month] || 0}))
      .sort((a, b) => b.m - a.m || (b.daysTotal || 0) - (a.daysTotal || 0) || b.last - a.last);
    const since = Math.min(...list.map(r => r.first).filter(Boolean));
    const tiles = [
      [list.length, "gebruikers"],
      [list.filter(r => r.day === today).length, "actief vandaag"],
      [list.filter(r => r.last >= week).length, "actief laatste 7 dagen"],
      [list.filter(r => r.m > 0).length, `actief in ${monthName}`],
      [list.filter(r => r.first >= monthStart).length, `nieuw in ${monthName}`],
      [list.reduce((a, r) => a + Object.keys(r.wines || {}).length, 0), "eigen kelders"],
      [list.reduce((a, r) => a + r.w, 0), "wijnen"],
      [list.reduce((a, r) => a + r.aiM, 0), `slimme vragen in ${monthName}`]
    ];
    const top = Math.max(1, ...list.map(r => r.m));
    return `${only()}${budgetHtml(monthName)}<section class="mwsec adm">${ui.head("chart", "Gebruik van de app", `<button class="btn ghost sm" type="button" data-adm="reload">Ververs</button>`)}
        <div class="mwadm">${tiles.map(([n, l]) => `<div><b>${n}</b><small>${esc(l)}</small></div>`).join("")}</div>
        <p>${ico("shield")} Alleen jij ziet dit. Er worden enkel tellingen bewaard, geen wijnen, notities of e-mailadressen.${since < Infinity ? ` Geteld sinds ${esc(new Date(since).toLocaleDateString("nl-BE", {day: "numeric", month: "long", year: "numeric"}))}.` : ""}</p>
      </section>
      ${aiHtml(list, month, monthName)}
      <section class="mwsec adm">${ui.head("users", "Wie gebruikt de app het meest", `<small>dagen in ${esc(monthName)}</small>`)}
        <div>${list.length ? list.map((r, i) => `<div class="mwurow"><span class="rk">${i + 1}</span><span class="mwav">${ui.initial(r.name)}</span>
          <span class="who"><b>${esc(r.name || "Naamloos")}${r.id === uid ? " (jij)" : ""}</b>
            <span class="bar" aria-hidden="true"><i style="width:${Math.round(r.m / top * 100)}%"></i></span>
            <span class="mwchipz"><span><b>${r.m}</b> ${r.m === 1 ? "dag" : "dagen"} in ${esc(monthName)}</span><span><b>${r.daysTotal || 0}</b> in totaal</span>
              <span><b>${r.w}</b> wijnen</span><span><b>${r.sc}</b> scores</span><span><b>${r.aiM}</b> slimme vragen</span></span>
            <small>Laatst gezien ${esc(seen(r.last))}${r.first ? ` · sinds ${esc(new Date(r.first).toLocaleDateString("nl-BE", {day: "numeric", month: "short"}))}` : ""}</small></span></div>`).join("")
          : `<p>Nog niemand geteld.</p>`}</div>
      </section>`;
  }
  const ico = n => cloud.ui.ico(n);
  const only = () => `<div class="mwadmonly">${ico("shield")}Alleen voor de beheerder. Andere gebruikers zien dit menu niet.</div>`;

  window.mwAdmin = {is: () => admin, html, load};
  document.addEventListener("click", e => {
    if(e.target.closest("[data-adm='reload']")) load(true);
    const p = e.target.closest("[data-adm='aimonth'],[data-adm='aiall']");
    if(p){ aiAll = p.dataset.adm === "aiall"; cloud.redraw && cloud.redraw(); }
    const bd = e.target.closest("[data-adm='budedit'],[data-adm='budcancel'],[data-adm='budsave']");
    if(bd){
      const a = bd.dataset.adm;
      if(a === "budsave"){
        const v = id => document.getElementById(id)?.value || "0";
        bd.disabled = true;
        usageCall({usd: v("mwBudUsd"), before: v("mwBudBefore")}).then(j => { spend = j; spendErr = ""; budgetEdit = false; })
          .catch(err => { spendErr = err.nice || "Bewaren lukte niet."; }).finally(() => cloud.redraw && cloud.redraw());
        return;
      }
      budgetEdit = a === "budedit"; cloud.redraw && cloud.redraw();
    }
  });

  cloud.ready.then(() => {
    fs = cloud.fs; F = firebase.firestore.FieldValue; uid = cloud.me.uid; ref = fs.doc("stats/" + uid);
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    countOpen();
    // Are you an admin? Only you can read your own admins/{uid}; nobody can write it from the app.
    fs.doc("admins/" + uid).get().then(s => { if(s.exists){ admin = true; cloud.redraw && cloud.redraw(); setTimeout(budgetNudge, 4000); } }).catch(() => {});
  });
})();
