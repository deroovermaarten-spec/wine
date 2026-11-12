/*
 * Meerstraat wines — Claude for the smart features, paid per use by the owner.
 *
 * The app's smart features (label scan, "wat drink ik vanavond", Vraag, weetje,
 * gerechten, wijnhuis, winkeltip, map coordinates) all call one function, `sample`.
 * In the Claude artifact claude.ai provides it. Here it goes to a small relay
 * (worker/worker.js on Cloudflare) that holds the API key and lets only members of
 * the owner's cellars through. The phone sends its Firebase sign-in token, never a key.
 *
 *   sample(promptOrMessages, {task, images, signal, onText, system}) -> {text, truncated}
 *   sample.json(prompt, opts) -> parsed JSON
 * Errors carry .code: cancelled | rate_limited | not_granted | image_rejected | prompt_too_large | failed
 * rate_limited also covers the relay's daily limits; then .limit is "daily_limit" or "task_limit".
 */
(() => {
  const err = (code, msg, extra) => Object.assign(new Error(msg || code), {code}, extra || {});

  // Claude reads photos up to about 1568 px on the long side; smaller uploads are faster.
  function imageBlock(file){
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, 1568 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res({type: "image", source: {type: "base64", media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1]}});
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(err("image_rejected")); };
      img.src = url;
    });
  }

  async function buildMessages(input, images){
    const msgs = (typeof input === "string" ? [{role: "user", content: input}] : input)
      .map(m => ({role: m.role === "assistant" ? "assistant" : "user", content: [{type: "text", text: String(m.content || "")}]}));
    if(images && images.length){
      const blocks = await Promise.all(images.map(imageBlock));
      const last = [...msgs].reverse().find(m => m.role === "user");
      last.content.unshift(...blocks);
    }
    return msgs;
  }

  function make(url, getToken){
    async function run(input, opts = {}){
      if(opts.signal && opts.signal.aborted) throw err("cancelled");
      const stream = !!opts.onText;
      // task: which feature asks (scan, ask, pick…). The relay picks the model and limits per feature.
      const payload = {task: opts.task || "legacy", stream, messages: await buildMessages(input, opts.images)};
      if(typeof opts.system === "string") payload.system = opts.system;
      let res;
      try{
        const token = await getToken();
        res = await fetch(url, {method: "POST", signal: opts.signal, headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token}, body: JSON.stringify(payload)});
      }catch(e){
        if(opts.signal && opts.signal.aborted) throw err("cancelled");
        throw err("failed", navigator.onLine ? "network" : "offline");
      }
      if(!res.ok){
        let info = {}; try{ info = (await res.json()).error || {}; }catch{}
        const m = String(info.message || info.code || "");
        if(res.status === 401 || res.status === 403) throw err("not_granted", m);
        if(res.status === 429 || res.status === 529 || info.type === "overloaded_error") throw err("rate_limited", m, {limit: /^(daily|task)_limit$/.test(info.code || "") ? info.code : ""});
        if(res.status === 413 || (res.status === 400 && /too long|too large|exceed/i.test(m))) throw err("prompt_too_large", m);
        if(res.status === 400 && /image/i.test(m)) throw err("image_rejected", m);
        throw err("failed", m || ("HTTP " + res.status));
      }
      let text = "", stop = "";
      if(!stream){
        const j = await res.json();
        for(const b of j.content || []) if(b.type === "text") text += b.text;
        stop = j.stop_reason || "";
      }else{
        const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
        try{
          for(;;){
            const {done, value} = await reader.read(); if(done) break;
            buf += dec.decode(value, {stream: true});
            let i;
            while((i = buf.indexOf("\n")) >= 0){
              const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
              if(!line.startsWith("data:")) continue;
              let ev; try{ ev = JSON.parse(line.slice(5)); }catch{ continue; }
              if(ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta"){ text += ev.delta.text; opts.onText({text}); }
              else if(ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
              else if(ev.type === "error") throw err(ev.error && ev.error.type === "overloaded_error" ? "rate_limited" : "failed", ev.error && ev.error.message, {text});
            }
          }
        }catch(e){ if(opts.signal && opts.signal.aborted) throw err("cancelled", "", {text}); throw e; }
      }
      if(stop === "refusal") throw err("failed", "refusal", {text});
      try{ window.mwStats && window.mwStats.ai(); }catch{} // counted for the builder's usage overview (admin.js)
      return {text, truncated: stop === "max_tokens"};
    }

    function parseJSON(t){
      t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      try{ return JSON.parse(t); }catch{}
      const a = t.indexOf("{"), b = t.lastIndexOf("}");
      if(a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
      throw err("failed", "bad json");
    }

    const sample = (input, opts) => run(input, {...(opts || {}), onText: opts && opts.onText});
    sample.json = async (input, opts) => parseJSON((await run(input, {...(opts || {}), onText: null})).text);
    return sample;
  }

  window.mwAi = {make};
})();
