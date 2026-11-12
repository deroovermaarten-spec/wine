/*
 * MD projects — "Wat is er nieuw": what changed in the app, per day.
 *
 *  - Settings › App shows the list below, newest day first.
 *  - A day with `big` also gets a card once, the first time someone opens the app after that update.
 *    Closing the card (or opening the list in Settings) marks everything up to the newest day as seen.
 *  - "Seen" is kept on the profile, users/{uid}.newsSeen (a date), so it holds on every device and after
 *    the phone clears its storage. Someone without newsSeen starts from the day their account was made,
 *    so new people never get old news.
 *
 * Adding news: put a new day at the TOP of NEWS, in plain Dutch, written for the people using the app.
 * Several changes on one day go in the same entry. Only add `big` for something people should not miss.
 */
(() => {
  const NEWS = [
    {date: "2026-11-12",
      big: {icon: "spark", title: "Blijf op de hoogte", text: "Vanaf nu lees je onder Instellingen › App wat er nieuw is in de app, per dag. Bij een grote vernieuwing krijg je, zoals nu, één keer dit kaartje."},
      items: [
        "Nieuw: “Wat is er nieuw” onder Instellingen › App, met per dag wat er veranderde.",
        "Bij grote vernieuwingen krijg je eenmalig een kaartje als je de app opent.",
        "Je eigen kelder krijgt bovenaan een eigen kleur. Zo zie je meteen of je in je eigen kelder of in een gedeelde kelder zit.",
        "Het weetje van de dag heeft een eigen lampje, half gevuld met rode wijn. Terwijl er een nieuw weetje wordt ingeschonken, klotst de wijn op en neer.",
        "De app telt voortaan hoe vaak hij gebruikt wordt, zodat de maker weet wat werkt. Dat zijn alleen tellingen: je wijnen, notities en e-mailadres blijven privé.",
        "Vragen stel je nu meteen op de eerste pagina, onder het weetje: “Vraag het aan je kelder” vervangt de tab Vraag en het blok “Wat drink ik vanavond?”. Typ bijvoorbeeld wat je vanavond eet. Met “Wissen” maak je het blok weer leeg.",
        "Kleine feestjes bij een tik: sterren springen op als je een wijn hoger scoort, het aantal flessen telt zichtbaar op of af, er vliegt een kurk uit een fles die je opentrekt en het icoon van een tabblad wipt even op."
      ]},
    {date: "2026-11-11",
      items: [
        "In een gedeelde kelder geeft elk lid nu een eigen score aan een wijn.",
        "Passen twee mensen tegelijk iets aan, dan gaat er niets meer verloren.",
        "Je profiel is beter afgeschermd: anderen zien alleen je naam.",
        "De slimme functies (etiket lezen, Vraag, het weetje) hebben een daglimiet per persoon."
      ]},
    {date: "2026-11-10",
      items: [
        "Bovenaan staat alles altijd op dezelfde plek, ook op de telefoon en bij een lege kelder.",
        "Een nieuwe kelder vier je met twee klinkende glazen en een “Schol!”.",
        "Datums volgen je eigen dag, ook als de app na middernacht weer opengaat."
      ]},
    {date: "2026-11-09",
      items: [
        "Raad een wijn aan aan iemand anders, met een persoonlijk berichtje. De wijn komt op hun verlanglijst.",
        "Sfeer: kies een van vijf zuiderse kleuren (Amalfi, Provence, Santorini, Toscane, Andalusië).",
        "De instellingen staan in drie tabs: Kelder, Voor mij en App.",
        "Een ronde Scan-knop, een ⋯-menu, ongedaan maken, inklapbare blokken en vegen in de lijst.",
        "Bij het scrollen zweeft er een fles bovenaan: tik erop om terug naar boven te gaan.",
        "Bij een proefmoment zie je de wijnen als kaarten of als lijst, en wie welke fles meebrengt."
      ]},
    {date: "2026-11-08",
      items: [
        "Herinneringen: een melding als een geopende fles op moet, of als wijnen binnenkort gedronken moeten worden. Je stelt ze in bij Instellingen › Voor mij.",
        "Jouw wijnjaar bij Inzichten: wat je dronk, je beste glas en wat nieuw was.",
        "De wijnlijst als kaarten of als compacte lijst.",
        "Zoeken zit achter het vergrootglas bovenaan.",
        "“Klaar om te drinken” toont alle wijnen in een lijst.",
        "Vlotter met een grote kelder."
      ]},
    {date: "2026-11-07",
      items: [
        "Plan een proefmoment en stel samen de wijnlijst op.",
        "Bovenaan zie je je volgende proefmoment, met een glas dat voller wordt naarmate het dichterbij komt.",
        "Op de telefoon staan de tabs onderaan, met de scanknop erboven.",
        "De instellingen zijn altijd één tik weg via het tandwiel.",
        "Nieuwe gebruikers krijgen een welkom."
      ]},
    {date: "2026-11-06",
      items: [
        "Mijn smaak: vul in wat je lekker vindt en filter erop.",
        "Een belletje toont welke wijnen anderen aan een gedeelde kelder toevoegden.",
        "Snel wisselen van kelder via de knop bovenaan.",
        "Schenkadvies, en offline een etiket later laten herkennen."
      ]},
    {date: "2026-11-05",
      items: ["Dag- en nachtmodus, met de knop bovenaan."]}
  ];
  // Before this list existed nobody had "seen" anything; start everyone from here, not from their first day.
  const START = "2026-11-11";
  const SHOW_DAYS = 5; // older days fold behind "Toon oudere"

  const cloud = window.mwCloud;
  const $ = id => document.getElementById(id);
  const latest = NEWS[0].date;
  let seen = latest, seenAtOpen = latest, open = false, all = false, ui = null;

  const css = `
.mwnews > summary{list-style:none;cursor:pointer}
.mwnews > summary::-webkit-details-marker{display:none}
.mwnews[open] .mwchev{transform:rotate(180deg)}
.mwnews:not([open]){gap:0}
.mwnews .mwhead small.new{color:var(--accent)}
.mwnday{display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid var(--line)}
.mwnday h4{margin:0;font-size:.82rem;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:8px}
.mwnday h4 .tag{font-size:.68rem;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--accent);color:var(--onaccent)}
.mwnday ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.mwnday li{font-size:.86rem;color:var(--ink)}
.mwnday.unseen h4{color:var(--accent)}
.mwnews .link{align-self:flex-start}
#mwGear{position:relative}
#mwGear .mwndot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
#mwGear .mwndot{position:absolute;top:4px;right:4px;box-shadow:0 0 0 2px var(--surface)}
#mwNewsCard .panel{gap:14px}
#mwNewsCard .mwnbig{display:flex;gap:12px;align-items:flex-start}
#mwNewsCard .mwnbig b{display:block;font:500 1.05rem var(--display);margin-bottom:2px}
#mwNewsCard .mwnbig p{margin:0;font-size:.9rem;color:var(--muted)}
#mwNewsCard .mwnicon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
#mwNewsCard .mwnicon .mwi{width:24px;height:24px}
#mwNewsCard .mwnicon{animation:mwnpop .6s .15s cubic-bezier(.3,1.6,.5,1) both}
@keyframes mwnpop{0%{opacity:0;transform:scale(.4) rotate(-10deg)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#mwNewsCard .mwnicon{animation:none}}`;

  const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("nl-BE", {weekday: "long", day: "numeric", month: "long"});
  const localDay = t => { const d = new Date(t); return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const unseen = () => NEWS.filter(n => n.date > seen);

  function markSeen(){
    if(seen >= latest) return;
    seen = latest;
    try{ localStorage.setItem("mw_news_" + cloud.me.uid, seen); }catch{}
    cloud.fs.doc("users/" + cloud.me.uid).set({newsSeen: seen}, {merge: true}).catch(() => {});
    paintDots();
  }

  // a small dot on the cog and on the App tab while there is news you have not looked at
  function paintDots(){
    const g = $("mwGear"); if(!g) return;
    const want = unseen().length > 0, has = g.querySelector(".mwndot");
    if(want && !has){ const d = document.createElement("span"); d.className = "mwndot"; d.setAttribute("aria-hidden", "true"); g.appendChild(d); g.setAttribute("aria-label", "Instellingen (nieuws)"); }
    if(!want && has){ has.remove(); g.setAttribute("aria-label", "Instellingen"); }
    cloud.redraw && cloud.redraw(); // the dot on the App tab
  }

  // Settings › App. Days that were new when you opened the list keep their "nieuw" tag until the app reloads.
  function settingsHtml(){
    if(!ui) return "";
    const fresh = unseen().length, days = all ? NEWS : NEWS.slice(0, SHOW_DAYS);
    return `<details class="mwsec mwnews" id="mwNews"${open ? " open" : ""}>
      <summary>${ui.head("spark", "Wat is er nieuw", `${fresh ? `<small class="new">${fresh} ${fresh === 1 ? "update" : "updates"}</small>` : `<small>${fmt(latest).replace(/^\S+ /, "")}</small>`}<svg class="mwi mwchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`)}</summary>
      ${days.map(n => `<div class="mwnday${n.date > seenAtOpen ? " unseen" : ""}"><h4>${ui.esc(fmt(n.date))}${n.date > seenAtOpen ? `<span class="tag">nieuw</span>` : ""}</h4>
        <ul>${n.items.map(i => `<li>${ui.esc(i)}</li>`).join("")}</ul></div>`).join("")}
      ${!all && NEWS.length > SHOW_DAYS ? `<button class="link" type="button" data-news="all">Toon oudere</button>` : ""}
    </details>`;
  }
  // The card, once, for days marked big that you have not seen yet.
  function showCard(){
    const big = unseen().filter(n => n.big);
    if(!big.length || $("mwNewsCard")) return;
    const sh = document.createElement("div"); sh.className = "sheet"; sh.id = "mwNewsCard";
    sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="mwNewsTitle">
      <div><span class="eyebrow">Nieuw in de app</span><h2 id="mwNewsTitle">${big.length === 1 ? ui.esc(big[0].big.title) : "Er is weer wat bijgekomen"}</h2></div>
      ${big.map(n => `<div class="mwnbig"><span class="mwnicon">${ui.ico(n.big.icon || "spark")}</span><div>${big.length > 1 ? `<b>${ui.esc(n.big.title)}</b>` : ""}<p>${ui.esc(n.big.text)}</p></div></div>`).join("")}
      <div class="actions"><button class="btn ghost" type="button" id="mwNewsMore">Alles wat nieuw is</button><button class="btn" type="button" id="mwNewsOk">Top, gezien</button></div></div>`;
    document.body.appendChild(sh);
    const close = () => { sh.remove(); document.removeEventListener("keydown", onKey); markSeen(); };
    const onKey = e => { if(e.key === "Escape") close(); };
    $("mwNewsOk").onclick = close;
    $("mwNewsMore").onclick = () => { seenAtOpen = seen; close(); open = true; cloud.openSettings && cloud.openSettings("app"); };
    sh.addEventListener("click", e => { if(e.target === sh) close(); });
    document.addEventListener("keydown", onKey);
    $("mwNewsOk").focus();
  }

  // Wait until the welcome or a cheer is gone, so cards never pile up.
  function whenCalm(fn, tries = 0){
    if(tries < 20 && (document.querySelector(".sheet:not([hidden])") || document.querySelector(".mwcheer"))) return setTimeout(() => whenCalm(fn, tries + 1), 1000);
    fn();
  }

  window.mwNews = {settingsHtml, list: NEWS, unread: () => !!ui && unseen().length > 0};
  if(!cloud) return;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  // the list remembers whether it is open while Settings redraws; opening it counts as reading it
  document.addEventListener("toggle", e => {
    if(e.target.id !== "mwNews") return;
    open = e.target.open;
    if(open && seen < latest){ seenAtOpen = seen; markSeen(); }
  }, true);
  document.addEventListener("click", e => {
    if(e.target.closest("[data-news='all']")){ all = true; cloud.redraw && cloud.redraw(); }
  });

  cloud.ready.then(() => {
    ui = cloud.ui;
    const prof = cloud.profile || {};
    let local = ""; try{ local = localStorage.getItem("mw_news_" + cloud.me.uid) || ""; }catch{}
    const since = localDay(firebase.auth().currentUser?.metadata?.creationTime);
    // newest of: what the profile says, what this phone says, and where this person started
    seen = [prof.newsSeen || "", local, since, START].sort().pop();
    seenAtOpen = seen;
    paintDots();
    setTimeout(() => whenCalm(showCard), 1200);
  });
})();
