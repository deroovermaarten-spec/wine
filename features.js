/*
 * MD projects — "Wat kan deze app?": the features that make the app special, under Settings › App.
 *
 * Adding a feature: when a big update lands (one with `big` in news.js), add it to FEATURES below in plain
 * Dutch, written for the people using the app. Put it where it fits; the list does not need to be in date order.
 * New ones get `since: "YYYY-MM-DD"` and wear a "nieuw" tag for a few weeks.
 */
(() => {
  const FEATURES = [
    {e: "📸", t: "Etiket scannen", d: "Fotografeer een etiket en Claude vult de rest in: druif, streek, smaak, drinkvenster en waar hij bij past."},
    {e: "💬", t: "Vraag het aan je kelder", d: "Wat drink ik bij stoofvlees? Welke fles moet eerst op? Je kelder antwoordt, met je eigen flessen."},
    {e: "⏳", t: "Klaar om te drinken", d: "Elke wijn krijgt een drinkvenster. De app zegt welke flessen nu op hun best zijn en welke dringend op moeten."},
    {e: "🍾", t: "Vegen om te openen", d: "Veeg een wijn naar rechts om een fles te openen, naar links om er een af te boeken. Een half vol flesje toont wat open staat."},
    {e: "📝", t: "Proefnotities", d: "Kleur, aroma's, structuur en rijpheid in een paar tikken, met je score. Een notitieboekje in de lijst toont wat je al proefde."},
    {e: "🗓️", t: "Gedronken", d: "Een tijdlijn van elke fles die je opende, per maand. Verkeerd getikt? Pas de datum of de status aan.", since: "2026-11-14"},
    {e: "🧬", t: "Kelder-DNA", d: "Je kelder in één ring: tik op een kleur voor de landen, op een land voor de druiven."},
    {e: "🗺️", t: "Inzichten", d: "Een wereldkaart van je wijnen, je wijnjaar, je beste glas, verborgen parels en wat je opnieuw moet kopen."},
    {e: "🏡", t: "Het wijnhuis", d: "Geschiedenis, eigenaars en werkwijze van de producent, opgezocht door Claude."},
    {e: "🍽️", t: "Wat eet je erbij", d: "Gerechten met recept die bij de wijn passen, plus de juiste temperatuur, decanteren en het beste glas."},
    {e: "👥", t: "Samen één kelder", d: "Deel je kelder met wie je wilt. Iedereen geeft zijn eigen score, en je ziet wat de anderen ervan vonden."},
    {e: "🎉", t: "Events", d: "Een etentje waar elke gast wijnen uit zijn eigen kelder meebrengt, netjes in de volgorde om te schenken."},
    {e: "♡", t: "Verlanglijst", d: "Bewaar wijnen die je nog wilt kopen. Een topwijn die op is, zet je met Koop opnieuw meteen terug."},
    {e: "💡", t: "Weetje van de dag", d: "Elke dag iets nieuws over wijn, kort en zonder moeilijke woorden."},
    {e: "📄", t: "Delen als fiche", d: "Stuur een nette pdf van een wijn door, met foto, beschrijving en info over het wijnhuis."},
    {e: "🔔", t: "Herinneringen", d: "Een seintje als een fles al een paar dagen open staat, of als er iets dringend gedronken moet worden."},
    {e: "↩️", t: "Ongedaan maken", d: "Per ongeluk getikt? Bijna alles zet je met één tik terug."},
  ];
  const NEW_DAYS = 21;

  const cloud = window.mwCloud;
  if(!cloud) return;
  let open = false, ui = null;

  const css = `
.mwfeat > summary{list-style:none;cursor:pointer}
.mwfeat > summary::-webkit-details-marker{display:none}
.mwfeat[open] .mwchev{transform:rotate(180deg)}
.mwfeat:not([open]){gap:0}
.mwfeat .intro{margin:0;font-size:.86rem;color:var(--muted)}
.mwfgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.mwfgrid > div{position:relative;display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--bg);
  animation:mwfin .4s cubic-bezier(.3,1.3,.5,1) both}
.mwfgrid .em{flex:none;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:1.25rem;background:var(--accent-soft);transition:transform .3s cubic-bezier(.3,1.8,.5,1)}
.mwfgrid > div:nth-child(odd) .em{transform:rotate(-6deg)}
.mwfgrid > div:nth-child(even) .em{transform:rotate(5deg)}
.mwfgrid > div:hover .em{transform:rotate(0) scale(1.15)}
.mwfgrid b{display:block;font:500 1rem var(--display);color:var(--ink);margin-bottom:1px}
.mwfgrid small{display:block;font-size:.8rem;line-height:1.35;color:var(--muted)}
.mwfgrid .tag{position:absolute;top:-7px;right:10px;font-size:.66rem;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--accent);color:var(--onaccent)}
@keyframes mwfin{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){.mwfgrid > div{animation:none}.mwfgrid .em{transition:none}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const isNew = f => f.since && (Date.now() - Date.parse(f.since + "T12:00:00")) / 864e5 <= NEW_DAYS;

  // Settings › App, folded until you open it
  function settingsHtml(){
    if(!ui) return "";
    const fresh = FEATURES.filter(isNew).length;
    return `<details class="mwsec mwfeat" id="mwFeat"${open ? " open" : ""}>
      <summary>${ui.head("glass", "Wat kan deze app?", `<small${fresh ? ' class="new" style="color:var(--accent)"' : ""}>${FEATURES.length} dingen${fresh ? ` · ${fresh} nieuw` : ""}</small><svg class="mwi mwchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`)}</summary>
      <p class="intro">Een wijnkelder die meedenkt. Dit maakt hem anders dan een lijstje in een notitie-app:</p>
      <div class="mwfgrid">${FEATURES.map((f, i) => `<div style="animation-delay:${Math.min(i, 12) * 35}ms">${isNew(f) ? `<span class="tag">nieuw</span>` : ""}<span class="em" aria-hidden="true">${f.e}</span><span><b>${ui.esc(f.t)}</b><small>${ui.esc(f.d)}</small></span></div>`).join("")}</div>
    </details>`;
  }
  // "toggle" does not bubble: remember open/closed across the many redraws of Settings
  document.addEventListener("toggle", e => { if(e.target.id === "mwFeat") open = e.target.open; }, true);

  window.mwFeatures = {settingsHtml};
  cloud.ready.then(() => { ui = cloud.ui; });
})();
