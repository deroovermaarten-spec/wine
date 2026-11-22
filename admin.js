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
.mwadmh{margin:14px 0 2px;font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.mwadmseg{display:flex;gap:6px;margin:2px 0 6px}
.mwadmseg button{font:inherit;font-size:.8rem;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.mwadmseg button[aria-pressed="true"]{background:var(--gold);border-color:var(--gold);color:var(--onaccent)}
.mwsec.adm .mwbadge{background:color-mix(in srgb,var(--gold) 18%,var(--surface));color:var(--gold)}`;

  const pad = n => String(n).padStart(2, "0");
  const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sum = o => Object.values(o || {}).reduce((a, n) => a + (+n || 0), 0);
  const ms = t => (t && t.toMillis ? t.toMillis() : 0);

  let fs, F, uid, ref, admin = false, rows = null, loading = false, err = "", aiAll = false;

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

  const TASKS = {ask: "Vraag het aan je kelder", scan: "Etiket scannen", fact: "Weetje van de dag", factMore: "Nog een weetje",
    pairing: "Gerechten bij een wijn", serve: "Schenkadvies", house: "Over het wijnhuis", geo: "Wijnkaart (streken plaatsen)", legacy: "Oude app-versie"};
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
  function bars(obj, label, sub, order){
    const at = k => { const i = (order || []).indexOf(k); return i < 0 ? 99 : i; };
    const rows = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || at(a[0]) - at(b[0]));
    if(!rows.length) return `<p class="hint">Nog niets geteld.</p>`;
    const tot = rows.reduce((a, [, v]) => a + v, 0), top = rows[0][1], esc = cloud.ui.esc;
    return `<div class="mwaibars">${rows.map(([k, v]) => `<div class="mwaibar"><div class="t"><b>${esc(label(k))}</b><span>${v} · ${Math.round(v / tot * 100)}%</span></div>
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
    return `${only()}<section class="mwsec adm">${ui.head("chart", "Gebruik van de app", `<button class="btn ghost sm" type="button" data-adm="reload">Ververs</button>`)}
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
  });

  cloud.ready.then(() => {
    fs = cloud.fs; F = firebase.firestore.FieldValue; uid = cloud.me.uid; ref = fs.doc("stats/" + uid);
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    countOpen();
    // Are you an admin? Only you can read your own admins/{uid}; nobody can write it from the app.
    fs.doc("admins/" + uid).get().then(s => { if(s.exists){ admin = true; cloud.redraw && cloud.redraw(); } }).catch(() => {});
  });
})();
