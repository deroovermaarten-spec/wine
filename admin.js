/*
 * MD projects — usage counts and the builder's "Beheer" tab.
 *
 *  - Every person keeps one small record, stats/{uid}, with counts only: first and last time seen, on how many
 *    days the app was opened (per month and in total), how many cellars, wines (in cellars they own),
 *    scores they gave and smart-feature requests. Never wine names, notes, scores themselves or e-mail.
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
.mwchipz span b{color:var(--ink);font-weight:700}`;

  const pad = n => String(n).padStart(2, "0");
  const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sum = o => Object.values(o || {}).reduce((a, n) => a + (+n || 0), 0);
  const ms = t => (t && t.toMillis ? t.toMillis() : 0);

  let fs, F, uid, ref, admin = false, rows = null, loading = false, err = "";

  // ---------- counting (everyone) ----------
  window.mwStats.ai = () => {
    if(!ref) return;
    const month = dayOf(new Date()).slice(0, 7);
    ref.set({ai: {[month]: F.increment(1)}, aiTotal: F.increment(1)}, {merge: true}).catch(() => {});
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

  function html(){
    const ui = cloud.ui, esc = ui.esc;
    if(!rows) return `<section class="mwsec">${ui.head("chart", "Gebruik van de app")}<p>${esc(err || "Laden…")}</p></section>`;
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
    return `<section class="mwsec">${ui.head("chart", "Gebruik van de app", `<button class="btn ghost sm" type="button" data-adm="reload">Ververs</button>`)}
        <div class="mwadm">${tiles.map(([n, l]) => `<div><b>${n}</b><small>${esc(l)}</small></div>`).join("")}</div>
        <p>${ico("shield")} Alleen jij ziet dit. Er worden enkel tellingen bewaard, geen wijnen, notities of e-mailadressen.${since < Infinity ? ` Geteld sinds ${esc(new Date(since).toLocaleDateString("nl-BE", {day: "numeric", month: "long", year: "numeric"}))}.` : ""}</p>
      </section>
      <section class="mwsec">${ui.head("users", "Wie gebruikt de app het meest", `<small>dagen in ${esc(monthName)}</small>`)}
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

  window.mwAdmin = {is: () => admin, html, load};
  document.addEventListener("click", e => { if(e.target.closest("[data-adm='reload']")) load(true); });

  cloud.ready.then(() => {
    fs = cloud.fs; F = firebase.firestore.FieldValue; uid = cloud.me.uid; ref = fs.doc("stats/" + uid);
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    countOpen();
    // Are you an admin? Only you can read your own admins/{uid}; nobody can write it from the app.
    fs.doc("admins/" + uid).get().then(s => { if(s.exists){ admin = true; cloud.redraw && cloud.redraw(); } }).catch(() => {});
  });
})();
