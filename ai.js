/*
 * Meerstraat wines — AI through Google Gemini, with the owner's own free API key.
 *
 * The app's smart features (label scan, "wat drink ik vanavond", Vraag, weetje,
 * gerechten, wijnhuis, winkeltip, map coordinates) all call one function, `sample`.
 * In the Claude artifact claude.ai provides it; here it calls the Gemini API straight
 * from the browser. The key is stored only on this device (localStorage) and is sent
 * only to generativelanguage.googleapis.com.
 *
 *   sample(promptOrMessages, {images, signal, onText, modelTier}) -> {text, truncated}
 *   sample.json(prompt, opts) -> parsed JSON
 * Errors carry .code: cancelled | rate_limited | bad_key | image_rejected | prompt_too_large | failed
 */
(() => {
  const KEY = "mw_gemini_key";
  const API = "https://generativelanguage.googleapis.com/v1beta/models/";
  // "-latest" aliases follow Google's current free Flash models; the fixed names are a fallback.
  const MODELS = {
    default: ["gemini-flash-latest", "gemini-2.5-flash"],
    quick: ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest"]
  };
  const getKey = () => { try{ return localStorage.getItem(KEY) || ""; }catch{ return ""; } };
  const err = (code, msg, extra) => Object.assign(new Error(msg || code), {code}, extra || {});

  function imageToPart(file){
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res({inline_data: {mime_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1]}});
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(err("image_rejected")); };
      img.src = url;
    });
  }

  async function buildContents(input, images){
    const msgs = typeof input === "string" ? [{role: "user", content: input}] : input;
    const contents = msgs.map(m => ({role: m.role === "assistant" ? "model" : "user", parts: [{text: String(m.content || "")}]}));
    if(images && images.length){
      const parts = await Promise.all(images.map(imageToPart));
      const last = [...contents].reverse().find(c => c.role === "user");
      last.parts.unshift(...parts);
    }
    return contents;
  }

  async function call(model, body, {signal, onText}){
    const key = getKey();
    const stream = !!onText;
    const url = API + model + (stream ? ":streamGenerateContent?alt=sse" : ":generateContent");
    let res;
    try{
      res = await fetch(url, {method: "POST", signal, headers: {"Content-Type": "application/json", "x-goog-api-key": key}, body: JSON.stringify(body)});
    }catch(e){
      if(signal && signal.aborted) throw err("cancelled");
      throw err("failed", navigator.onLine ? "network" : "offline");
    }
    if(!res.ok){
      let info = {}; try{ info = (await res.json()).error || {}; }catch{}
      const m = String(info.message || "");
      if(res.status === 404) throw err("model_missing", m);
      if(res.status === 429) throw err("rate_limited", m);
      if(res.status === 401 || res.status === 403 || /api key/i.test(m)) throw err("bad_key", m);
      if(res.status === 400 && /token|too large|exceeds/i.test(m)) throw err("prompt_too_large", m);
      if(res.status === 400 && /image|inline_data|mime/i.test(m)) throw err("image_rejected", m);
      throw err("failed", m || ("HTTP " + res.status));
    }
    let text = "", finish = "", blocked = "";
    const take = j => {
      if(j.promptFeedback && j.promptFeedback.blockReason) blocked = j.promptFeedback.blockReason;
      const c = (j.candidates || [])[0];
      if(c){ if(c.finishReason) finish = c.finishReason; for(const p of (c.content && c.content.parts) || []) if(p.text && !p.thought) text += p.text; }
    };
    if(!stream){ take(await res.json()); }
    else{
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      try{
        for(;;){
          const {done, value} = await reader.read(); if(done) break;
          buf += dec.decode(value, {stream: true});
          let i;
          while((i = buf.indexOf("\n")) >= 0){
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if(!line.startsWith("data:")) continue;
            try{ const before = text.length; take(JSON.parse(line.slice(5))); if(text.length !== before) onText({text}); }catch{}
          }
        }
      }catch(e){ if(signal && signal.aborted) throw err("cancelled", "", {text}); throw e; }
    }
    if(blocked || finish === "SAFETY" || finish === "PROHIBITED_CONTENT") throw err("failed", "blocked", {text});
    return {text, truncated: finish === "MAX_TOKENS"};
  }

  async function run(input, opts = {}, json = false){
    if(!getKey()) throw err("bad_key", "no key");
    if(opts.signal && opts.signal.aborted) throw err("cancelled");
    const body = {contents: await buildContents(input, opts.images), generationConfig: {maxOutputTokens: 8192}};
    if(json) body.generationConfig.responseMimeType = "application/json";
    const list = MODELS[opts.modelTier === "quick" ? "quick" : "default"];
    let last;
    for(const model of list){
      try{ return await call(model, body, json ? {signal: opts.signal} : opts); }
      catch(e){ last = e; if(e.code !== "model_missing") throw e; }
    }
    throw last;
  }

  function parseJSON(t){
    t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try{ return JSON.parse(t); }catch{}
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if(a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw err("failed", "bad json");
  }

  const sample = (input, opts) => run(input, opts, false);
  sample.json = async (input, opts) => parseJSON((await run(input, opts, true)).text);

  window.mwAi = {
    sample, hasKey: () => !!getKey(),
    setKey: k => { try{ k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); }catch{} },
    getKey,
    async test(k){
      const res = await fetch(API + "gemini-flash-lite-latest:generateContent", {method: "POST", headers: {"Content-Type": "application/json", "x-goog-api-key": k.trim()},
        body: JSON.stringify({contents: [{role: "user", parts: [{text: "Antwoord met OK."}]}], generationConfig: {maxOutputTokens: 5}})}).catch(() => null);
      if(!res) return "offline";
      if(res.ok || res.status === 429 || res.status === 404) return "ok";
      return "bad";
    }
  };
})();
