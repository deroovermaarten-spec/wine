/*
 * Meerstraat wines — AI relay (Cloudflare Worker).
 *
 * The app sends its Claude requests here instead of to Anthropic directly, so the
 * API key never reaches a phone. Only people who are signed in to the app AND are a
 * member of one of the owner's cellars may use it.
 *
 * Settings (Cloudflare → Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY   secret   the key from console.anthropic.com
 *   OWNER_UID           text     the owner's Firebase user id (shown in the app's cellar menu)
 *   FIREBASE_PROJECT    text     meerstraat-wines
 *   DAILY_LIMIT         text     optional, max requests per person per day (default 150)
 */
const ORIGINS = ["https://deroovermaarten-spec.github.io", "http://localhost:8765", "http://localhost:8000"];
const MODELS = {default: "claude-opus-5-5", quick: "claude-haiku-5-5"};
const JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let keys = null, keysAt = 0;
const members = new Map(); // uid -> {ok, at}
const counts = new Map();  // uid|day -> n

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
const dec = s => JSON.parse(new TextDecoder().decode(b64url(s)));

async function verify(token, project){
  const [h, p, s] = String(token || "").split(".");
  if(!s) throw new Error("no token");
  const head = dec(h), body = dec(p), now = Date.now() / 1000;
  if(head.alg !== "RS256") throw new Error("alg");
  if(body.aud !== project || body.iss !== "https://securetoken.google.com/" + project) throw new Error("project");
  if(!body.sub || body.exp < now || body.iat > now + 300) throw new Error("expired");
  if(!keys || Date.now() - keysAt > 3600e3){ keys = (await (await fetch(JWKS)).json()).keys; keysAt = Date.now(); }
  const jwk = keys.find(k => k.kid === head.kid);
  if(!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(h + "." + p));
  if(!ok) throw new Error("signature");
  return body.sub;
}

// Is this person in at least one cellar the owner owns? Asked to Firestore with the person's own token.
async function isMember(uid, token, env){
  if(uid === env.OWNER_UID) return true;
  const c = members.get(uid);
  if(c && Date.now() - c.at < 600e3) return c.ok;
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {method: "POST", headers: {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    body: JSON.stringify({structuredQuery: {from: [{collectionId: "cellars"}],
      where: {fieldFilter: {field: {fieldPath: "memberIds"}, op: "ARRAY_CONTAINS", value: {stringValue: uid}}}, limit: 50}})});
  if(!res.ok) return false;
  const rows = await res.json();
  const ok = rows.some(r => r.document?.fields?.owner?.stringValue === env.OWNER_UID);
  members.set(uid, {ok, at: Date.now()});
  return ok;
}

function cors(req){
  const o = req.headers.get("Origin") || "";
  return {"Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin"};
}
const reply = (req, status, obj) => new Response(JSON.stringify(obj), {status, headers: {...cors(req), "Content-Type": "application/json"}});

export default {
  async fetch(req, env){
    if(req.method === "OPTIONS") return new Response(null, {status: 204, headers: cors(req)});
    if(req.method !== "POST") return reply(req, 200, {ok: true, service: "meerstraat-wines ai"});
    if(!env.ANTHROPIC_API_KEY || !env.OWNER_UID || !env.FIREBASE_PROJECT) return reply(req, 500, {error: {code: "not_configured"}});

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let uid;
    try{ uid = await verify(token, env.FIREBASE_PROJECT); }catch{ return reply(req, 401, {error: {code: "not_signed_in"}}); }
    if(!(await isMember(uid, token, env))) return reply(req, 403, {error: {code: "not_member"}});

    const day = new Date().toISOString().slice(0, 10), ck = uid + "|" + day, n = (counts.get(ck) || 0) + 1;
    if(n > (parseInt(env.DAILY_LIMIT) || 150)) return reply(req, 429, {error: {code: "daily_limit"}});
    counts.set(ck, n);
    if(counts.size > 5000) counts.clear();

    let inb; try{ inb = await req.json(); }catch{ return reply(req, 400, {error: {code: "bad_request"}}); }
    // Only what the app needs is passed on; the model and limits are decided here.
    const model = MODELS[inb.tier === "quick" ? "quick" : "default"];
    const body = {model, max_tokens: Math.min(parseInt(inb.max_tokens) || 8000, 16000), messages: inb.messages, stream: !!inb.stream,
      output_config: {effort: inb.tier === "quick" ? "low" : "medium"}};
    if(typeof inb.system === "string") body.system = inb.system;
    const headers = {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"};
    if(model === MODELS.default){ body.fallbacks = "default"; headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; }

    const res = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers, body: JSON.stringify(body)});
    return new Response(res.body, {status: res.status, headers: {...cors(req), "Content-Type": res.headers.get("Content-Type") || "application/json"}});
  }
};
