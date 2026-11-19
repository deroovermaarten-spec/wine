/*
 * MD projects — tips: recommend a wine to someone else, with a personal message.
 *
 *  tips/{id}  {from {uid, name}, to uid, toName, message, wine (a public copy, no notes or price paid), createdAt}
 *
 * The sender writes the tip; the receiver's app picks it up, puts the wine on their wish list
 * (in a cellar they may write to, preferably the one that is open) and then removes the tip.
 * The receiver can react from the wine card: that writes tipReplies/{id}; the sender gets a card with it
 * the next time the app is open, and closing the card removes the reaction.
 * Only active with logins (cloud.js). Who may read or change what: firestore.rules.
 */
(() => {
  const cloud = window.mwCloud;
  if(!cloud) return;
  const $ = id => document.getElementById(id);
  let fs, ui, me;
  // the form in the share sheet keeps its state while the sheet redraws
  let draft = {to: "", toName: "", email: "", message: "", msg: "", sent: ""};

  const css = `
.tipbox .tipto{display:flex;flex-wrap:wrap;gap:6px}
.tipbox .tipto button{font:inherit;font-size:.86rem;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px}
.tipbox .tipto button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.tipbox .tipto .av{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-size:.7rem;font-weight:700}
.tipbox input,.tipbox textarea{font:inherit;font-size:.92rem;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 10px;min-width:0;width:100%;box-sizing:border-box}
.tipbox textarea{resize:vertical}
.tipbox .ok{color:var(--ok);font-size:.88rem;margin:0}
.tipbox .err{color:var(--accent);font-size:.88rem;margin:0}
.tipnote{margin:6px 0 0;padding:8px 10px;border-left:3px solid var(--gold);background:var(--accent-soft);border-radius:0 8px 8px 0;font-size:.88rem;color:var(--ink);display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.tipnote p{margin:0}
.tipnote small{display:block;color:var(--muted);font-size:.76rem;margin-top:2px}
.tipnote .tiprep{align-self:stretch;margin-left:14px;padding:6px 9px;background:var(--surface);border-radius:8px}
.tipnote .tipbtn{font:inherit;font-size:.8rem;font-weight:600;color:var(--accent);background:none;border:0;padding:2px 0;display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.tipnote .tipform{align-self:stretch;display:flex;flex-direction:column;gap:6px}
.tipnote .tipform textarea{font:inherit;font-size:.9rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;resize:vertical;width:100%;box-sizing:border-box}
.tiprx{display:flex;flex-direction:column;gap:10px}
.tiprx .one{padding:10px 12px;border-left:3px solid var(--gold);background:var(--accent-soft);border-radius:0 10px 10px 0}
.tiprx .one b{display:block;font-size:.8rem;color:var(--muted);font-weight:600;margin-bottom:4px}
.tiprx .one q{display:block;font-size:1rem;quotes:"“" "”"}
.tiprx .one small{display:block;color:var(--muted);font-size:.76rem;margin-top:6px}`;

  // People you already share a cellar with.
  function people(){
    const out = new Map();
    (cloud.cellars || []).concat(cloud.cellar ? [cloud.cellar] : []).forEach(c => Object.entries(c.members || {}).forEach(([uid, m]) => {
      if(uid !== me.uid && (c.memberIds || []).includes(uid)) out.set(uid, m.name || m.email || "?");
    }));
    return [...out.entries()].sort((a, b) => a[1].localeCompare(b[1], "nl"));
  }

  // The box at the top of "Wijn delen".
  function html(){
    const esc = ui.esc, ps = people();
    if(draft.sent) return `<div class="sharebox tipbox"><h3>Tip een vriend</h3><p class="ok">${esc(draft.sent)}</p>
      <div><button class="btn ghost sm" type="button" data-tip="again">Tip nog iemand</button></div></div>`;
    return `<div class="sharebox tipbox"><h3>Tip een vriend</h3>
      <p>De wijn komt op hun verlanglijst, met jouw boodschap erbij.</p>
      ${ps.length ? `<div class="tipto" role="group" aria-label="Kies wie">${ps.map(([uid, n]) =>
        `<button type="button" data-tip="to" data-uid="${esc(uid)}" data-name="${esc(n)}" aria-pressed="${draft.to === uid}"><span class="av">${esc(ui.initial(n))}</span>${esc(n)}</button>`).join("")}</div>` : ""}
      <input id="tipEmail" type="email" inputmode="email" autocomplete="off" value="${esc(draft.email)}" placeholder="${ps.length ? "Of een e-mailadres" : "E-mailadres van wie je wilt tippen"}" aria-label="E-mailadres">
      <textarea id="tipMsg" rows="3" maxlength="500" placeholder="Je boodschap, bv. Deze moet je echt eens proberen bij de barbecue!" aria-label="Persoonlijke boodschap">${esc(draft.message)}</textarea>
      ${draft.msg ? `<p class="err">${esc(draft.msg)}</p>` : ""}
      <div><button class="btn sm" type="button" data-tip="send">Stuur tip</button></div></div>`;
  }

  // Mount the box in the share sheet. wine = public copy (index.html publicCopy), name = for messages.
  function mount(root, wine){
    if(!fs || !root) return;
    const old = root.querySelector(".tipbox"); if(old) old.remove();
    root.insertAdjacentHTML("afterbegin", html());
    const box = root.querySelector(".tipbox");
    box.addEventListener("input", e => {
      if(e.target.id === "tipEmail"){ draft.email = e.target.value; if(draft.email.trim() && draft.to){ draft.to = ""; draft.toName = ""; box.querySelectorAll('[data-tip="to"]').forEach(b => b.setAttribute("aria-pressed", "false")); } }
      if(e.target.id === "tipMsg") draft.message = e.target.value;
    });
    box.addEventListener("click", async e => {
      const b = e.target.closest("[data-tip]"); if(!b) return;
      const a = b.dataset.tip;
      if(a === "to"){
        const on = draft.to !== b.dataset.uid;
        draft.to = on ? b.dataset.uid : ""; draft.toName = on ? b.dataset.name : "";
        if(on){ draft.email = ""; const em = $("tipEmail"); if(em) em.value = ""; }
        box.querySelectorAll('[data-tip="to"]').forEach(x => x.setAttribute("aria-pressed", String(x.dataset.uid === draft.to)));
        return;
      }
      if(a === "again"){ draft = {to: "", toName: "", email: "", message: "", msg: "", sent: ""}; mount(root, wine); return; }
      if(a === "send"){
        draft.msg = "";
        b.disabled = true; b.textContent = "Versturen…";
        try{ draft.sent = await send(wine); draft.to = ""; draft.toName = ""; draft.email = ""; draft.message = ""; }
        catch(err){ draft.msg = err.nice || (err.code === "permission-denied" ? "Tips zijn nog niet actief: de beveiligingsregels met tips zijn niet gepubliceerd in Firebase." : "Versturen lukte niet: " + ui.msgOf(err)); }
        mount(root, wine);
      }
    });
  }

  async function send(wine){
    let to = draft.to, toName = draft.toName;
    const email = draft.email.trim().toLowerCase();
    if(!to && email){
      if(email === (me.email || "").toLowerCase()) throw {nice: "Dat ben je zelf. Kies iemand anders."};
      // Only an exact address can be looked up; the list of everyone who uses the app stays private.
      const s = /^[^\s/@]+@[^\s/@]+$/.test(email) ? await fs.doc("emails/" + email).get() : null;
      if(!s || !s.exists) throw {nice: "Niemand met dat e-mailadres gebruikt de app (of hij opende de app nog niet sinds de laatste update). Vraag of ze de app even openen."};
      to = s.data().uid; toName = s.data().name || email;
    }
    if(!to) throw {nice: "Kies eerst wie je wilt tippen."};
    await fs.collection("tips").add({
      from: {uid: me.uid, name: me.name}, to, toName, message: draft.message.trim().slice(0, 500), wine,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return `Verstuurd! ${wine.name} staat zo op de verlanglijst van ${toName}.`;
  }

  // ---------- receiving ----------
  const busy = new Set();
  function writableCellar(){
    const ok = c => c && (c.owner === me.uid || c.membersEdit);
    if(ok(cloud.cellar)) return cloud.cellar;
    return (cloud.cellars || []).find(c => c.owner === me.uid) || null;
  }
  function listen(){
    fs.collection("tips").where("to", "==", me.uid).onSnapshot(snap => {
      snap.docs.forEach(d => take(d));
    }, () => {});
  }
  async function take(d){
    if(busy.has(d.id) || d.metadata?.hasPendingWrites) return;
    busy.add(d.id);
    const t = d.data(), c = writableCellar();
    if(!c){ busy.delete(d.id); return; }
    const w = {...(t.wine || {})}; delete w.sharedAt;
    const from = t.from || {}, name = from.name || "iemand";
    Object.assign(w, {
      status: "wens", stock: 0, tastings: [], score: 0, shareId: "", openedAt: "",
      tags: ["tip van " + name], createdAt: Date.now(),
      addedBy: {uid: from.uid || "", name}, // so the bell shows it as new
      tip: {from: name, uid: from.uid || "", message: t.message || "", at: Date.now()}
    });
    try{
      // the id follows the tip, so two devices taking the same tip write the same wine once
      await fs.doc("cellars/" + c.id + "/wines/tip_" + d.id).set(w);
      await d.ref.delete();
      const here = c.id === cloud.cellar?.id;
      ui.cheer(`Een tip van ${name}!`, `${w.name || "Een wijn"} staat op je verlanglijst${here ? "" : ` in "${c.name}"`}.${t.message ? ` "${t.message}"` : ""}`);
    }catch{ busy.delete(d.id); }
  }

  // ---------- reacting to a tip you got ----------
  // tipReplies/{id} {from {uid, name}, to uid (who sent the tip), wine (its name), tip (their message), message, createdAt}
  async function reply(w, text){
    const tp = w.tip || {};
    if(!fs || !me) throw {nice: "Reageren kan alleen als je aangemeld bent."};
    if(!tp.uid) throw {nice: "Bij deze tip weten we niet meer wie hem stuurde."};
    try{
      await fs.collection("tipReplies").add({
        from: {uid: me.uid, name: me.name}, to: tp.uid,
        wine: [w.name, w.vintage].filter(Boolean).join(" ").slice(0, 200),
        tip: String(tp.message || "").slice(0, 500), message: String(text).trim().slice(0, 300),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }catch(err){
      throw {nice: err.code === "permission-denied" ? "Reageren is nog niet actief: de beveiligingsregels met reacties zijn niet gepubliceerd in Firebase." : "Je reactie versturen lukte niet: " + ui.msgOf(err)};
    }
  }

  // Reactions on tips you sent: one card with all of them; they go away once you close it.
  const rx = new Map();
  let rxKey = null;
  function listenReplies(){
    fs.collection("tipReplies").where("to", "==", me.uid).onSnapshot(snap => {
      snap.docChanges().forEach(ch => { if(ch.type === "removed") rx.delete(ch.doc.id); else if(!ch.doc.metadata.hasPendingWrites) rx.set(ch.doc.id, ch.doc); });
      if(rx.size) whenCalm(showReplies);
    }, () => {});
  }
  function whenCalm(fn, tries = 0){
    if(tries < 30 && (document.querySelector(".sheet:not([hidden]):not(#mwTipRx)") || document.querySelector(".mwcheer"))) return setTimeout(() => whenCalm(fn, tries + 1), 1000);
    fn();
  }
  function showReplies(){
    if(!rx.size) return;
    const esc = ui.esc, docs = [...rx.values()];
    const names = [...new Set(docs.map(d => d.data().from?.name || "Iemand"))];
    const body = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="mwTipRxTitle">
      <div><span class="eyebrow">Reactie op je tip</span><h2 id="mwTipRxTitle">${names.length === 1 ? `${esc(names[0])} reageerde` : "Er werd gereageerd"}</h2></div>
      <div class="tiprx">${docs.map(d => { const r = d.data(); return `<div class="one"><b>${names.length > 1 ? esc(r.from?.name || "Iemand") + " over " : "Over "}${esc(r.wine || "je tip")}</b>
        <q>${esc(r.message)}</q>${r.tip ? `<small>Jouw tip: “${esc(r.tip)}”</small>` : ""}</div>`; }).join("")}</div>
      <div class="actions"><button class="btn" type="button" id="mwTipRxOk">Leuk, gezien</button></div></div>`;
    let sh = document.getElementById("mwTipRx");
    if(sh){ sh.innerHTML = body; }
    else{ sh = document.createElement("div"); sh.className = "sheet"; sh.id = "mwTipRx"; sh.innerHTML = body; document.body.appendChild(sh); }
    const close = () => {
      sh.remove(); document.removeEventListener("keydown", rxKey); rxKey = null;
      docs.forEach(d => { rx.delete(d.id); d.ref.delete().catch(() => {}); });
    };
    if(rxKey) document.removeEventListener("keydown", rxKey);
    rxKey = e => { if(e.key === "Escape") close(); };
    document.getElementById("mwTipRxOk").onclick = close;
    sh.onclick = e => { if(e.target === sh) close(); };
    document.addEventListener("keydown", rxKey);
    document.getElementById("mwTipRxOk").focus();
  }

  cloud.ready.then(() => {
    fs = cloud.fs; ui = cloud.ui; me = cloud.me;
    if(!fs || !me) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    window.mwTips = {mount, reply};
    listen();
    listenReplies();
  });
})();
