/*
 * Meerstraat wines — local runtime.
 *
 * The app was first built as a Claude artifact, where `window.claude.use(...)`
 * gives it a cloud database, the signed-in user, Claude itself and downloads.
 * Outside claude.ai none of that exists, so this file provides the same small
 * interface backed by IndexedDB on the device. Everything stays on the phone.
 *
 *   db        collection(path) / doc(path) with set, update, delete, get, onSnapshot
 *   user      a fixed local id
 *   downloads save({filename, data}) via the share sheet or a download link
 *   sample    null  (Claude features are switched off until an API key is added)
 *   mcp       null  (map search is switched off)
 */
(() => {
  const DB_NAME = "meerstraat-wines", STORE = "docs";
  let dbp = null;
  function open(){
    return dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore(STORE, {keyPath: "path"});
        s.createIndex("col", "col");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
  }
  async function tx(mode, fn){
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      let out; Promise.resolve(fn(s)).then(v => out = v);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("aborted"));
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const listeners = new Map(); // col path -> Set(cb)
  const split = p => { const i = p.lastIndexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; };
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), x => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[x % 62]).join("").slice(0, 20);
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  async function list(col){
    const rows = await tx("readonly", s => req(s.index("col").getAll(col)));
    return rows.map(r => ({id: r.id, data: () => clone(r.data)}));
  }
  // Batch notifications so a large import re-renders once, not once per wine.
  const pending = new Map();
  function emit(col){
    if(pending.has(col)) return;
    pending.set(col, setTimeout(() => { pending.delete(col); emitNow(col); }, 40));
  }
  async function emitNow(col){
    const set = listeners.get(col); if(!set || !set.size) return;
    let docs; try{ docs = await list(col); }catch(e){ set.forEach(l => l.err && l.err(e)); return; }
    set.forEach(l => { try{ l.cb({docs, size: docs.length, empty: !docs.length, metadata: {fromCache: false}}); }catch(e){ console.error(e); } });
  }

  function docRef(path){
    const [col, id] = split(path);
    return {
      id, path,
      async get(){ const r = await tx("readonly", s => req(s.get(path))); return {id, exists: !!r, data: () => r ? clone(r.data) : undefined}; },
      async set(data){ await tx("readwrite", s => s.put({path, col, id, data: clone(data), at: Date.now()})); emit(col); },
      async update(patch){
        await tx("readwrite", async s => {
          const cur = await req(s.get(path));
          if(!cur) throw Object.assign(new Error("not found"), {code: "not_found"});
          s.put({...cur, data: {...cur.data, ...clone(patch)}, at: Date.now()});
        });
        emit(col);
      },
      async delete(){ await tx("readwrite", s => s.delete(path)); emit(col); }
    };
  }
  function collection(col){
    return {
      path: col,
      doc: id => docRef(col + "/" + (id || newId())),
      async get(){ const docs = await list(col); return {docs, size: docs.length, empty: !docs.length}; },
      onSnapshot(cb, err){
        const l = {cb, err}; if(!listeners.has(col)) listeners.set(col, new Set());
        listeners.get(col).add(l);
        list(col).then(docs => cb({docs, size: docs.length, empty: !docs.length, metadata: {fromCache: false}}), e => err && err(e));
        return () => listeners.get(col)?.delete(l);
      }
    };
  }
  const db = {collection, doc: docRef};

  const user = {id: async () => "local", name: async () => "Maarten"};

  const downloads = {
    async save({filename, data}){
      const blob = data instanceof Blob ? data : new Blob([data]);
      const file = new File([blob], filename, {type: blob.type || "application/octet-stream"});
      // On phones the share sheet is the most reliable way to keep a file (Save to Files, AirDrop, mail…)
      if(navigator.canShare && matchMedia("(pointer:coarse)").matches && navigator.canShare({files: [file]})){
        try{ await navigator.share({files: [file], title: filename}); return; }
        catch(e){ if(e && e.name === "AbortError") throw Object.assign(new Error("declined"), {code: "declined"}); }
      }
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  };

  // Ask the browser not to clear the cellar when the device is low on space.
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch{}

  // sample = AI. Only when a Gemini key is saved on this device (see ai.js); otherwise the app hides the AI features.
  const caps = {db, user, downloads, mcp: null};
  const ai = () => (window.mwAi && window.mwAi.hasKey() ? window.mwAi.sample : null);
  window.claude = {use: async name => (name === "sample" ? ai() : name in caps ? caps[name] : null), local: true};
})();
