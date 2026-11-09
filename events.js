/*
 * Meerstraat wines — events: a get-together you organise, where everyone brings wines from their own cellar.
 *
 *  events/{id}          {name, date "YYYY-MM-DD", place, note, owner, memberIds, members{uid: {name, email, role}}, createdAt}
 *  events/{id}/wines/x  a copy of a wine (so every guest can read it without access to that cellar)
 *                       + src {cellarId, cellarName, wineId}, addedBy {uid, name}, qty, addedAt
 *  eventInvites/{code}  {eventId, eventName, by, byName, createdAt, expiresAt}
 *
 * Only active with logins (cloud.js). Who may read or change what: firestore.rules.
 */
(() => {
  const cloud = window.mwCloud;
  if(!cloud) return;
  const $ = id => document.getElementById(id);

  let fs, F, ui, me;
  let events = [], loaded = false, current = null, evWines = [], unsubWines = null, winesFor = null;
  let msg = "", inviteLink = "", editing = false, creating = false, picking = false, pickQ = "", confirmDel = false;
  const openW = new Set();
  // Cards or a compact list, like in the cellar; remembered on this device
  let evView = "cards"; try{ if(localStorage.getItem("mw_evview") === "compact") evView = "compact"; }catch{}

  const COLORS = {mousserend: "Mousserend", wit: "Wit", rose: "Rosé", rood: "Rood", dessert: "Dessert"};
  const ORDER = ["mousserend", "wit", "rose", "rood", "dessert"]; // the usual order to serve them in
  const TODAY = () => new Date().toISOString().slice(0, 10);
  const fmtDay = d => { try{ return new Date(d + "T12:00:00").toLocaleDateString("nl-BE", {weekday: "long", day: "numeric", month: "long", year: "numeric"}); }catch{ return d; } };
  const isPast = e => e.date && e.date < TODAY();
  const ev = () => events.find(e => e.id === current) || null;
  const mine = e => e && e.owner === me.uid;
  // permission-denied means something else here than in a cellar
  const errText = (err, creating) => err && err.code === "permission-denied"
    ? (creating ? "Events zijn nog niet actief in de database: de beveiligingsregels met events zijn niet gepubliceerd in Firebase." : "Dat mag je niet doen bij dit event.")
    : ui.msgOf(err);

  const css = `
.evlist{display:flex;flex-direction:column;gap:10px}
.evitem{display:flex;align-items:center;gap:12px;width:100%;text-align:left;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:var(--shadow)}
.evitem.past{opacity:.7}
.evday{width:48px;flex:none;border-radius:8px;background:var(--accent-soft);color:var(--accent);display:flex;flex-direction:column;align-items:center;padding:6px 0;line-height:1.05}
.evday b{font:400 1.35rem var(--display)}
.evday small{font:600 .66rem var(--body);text-transform:uppercase;letter-spacing:.08em}
.evitem .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.evitem .t strong{font:600 1.08rem/1.2 var(--display);overflow:hidden;text-overflow:ellipsis}
.evitem .t span{font-size:.82rem;color:var(--muted)}
.evform{display:flex;flex-direction:column;gap:10px}
.evform input,.evform textarea,.evpick input{font:inherit;font-size:1rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0;width:100%;box-sizing:border-box}
.evhead{display:flex;flex-direction:column;gap:6px}
.evhead h2{font:400 1.7rem/1.1 var(--display);margin:0;text-wrap:balance}
.evhead .when{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:.88rem}
.evhead .when span{display:inline-flex;align-items:center;gap:5px}
.evhead .when .mwi{width:15px;height:15px}
.evback{align-self:flex-start;border:0;background:none;color:var(--muted);font:inherit;font-size:.88rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:4px 0}
.evback .mwi{width:16px;height:16px}
.evsum{font-size:.86rem;color:var(--muted);margin:0}
.evby{font-size:.8rem;color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.evby b{color:var(--ink);font-weight:600}
.evav{width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;background:var(--accent-soft);color:var(--accent);font:700 .68rem var(--body);flex:none}
.evav.me{background:var(--accent);color:var(--onaccent)}
.evlisthead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.evlisthead .hint{flex:1 1 200px;margin:0}
.evwho{display:flex;flex-wrap:wrap;gap:6px}
.evwho span{display:inline-flex;align-items:center;gap:6px;font-size:.84rem;padding:3px 10px 3px 3px;border:1px solid var(--line);border-radius:999px;background:var(--surface)}
.evwho small{color:var(--muted);font-variant-numeric:tabular-nums}
.evcol{display:flex;flex-direction:column;gap:12px}
.evcol.compact{gap:0;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);overflow:hidden}
.evcol.compact .card{border-radius:0;border:0;border-bottom:1px solid var(--line);box-shadow:none}
.evcol.compact .card:last-child{border-bottom:0}
.evcol.compact .card.open{box-shadow:inset 3px 0 0 var(--accent)}
.evcol .crow .cq{white-space:nowrap}
.evcol .crow .cb{display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--ink);font-weight:600;min-width:0;margin-top:3px}
.evcol .crow .cb .evav{width:17px;height:17px;font-size:.6rem}
.evcol .crow .cb > span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.evpick{display:flex;flex-direction:column;gap:8px}
.evpick .opt{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.evpick .opt:last-child{border-bottom:0}
.evpick .opt .t{flex:1;min-width:0;display:flex;flex-direction:column}
.evpick .opt .t small{color:var(--muted)}
.evpick .opt img,.evpick .opt .ph{width:36px;height:48px;border-radius:4px;object-fit:cover;flex:none;background:var(--accent-soft);display:grid;place-items:center;color:var(--accent);font:400 1.1rem var(--display)}
.evgroup{font:700 .7rem var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:6px 0 -2px;display:flex;align-items:center;gap:6px}
.evwines{display:flex;flex-direction:column;gap:12px}
.evwines .row{grid-template-columns:56px 1fr;gap:12px;padding:14px}
.evwines .thumb{width:56px;height:75px}
.mwsec .line{display:flex;gap:8px;flex-wrap:wrap}
.mwsec .line input{flex:1 1 180px;font:inherit;font-size:.9rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 12px;min-width:0}
.evgroup .dot{margin:0}
.evform label{min-width:0}
.evform input[type=date]{-webkit-appearance:none;appearance:none;display:block;min-height:44px;text-align:left}
.evform input[type=date]::-webkit-date-and-time-value{text-align:left}
#evNext{margin-left:auto;align-self:stretch;display:inline-flex;align-items:center;gap:8px;max-width:min(220px,calc(100% - 200px));min-width:0;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink);font:inherit;cursor:pointer;text-align:right}
#evNext:hover{border-color:var(--accent)}
#evNext[hidden]{display:none}
#evNext svg{width:22px;height:22px;flex:none}
#evNext .gl{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;opacity:.8}
#evNext .wn{fill:#b0212f;animation:evnfill 1.2s .3s cubic-bezier(.3,.6,.4,1) both}
@keyframes evnfill{from{transform:translateY(12px)}}
#evNext .tx{display:flex;flex-direction:column;min-width:0;line-height:1.15}
#evNext small{font-size:11px;color:var(--accent);font-weight:600;white-space:nowrap}
#evNext b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:reduce){#evNext .wn{animation:none}}`;

  // ---------- data ----------
  function listenEvents(){
    fs.collection("events").where("memberIds", "array-contains", me.uid).onSnapshot(snap => {
      events = snap.docs.map(d => ({id: d.id, ...d.data()}))
        .sort((a, b) => (isPast(a) - isPast(b)) || (isPast(a) ? String(b.date).localeCompare(String(a.date)) : String(a.date || "9999").localeCompare(String(b.date || "9999"))));
      loaded = true;
      if(current && !ev()){ current = null; msg = "Dit event bestaat niet meer, of je bent er geen gast meer."; }
      watchWines(); paint(); paintNext();
    }, err => { loaded = true; msg = err && err.code === "permission-denied" ? errText(err, true) : "Je events konden niet geladen worden."; paint(); });
  }
  function watchWines(){
    if(winesFor === current) return;
    if(unsubWines){ unsubWines(); unsubWines = null; }
    winesFor = current; evWines = [];
    if(!current) return;
    unsubWines = fs.collection("events/" + current + "/wines").onSnapshot(snap => {
      evWines = snap.docs.map(d => ({id: d.id, ...d.data()}));
      paint();
    }, () => {});
  }
  function open(id){ current = id; editing = false; picking = false; inviteLink = ""; confirmDel = false; msg = ""; openW.clear(); watchWines(); paint(); window.scrollTo({top: 0}); }

  async function createEvent(name, date, place){
    const ref = fs.collection("events").doc();
    await ref.set({name, date, place, note: "", owner: me.uid, memberIds: [me.uid],
      members: {[me.uid]: {name: me.name, email: me.email, role: "owner"}}, createdAt: F.serverTimestamp()});
    return ref.id;
  }
  // A copy of the wine, without what is personal to your own cellar (price paid, stock, place, notes).
  const COPY = ["name", "producer", "vintage", "region", "country", "grape", "color", "desc", "taste", "food", "temp", "decant", "glass", "photo"];
  async function addWine(eventId, w){
    const col = fs.collection("events/" + eventId + "/wines");
    const have = (eventId === current ? evWines : (await col.where("addedBy.uid", "==", me.uid).get()).docs.map(d => ({id: d.id, ...d.data()})))
      .find(x => x.addedBy?.uid === me.uid && x.src?.wineId === w.id && x.src?.cellarId === cloud.cellar.id);
    if(have){ await col.doc(have.id).update({qty: (have.qty || 1) + 1}); return "more"; }
    const copy = {};
    COPY.forEach(k => { if(w[k]) copy[k] = w[k]; });
    if(w.from) copy.drinkFrom = w.from;
    if(w.to) copy.drinkTo = w.to;
    await col.doc().set({...copy, qty: 1, src: {cellarId: cloud.cellar.id, cellarName: cloud.cellar.name, wineId: w.id},
      addedBy: {uid: me.uid, name: me.name}, addedAt: Date.now()});
    return "new";
  }
  async function joinWithCode(code){
    const inv = await fs.doc("eventInvites/" + code).get();
    if(!inv.exists) throw Object.assign(new Error("invite"), {code: "invite-missing"});
    const d = inv.data();
    if(d.expiresAt && d.expiresAt.toMillis() < Date.now()) throw Object.assign(new Error("invite"), {code: "invite-expired"});
    const already = await fs.doc("events/" + d.eventId).get().then(s => s.exists && (s.data().memberIds || []).includes(me.uid)).catch(() => false);
    if(already) return {id: d.eventId, name: d.eventName, fresh: false};
    await fs.doc("events/" + d.eventId).update({
      memberIds: F.arrayUnion(me.uid),
      ["members." + me.uid]: {name: me.name, email: me.email, role: "member"},
      lastJoin: {uid: me.uid, code}
    });
    return {id: d.eventId, name: d.eventName, fresh: true};
  }
  // People you already share a cellar with: the owner can add them in one tap.
  function knownPeople(e){
    const out = new Map();
    (cloud.cellars || []).concat(cloud.cellar ? [cloud.cellar] : []).forEach(c => Object.entries(c.members || {}).forEach(([uid, m]) => {
      if(uid !== me.uid && (c.memberIds || []).includes(uid) && !(e.memberIds || []).includes(uid)) out.set(uid, {name: m.name || m.email || "?", email: m.email || ""});
    }));
    return [...out.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "nl"));
  }

  // ---------- view ----------
  function keepInputs(root, draw){
    const vals = {}, act = document.activeElement, focus = act && root.contains(act) ? act.id : null;
    const sel = focus && "selectionStart" in act ? [act.selectionStart, act.selectionEnd] : null;
    root.querySelectorAll("input[id],textarea[id]").forEach(i => { vals[i.id] = i.value; });
    draw();
    Object.entries(vals).forEach(([id, v]) => { const i = $(id); if(i && i.type !== "date") i.value = v; else if(i && v) i.value = v; });
    if(focus && $(focus)){ $(focus).focus({preventScroll: true}); if(sel) try{ $(focus).setSelectionRange(...sel); }catch{} }
  }
  function paint(){
    const box = $("v_events");
    if(!box || box.hidden) return;
    keepInputs(box, () => { box.innerHTML = current && ev() ? detailHtml(ev()) : listHtml(); });
  }
  const dayBadge = e => {
    if(!e.date) return `<span class="evday"><b>?</b><small>datum</small></span>`;
    const d = new Date(e.date + "T12:00:00");
    return `<span class="evday"><b>${d.getDate()}</b><small>${d.toLocaleDateString("nl-BE", {month: "short"}).replace(".", "")}</small></span>`;
  };
  function itemHtml(e){
    const n = (e.memberIds || []).length;
    return `<button type="button" class="evitem${isPast(e) ? " past" : ""}" data-ev="${e.id}">${dayBadge(e)}
      <span class="t"><strong>${ui.esc(e.name)}</strong><span>${[e.place, n + (n === 1 ? " gast" : " gasten"), mine(e) ? "jij organiseert" : "van " + ui.esc(e.members?.[e.owner]?.name || "?")].filter(Boolean).map(ui.esc).join(" · ")}</span></span>
      <svg class="mwi" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>`;
  }
  function listHtml(){
    const up = events.filter(e => !isPast(e)), past = events.filter(isPast);
    return `<div class="box"><h2 class="sec">Events</h2>
        <p class="hint">Organiseer een etentje of proefavond en stel samen met je gasten de wijnlijst op. Iedereen voegt wijnen uit de eigen kelder toe, en iedereen ziet wat er gedronken wordt.</p>
        ${creating ? `<form class="evform" id="evNewForm">
            <label>Naam<input id="evNewName" maxlength="80" placeholder="bv. Etentje bij Sofie" required></label>
            <div class="grid2"><label>Datum<input id="evNewDate" type="date" value="${TODAY()}"></label><label>Plaats (optioneel)<input id="evNewPlace" maxlength="80" placeholder="bv. Meerstraat 12"></label></div>
            <div class="actions"><button class="link" type="button" data-e="cancelnew">Annuleren</button><button class="btn sm" type="submit">Maak event</button></div></form>`
          : `<div><button class="btn sm" type="button" data-e="new">${ui.ico("plus")}Nieuw event</button></div>`}
        ${msg ? `<p class="hint">${ui.esc(msg)}</p>` : ""}</div>
      ${!loaded ? `<p class="status">Events laden…</p>`
        : !events.length ? `<div class="empty"><div class="big">Nog geen events</div><p>Maak er een, of vraag de organisator om je toe te voegen of je een uitnodigingslink te sturen.</p></div>`
        : `${up.length ? `<div class="evlist">${up.map(itemHtml).join("")}</div>` : `<p class="hint">Geen komende events.</p>`}
           ${past.length ? `<div class="evgroup">Voorbij</div><div class="evlist">${past.map(itemHtml).join("")}</div>` : ""}`}`;
  }
  const bringer = w => w.addedBy?.uid === me.uid ? "Jij" : (w.addedBy?.name || "?");
  const avatar = w => `<span class="evav${w.addedBy?.uid === me.uid ? " me" : ""}" aria-hidden="true">${ui.esc(ui.initial(w.addedBy?.name || "?"))}</span>`;
  function compactHtml(w){
    const qty = w.qty || 1, sub = [COLORS[w.color], w.region].filter(Boolean).join(" · ");
    return `<article class="card"><button class="crow" type="button" data-e="toggle" data-w="${w.id}" aria-expanded="false" aria-label="${ui.esc(w.name || "Wijn")}, meegebracht door ${ui.esc(bringer(w))}. Toon details">
        ${w.photo ? `<img class="thumb" src="${ui.esc(w.photo)}" alt="">` : `<div class="thumb ph">${ui.esc((w.name || "?")[0])}</div>`}
        <div style="min-width:0">
          <div class="cn">${w.vintage ? `<span class="vint">${ui.esc(w.vintage)}</span>` : ""}${ui.esc(w.name || "Wijn")}</div>
          <div class="cs"><span class="dot ${ui.esc(w.color)}"></span><span>${ui.esc(sub || "Wijn")}</span></div>
          <div class="cb">${avatar(w)}<span>${ui.esc(bringer(w))} brengt mee</span></div>
        </div>
        <div class="cr"><span class="cq">${qty} fl.</span></div>
      </button></article>`;
  }
  function wineHtml(w, e){
    const open = openW.has(w.id), own = w.addedBy?.uid === me.uid, qty = w.qty || 1;
    if(evView === "compact" && !open) return compactHtml(w);
    const win = w.drinkFrom && w.drinkTo ? `${w.drinkFrom}–${w.drinkTo}` : w.drinkFrom ? "vanaf " + w.drinkFrom : w.drinkTo ? "tot " + w.drinkTo : "";
    const facts = [["Druif", w.grape], ["Streek", [w.region, w.country].filter(Boolean).join(", ")], ["Aroma's & smaak", w.taste], ["Past bij", w.food],
      ["Schenken op", w.temp], ["Decanteren", w.decant], ["Glas", w.glass], ["Drinkvenster", win]].filter(f => f[1]);
    return `<article class="card${open ? " open" : ""}">
      <div class="row">
        ${w.photo ? `<img class="thumb" src="${ui.esc(w.photo)}" alt="">` : `<div class="thumb ph">${ui.esc((w.name || "?")[0])}</div>`}
        <div class="meta">
          ${w.producer ? `<div class="prod">${ui.esc(w.producer)}</div>` : ""}
          <h3 class="name">${ui.esc(w.name || "Wijn")}</h3>
          <div class="sub">${w.vintage ? `<span class="vint">${ui.esc(w.vintage)}</span>` : ""}
            <span class="pill"><span class="dot ${ui.esc(w.color)}"></span>${COLORS[w.color] || "Wijn"}</span>${w.region ? `<span>${ui.esc(w.region)}</span>` : ""}</div>
          <div class="evby">${avatar(w)}<span>${own ? "<b>Jij</b> brengt" : `<b>${ui.esc(w.addedBy?.name || "?")}</b> brengt`} ${own ? "" : qty + " fles" + (qty === 1 ? "" : "sen")}</span>${w.src?.cellarName ? ` · uit "${ui.esc(w.src.cellarName)}"` : ""}</div>
          ${own ? `<div class="line2"><div class="stock" role="group" aria-label="Aantal flessen">
              <button type="button" data-e="minus" data-w="${w.id}" aria-label="Eén fles minder">−</button><span>${qty} fles${qty === 1 ? "" : "sen"}</span>
              <button type="button" data-e="plus" data-w="${w.id}" aria-label="Eén fles meer">+</button></div></div>` : ""}
        </div>
      </div>
      <button class="toggle" type="button" data-e="toggle" data-w="${w.id}" aria-expanded="${open}"><span>${open ? "Beschrijving inklappen" : "Lees de beschrijving"}</span><span class="chev" aria-hidden="true">▾</span></button>
      <div class="roll"><div><div class="desc">
        ${w.desc ? `<p>${ui.esc(w.desc)}</p>` : ""}
        ${facts.length ? `<dl class="facts">${facts.map(f => `<div><dt>${f[0]}</dt><dd>${ui.esc(f[1])}</dd></div>`).join("")}</dl>` : ""}
        ${!w.desc && !facts.length ? `<p class="hint">Geen beschrijving bij deze wijn.</p>` : ""}
        ${own || mine(e) ? `<div class="cardfoot"><button class="link" type="button" data-e="rmwine" data-w="${w.id}">Haal van de lijst</button></div>` : ""}
      </div></div></div></article>`;
  }
  function pickerHtml(e){
    const all = (window.mwWines ? window.mwWines() : []).filter(w => w.status === "kelder");
    const q = pickQ.trim().toLowerCase();
    const rows = all.filter(w => !q || [w.name, w.producer, w.region, w.country, w.grape, w.vintage].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.stock > 0) - (a.stock > 0) || String(a.name).localeCompare(String(b.name), "nl")).slice(0, 60);
    const count = id => evWines.filter(x => x.addedBy?.uid === me.uid && x.src?.wineId === id && x.src?.cellarId === cloud.cellar.id).reduce((s, x) => s + (x.qty || 1), 0);
    return `<section class="mwsec evpick">${ui.head("cellar", "Uit " + ui.esc(cloud.cellar.name), `<button class="mwx" type="button" data-e="pickclose" aria-label="Sluiten">${ui.ico("close")}</button>`)}
      ${all.length ? `<input id="evPickQ" type="search" placeholder="Zoek in je kelder…" aria-label="Zoek in je kelder" value="${ui.esc(pickQ)}">` : ""}
      ${!all.length ? `<p>Er staan nog geen wijnen in deze kelder.</p>` : !rows.length ? `<p>Geen wijn gevonden.</p>`
        : rows.map(w => { const n = count(w.id); return `<div class="opt">${w.photo ? `<img src="${ui.esc(w.photo)}" alt="">` : `<span class="ph">${ui.esc((w.name || "?")[0])}</span>`}
            <span class="t"><b>${ui.esc(w.name)}${w.vintage ? " " + ui.esc(w.vintage) : ""}</b><small>${[w.producer, COLORS[w.color], w.stock + " in kelder"].filter(Boolean).map(ui.esc).join(" · ")}</small></span>
            <button class="btn ${n ? "ghost " : ""}sm" type="button" data-e="addwine" data-w="${w.id}">${n ? `+1 (${n})` : "Voeg toe"}</button></div>`; }).join("")}
      ${(cloud.cellars || []).length > 1 ? `<p>Wijn uit een andere kelder? Wissel bovenaan van kelder en kom terug naar dit event.</p>` : ""}</section>`;
  }
  // who brings how many bottles: [[uid, name, bottles]], yourself first
  function whoBrings(){
    const m = new Map();
    evWines.forEach(w => { const u = w.addedBy?.uid || "?", x = m.get(u) || [u, w.addedBy?.name || "?", 0]; x[2] += w.qty || 1; m.set(u, x); });
    return [...m.values()].sort((a, b) => (b[0] === me.uid) - (a[0] === me.uid) || String(a[1]).localeCompare(String(b[1]), "nl"));
  }
  function detailHtml(e){
    const owner = mine(e), bottles = evWines.reduce((s, w) => s + (w.qty || 1), 0);
    const members = Object.entries(e.members || {}).filter(([uid]) => (e.memberIds || []).includes(uid))
      .sort((a, b) => (b[1].role === "owner") - (a[1].role === "owner") || String(a[1].name).localeCompare(String(b[1].name), "nl"));
    const groups = ORDER.concat([""]).map(c => [c, evWines.filter(w => c ? w.color === c : !ORDER.includes(w.color))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "nl"))]).filter(g => g[1].length);
    const people = owner ? knownPeople(e) : [];
    return `<button class="evback" type="button" data-e="back">${ui.ico("back")}Alle events</button>
      <div class="box">
        ${editing ? `<form class="evform" id="evEditForm">
            <label>Naam<input id="evEdName" maxlength="80" value="${ui.esc(e.name)}" required></label>
            <div class="grid2"><label>Datum<input id="evEdDate" type="date" value="${ui.esc(e.date || "")}"></label><label>Plaats<input id="evEdPlace" maxlength="80" value="${ui.esc(e.place || "")}"></label></div>
            <label>Voor de gasten (optioneel)<textarea id="evEdNote" rows="2" maxlength="400" placeholder="bv. we eten lam, breng gerust iets bubbels mee">${ui.esc(e.note || "")}</textarea></label>
            <div class="actions"><button class="link" type="button" data-e="canceledit">Annuleren</button><button class="btn sm" type="submit">Bewaar</button></div></form>`
        : `<div class="evhead"><span class="eyebrow">${owner ? "Jij organiseert" : "Georganiseerd door " + ui.esc(e.members?.[e.owner]?.name || "?")}</span>
            <h2>${ui.esc(e.name)}</h2>
            <div class="when">${e.date ? `<span>${ui.ico("calendar")}${ui.esc(fmtDay(e.date))}</span>` : ""}${e.place ? `<span>${ui.ico("pin")}${ui.esc(e.place)}</span>` : ""}</div>
            ${e.note ? `<p class="evsum">${ui.esc(e.note)}</p>` : ""}
            ${owner ? `<div><button class="btn ghost sm" type="button" data-e="edit">${ui.ico("pencil")}Bewerk</button></div>` : ""}</div>`}
        ${msg ? `<p class="hint">${ui.esc(msg)}</p>` : ""}
      </div>

      <div class="box">${ui.head("glass", "Wijnlijst", `<small>${bottles ? bottles + " fles" + (bottles === 1 ? "" : "sen") : "nog leeg"}</small>`)}
        <div class="evlisthead"><p class="hint">${evWines.length ? "In de volgorde waarin je ze meestal schenkt: bubbels, wit, rosé, rood, dessert." : "Nog geen wijnen. Voeg er een toe uit je kelder; de andere gasten zien hem meteen."}</p>
          ${evWines.length > 1 ? `<div class="viewsw" role="group" aria-label="Weergave">
            <button type="button" data-e="view" data-v="cards" aria-pressed="${evView === "cards"}" aria-label="Kaarten" title="Kaarten"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/></svg></button>
            <button type="button" data-e="view" data-v="compact" aria-pressed="${evView === "compact"}" aria-label="Compacte lijst" title="Compacte lijst"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg></button></div>` : ""}</div>
        ${whoBrings().length ? `<div class="evwho" aria-label="Wie brengt wat mee">${whoBrings().map(([uid, n, q]) => `<span><span class="evav${uid === me.uid ? " me" : ""}" aria-hidden="true">${ui.esc(ui.initial(n))}</span>${uid === me.uid ? "Jij" : ui.esc(n)} <small>${q} fl.</small></span>`).join("")}</div>` : ""}
        ${picking ? "" : `<div><button class="btn sm" type="button" data-e="pick">${ui.ico("plus")}Voeg wijn uit je kelder toe</button></div>`}
      </div>
      ${picking ? pickerHtml(e) : ""}
      ${groups.length ? `<div class="evwines">${groups.map(([c, ws]) => `<div class="evgroup"><span class="dot ${c}"></span>${COLORS[c] || "Overige"}</div><div class="evcol${evView === "compact" ? " compact" : ""}">${ws.map(w => wineHtml(w, e)).join("")}</div>`).join("")}</div>` : ""}

      <section class="mwsec">${ui.head("users", "Gasten", `<small>${members.length}</small>`)}
        <div>${members.map(([uid, m]) => `<div class="mwrow"><span class="mwav">${ui.initial(m.name || m.email)}</span><span class="who"><b>${ui.esc(m.name || "?")}${uid === me.uid ? " (jij)" : ""}</b>${m.role === "owner" ? `<span class="mwrole">organisator</span>` : ""}</span>
          ${owner && uid !== me.uid ? `<button class="mwic danger" type="button" data-e="rmguest" data-u="${uid}" aria-label="Haal ${ui.esc(m.name || "")} van het event">${ui.ico("userMinus")}</button>` : ""}</div>`).join("")}</div>
        ${owner ? `${people.length ? `<p>Voeg iemand toe met wie je al een kelder deelt:</p><div class="mwchips">${people.map(([uid, p]) => `<button type="button" class="chip" data-e="addguest" data-u="${uid}">${ui.ico("userPlus")}${ui.esc(p.name)}</button>`).join("")}</div>` : ""}
          <p>Of stuur een uitnodigingslink (7 dagen geldig). Wie nog geen account heeft, maakt er een en komt meteen bij dit event.</p>
          ${inviteLink ? `<div class="line"><input id="evInv" readonly value="${ui.esc(inviteLink)}" aria-label="Uitnodigingslink"><button class="btn sm" type="button" data-e="copyinv">${ui.ico(navigator.share ? "share" : "copy")}${navigator.share ? "Deel" : "Kopieer"}</button></div>`
            : `<div><button class="btn ghost sm" type="button" data-e="invite">${ui.ico("link")}Maak uitnodigingslink</button></div>`}` : ""}
      </section>

      <div class="mwdanger">${owner
        ? (confirmDel ? `<span class="hint">Het event en de hele wijnlijst verdwijnen voor iedereen. De wijnen in jullie kelders blijven staan.</span>
            <span><button class="btn sm" type="button" data-e="delyes">${ui.ico("trash")}Ja, verwijder</button> <button class="link" type="button" data-e="delno">Nee</button></span>`
          : `<button type="button" data-e="del">${ui.ico("trash")}Verwijder dit event</button>`)
        : `<button type="button" data-e="leave">${ui.ico("logout")}Verlaat dit event</button>`}</div>`;
  }

  // ---------- actions ----------
  async function onClick(ev_){
    const evb = ev_.target.closest("[data-ev]");
    if(evb){ open(evb.dataset.ev); return; }
    const b = ev_.target.closest("[data-e]"); if(!b) return;
    const a = b.dataset.e, e = ev(), wid = b.dataset.w, w = evWines.find(x => x.id === wid);
    try{
      if(a === "new"){ creating = true; msg = ""; paint(); $("evNewName")?.focus(); return; }
      if(a === "cancelnew"){ creating = false; paint(); return; }
      if(a === "back"){ current = null; watchWines(); msg = ""; paint(); return; }
      if(a === "edit"){ editing = true; paint(); return; }
      if(a === "canceledit"){ editing = false; paint(); return; }
      if(a === "pick"){ picking = true; paint(); $("evPickQ")?.focus(); return; }
      if(a === "pickclose"){ picking = false; pickQ = ""; paint(); return; }
      if(a === "toggle"){ openW.has(wid) ? openW.delete(wid) : openW.add(wid); paint(); return; }
      if(a === "view"){ evView = b.dataset.v === "compact" ? "compact" : "cards"; try{ localStorage.setItem("mw_evview", evView); }catch{} if(evView === "compact") openW.clear(); paint(); return; }
      if(a === "addwine"){
        const src = (window.mwWines ? window.mwWines() : []).find(x => x.id === wid); if(!src || !e) return;
        b.disabled = true; await addWine(e.id, src); msg = ""; return;
      }
      if(a === "plus" && w){ await fs.doc(`events/${e.id}/wines/${w.id}`).update({qty: (w.qty || 1) + 1}); return; }
      if(a === "minus" && w){ if((w.qty || 1) <= 1) return; await fs.doc(`events/${e.id}/wines/${w.id}`).update({qty: (w.qty || 1) - 1}); return; }
      if(a === "rmwine" && w){ await fs.doc(`events/${e.id}/wines/${w.id}`).delete(); openW.delete(w.id); return; }
      if(a === "addguest"){
        const p = knownPeople(e).find(([uid]) => uid === b.dataset.u); if(!p) return;
        b.disabled = true;
        await fs.doc("events/" + e.id).update({memberIds: F.arrayUnion(p[0]), ["members." + p[0]]: {name: p[1].name, email: p[1].email, role: "member"}});
        msg = p[1].name + " is toegevoegd en ziet het event nu in de tab Events."; paint(); return;
      }
      if(a === "rmguest"){
        const uid = b.dataset.u;
        await fs.doc("events/" + e.id).update({memberIds: F.arrayRemove(uid), ["members." + uid]: F.delete()}); return;
      }
      if(a === "invite"){
        b.disabled = true;
        const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), x => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
        await fs.doc("eventInvites/" + code).set({eventId: e.id, eventName: e.name, by: me.uid, byName: me.name,
          createdAt: F.serverTimestamp(), expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 7 * 864e5)});
        inviteLink = location.origin + location.pathname + "?event=" + code + (new URLSearchParams(location.search).has("emu") ? "&emu=1" : "");
        paint(); return;
      }
      if(a === "copyinv"){
        const text = `Je bent uitgenodigd voor "${e.name}"${e.date ? " op " + fmtDay(e.date) : ""}. Kijk welke wijnen er komen en voeg je eigen fles toe:`;
        if(navigator.share){ try{ await navigator.share({title: e.name, text, url: inviteLink}); }catch{} return; }
        try{ await navigator.clipboard.writeText(inviteLink); msg = "Link gekopieerd."; }catch{ $("evInv").select(); msg = "Kopieer de link hierboven."; }
        paint(); return;
      }
      if(a === "del"){ confirmDel = true; paint(); return; }
      if(a === "delno"){ confirmDel = false; paint(); return; }
      if(a === "delyes"){
        b.disabled = true;
        const snap = await fs.collection("events/" + e.id + "/wines").get();
        const batch = fs.batch(); snap.docs.forEach(d => batch.delete(d.ref)); batch.delete(fs.doc("events/" + e.id));
        await batch.commit(); current = null; watchWines(); confirmDel = false; msg = `"${e.name}" is verwijderd.`; paint(); return;
      }
      if(a === "leave"){
        await fs.doc("events/" + e.id).update({memberIds: F.arrayRemove(me.uid), ["members." + me.uid]: F.delete()});
        current = null; watchWines(); msg = `Je hebt "${e.name}" verlaten.`; paint(); return;
      }
    }catch(err){ msg = errText(err); paint(); }
  }
  async function onSubmit(ev_){
    ev_.preventDefault();
    const f = ev_.target, btn = f.querySelector("button[type=submit]");
    try{
      if(f.id === "evNewForm"){
        const name = $("evNewName").value.trim(); if(!name){ $("evNewName").focus(); return; }
        btn.disabled = true;
        const id = await createEvent(name, $("evNewDate").value || "", $("evNewPlace").value.trim());
        creating = false; open(id);
        ui.cheer("Nieuw event!", `"${name}" staat klaar. Voeg nu wijnen en gasten toe. Schollekes!`);
      } else if(f.id === "evEditForm"){
        const name = $("evEdName").value.trim(); if(!name){ $("evEdName").focus(); return; }
        btn.disabled = true;
        await fs.doc("events/" + current).update({name, date: $("evEdDate").value || "", place: $("evEdPlace").value.trim(), note: $("evEdNote").value.trim()});
        editing = false; paint();
      }
    }catch(err){ msg = errText(err, f.id === "evNewForm"); if(btn) btn.disabled = false; paint(); }
  }

  // ---------- "Naar event" from a wine card ----------
  function pickEventFor(w){
    const up = events.filter(e => !isPast(e));
    let sh = $("evSheet");
    if(!sh){
      sh = document.createElement("div"); sh.className = "sheet"; sh.id = "evSheet"; sh.hidden = true;
      sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="evSheetTitle"><div class="mwtop"><h2 id="evSheetTitle">Naar een event</h2>
        <button class="mwx" type="button" data-x="1" aria-label="Sluiten">${ui.ico("close")}</button></div><div class="evlist" id="evSheetBody"></div></div>`;
      document.body.appendChild(sh);
      sh.addEventListener("click", async e => {
        if(e.target === sh || e.target.closest("[data-x]")){ sh.hidden = true; return; }
        const go = e.target.closest("[data-go]"); if(go){ sh.hidden = true; window.mwSetTab && window.mwSetTab("events"); return; }
        const b = e.target.closest("[data-ev]"); if(!b || !sh._w) return;
        b.disabled = true;
        const target = events.find(x => x.id === b.dataset.ev);
        try{ const r = await addWine(target.id, sh._w); sh.hidden = true;
          $("status").textContent = r === "more" ? `Nog een fles erbij voor "${target.name}".` : `${sh._w.name} staat op de wijnlijst van "${target.name}".`; }
        catch(err){ b.disabled = false; $("status").textContent = errText(err); }
      });
      document.addEventListener("keydown", e => { if(e.key === "Escape" && !sh.hidden) sh.hidden = true; });
    }
    sh._w = w;
    $("evSheetBody").innerHTML = `<p class="hint">Kies het event waar je <b>${ui.esc(w.name)}</b> meebrengt. De andere gasten zien de wijn meteen op de lijst.</p>`
      + (up.length ? up.map(itemHtml).join("") : `<div class="empty"><p>Je hebt geen komende events.</p><button class="btn sm" type="button" data-go="1">${ui.ico("plus")}Maak een event</button></div>`);
    sh.hidden = false;
  }

  // ---------- header: the next event, with a small half-full glass of red ----------
  let nextKey = "";
  function paintNext(){
    let b = $("evNext");
    if(!b){
      b = document.createElement("button"); b.id = "evNext"; b.type = "button"; b.hidden = true;
      b.onclick = () => { window.mwSetTab && window.mwSetTab("events"); open(b.dataset.ev); };
    }
    const acct = $("mwAcct"), host = document.querySelector("header");
    if(acct){ if(acct.nextSibling !== b) acct.after(b); } else if(host && b.parentNode !== host) host.appendChild(b);
    const today = TODAY();
    const e = events.filter(x => x.date && x.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0];
    if(!e){ b.hidden = true; nextKey = ""; return; }
    const days = Math.round((new Date(e.date + "T12:00:00") - new Date(today + "T12:00:00")) / 864e5);
    const when = days === 0 ? "Vandaag!" : days === 1 ? "Morgen"
      : days < 7 ? "Over " + days + " dagen"
      : (() => { try{ return new Date(e.date + "T12:00:00").toLocaleDateString("nl-BE", {weekday: "short", day: "numeric", month: "short"}); }catch{ return e.date; } })();
    const key = e.id + "|" + e.name + "|" + when;
    b.dataset.ev = e.id; b.hidden = false;
    b.setAttribute("aria-label", "Volgend event: " + e.name + ", " + when.toLowerCase());
    if(key === nextKey) return; // don't restart the fill animation on every snapshot
    nextKey = key;
    b.innerHTML = `<span class="tx"><small>${ui.esc(when)}</small><b>${ui.esc(e.name)}</b></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="evNextBowl"><path d="M6 3h12c0 8-2 11.5-6 12C8 14.5 6 11 6 3z"/></clipPath></defs>
      <g clip-path="url(#evNextBowl)"><rect class="wn" x="0" y="9" width="24" height="16"/></g>
      <path class="gl" d="M6 3h12c0 8-2 11.5-6 12C8 14.5 6 11 6 3zM12 15v6M8.5 21h7"/></svg>`;
  }

  // ---------- boot ----------
  cloud.ready.then(async () => {
    fs = cloud.fs; F = firebase.firestore.FieldValue; ui = cloud.ui; me = cloud.me;
    if(!fs || !ui) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab"); tab.id = "t_events"; tab.dataset.tab = "events"; tab.setAttribute("aria-selected", "false");
    tab.innerHTML = `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4"/></svg><span class="tl">Events</span>`;
    document.querySelector(".tabs")?.appendChild(tab);
    const sec = document.createElement("section"); sec.id = "v_events"; sec.hidden = true; sec.style.cssText = "display:flex;flex-direction:column;gap:14px";
    $("v_ask").after(sec);
    sec.addEventListener("click", onClick);
    sec.addEventListener("submit", onSubmit);
    sec.addEventListener("input", e => { if(e.target.id === "evPickQ"){ pickQ = e.target.value; paint(); } });
    window.mwEvents = {render: paint, pickFor: pickEventFor, ready: true};
    listenEvents();

    // invite link: ?event=CODE
    const code = ui.store.get("mw_event");
    if(code){
      ui.store.set("mw_event", null);
      try{ const q = new URLSearchParams(location.search); q.delete("event"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }catch{}
      try{
        const j = await joinWithCode(code);
        current = j.id; watchWines();
        window.mwSetTab && window.mwSetTab("events");
        if(j.fresh) ui.cheer("Welkom bij het event!", `Je bent gast op "${j.name}". Voeg je wijnen toe. Schollekes!`);
      }catch(e){
        $("status").textContent = e.code === "invite-expired" ? "Deze uitnodiging voor een event is verlopen. Vraag een nieuwe link."
          : e.code === "invite-missing" ? "Deze uitnodiging voor een event bestaat niet meer. Vraag een nieuwe link." : "Meedoen aan het event lukte niet: " + ui.msgOf(e);
      }
    }
  });
})();
