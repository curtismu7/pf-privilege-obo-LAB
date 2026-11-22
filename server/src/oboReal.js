// oboReal.js: the lab's Real mode for on-behalf-of. One live run of a chain, as numbered frames.
//
//   sign in as a person (PingFederate pi.flow) -> RFC 8693 exchange as the agent -> call a Privilege door
//   shape "agent":   the agent's token goes to a Pass Agent Token door; Privilege checks it and lists tools.
//   shape "gateway": the agent's token goes to an Auth Mode OBO door; the gateway makes its own exchange and the
//                    backend's whoami reports what it received.
//
// Rules this file keeps (rule 19, and the lab's honesty rule):
// - Settings come from this lab's own .env (or the environment). Nothing about a tenant is in the repo.
// - A client secret and the person's password are never returned, logged or put in an error (write-only).
//   Tokens ARE shown in full: this is a demo and the family shows tokens raw for education (owner, 2026-11-22).
// - Redirects are never followed. Every call has a timeout and a size cap.
// - What Privilege checked is not reported as if the gateway said it: a real gateway returns no per-check detail,
//   so the door frame says "accepted" or "refused" and the checks are labelled inferred.
// No dependencies. ESM. Node >= 22.
import { createHash, randomBytes } from "node:crypto";
import { sseMessages } from "./gatewayReal.js";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 256 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const FLOW_ID = /^[A-Za-z0-9_-]{6,64}$/;
const TARGET_PARAMS = new Set(["audience", "resource"]);
export const MADE_UP_TOKEN = "not-a-valid-token";

export const NOT_CONFIGURED = "Real is not configured. In this lab's .env set PFO_USER_NAME, PFO_USER_PASSWORD, PFO_OBO_ISSUER, PFO_OBO_SIGNIN_CLIENT, PFO_OBO_REDIRECT_URI, PFO_OBO_AGENT_CLIENT, PFO_OBO_AGENT_SECRET and at least one of PFO_OBO_AGENT_DOOR or PFO_OBO_GATEWAY_DOOR. Mock keeps working.";

// ---- settings --------------------------------------------------------------------------------------------------

export function parseSettings(text, env = {}) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^\s*(PFO_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  for (const [k, v] of Object.entries(env)) if (k.startsWith("PFO_") && typeof v === "string" && v) out[k] = v;
  return out;
}

function urlOf(value, what, problems) {
  if (!value) { problems.push(`${what} is not set`); return null; }
  let u;
  try { u = new URL(value); } catch { problems.push(`${what} is not a URL`); return null; }
  if (!(u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname)))) { problems.push(`${what} must be https (http only on loopback)`); return null; }
  if (u.username || u.password || u.hash) { problems.push(`${what} must not carry credentials or a fragment`); return null; }
  return u;
}

const clean = (s) => typeof s === "string" && s.length >= 1 && !/[\s\u0000-\u001f]/.test(s);

function doorOf(s, prefix, defaults, problems) {
  const raw = s[`PFO_OBO_${prefix}_DOOR`];
  if (!raw) return null;
  const u = urlOf(raw, `PFO_OBO_${prefix}_DOOR`, problems);
  if (!u) return null;
  if (!u.pathname.endsWith("/mcp")) { problems.push(`PFO_OBO_${prefix}_DOOR must end in /mcp`); return null; }
  const target = (s[`PFO_OBO_${prefix}_TARGET`] || defaults.target).toLowerCase();
  if (!TARGET_PARAMS.has(target)) { problems.push(`PFO_OBO_${prefix}_TARGET must be audience or resource`); return null; }
  const scope = s[`PFO_OBO_${prefix}_SCOPE`] || defaults.scope;
  if (!/^[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(scope)) { problems.push(`PFO_OBO_${prefix}_SCOPE is not a scope list`); return null; }
  return { url: u.href, origin: u.origin, target, scope, tool: /^[A-Za-z0-9_-]{1,64}$/.test(s.PFO_OBO_GATEWAY_TOOL || "") ? s.PFO_OBO_GATEWAY_TOOL : "whoami" };
}

// -> { ok:true, ... } | { ok:false, problem }
export function oboConfig(text, env = {}) {
  const s = parseSettings(text, env);
  const problems = [];
  const issuer = urlOf(s.PFO_OBO_ISSUER, "PFO_OBO_ISSUER", problems);
  const redirect = urlOf(s.PFO_OBO_REDIRECT_URI, "PFO_OBO_REDIRECT_URI", problems);
  if (!/^[^\u0000-\u001f]{1,200}$/.test(s.PFO_USER_NAME || "")) problems.push("PFO_USER_NAME is not set");
  if (!/^[^\u0000-\u001f]{1,200}$/.test(s.PFO_USER_PASSWORD || "")) problems.push("PFO_USER_PASSWORD is not set");
  if (!ID.test(s.PFO_OBO_SIGNIN_CLIENT || "")) problems.push("PFO_OBO_SIGNIN_CLIENT is not set");
  if (!ID.test(s.PFO_OBO_AGENT_CLIENT || "")) problems.push("PFO_OBO_AGENT_CLIENT is not set");
  if (!clean(s.PFO_OBO_AGENT_SECRET)) problems.push("PFO_OBO_AGENT_SECRET is not set");
  const signinAuth = (s.PFO_OBO_SIGNIN_AUTH || (s.PFO_OBO_SIGNIN_SECRET ? "basic" : "none")).toLowerCase();
  if (!["basic", "post", "none"].includes(signinAuth)) problems.push("PFO_OBO_SIGNIN_AUTH must be basic, post or none");
  if (signinAuth !== "none" && !clean(s.PFO_OBO_SIGNIN_SECRET)) problems.push("PFO_OBO_SIGNIN_SECRET is not set");
  const agent = doorOf(s, "AGENT", { target: "audience", scope: "mcp opensearch:read" }, problems);
  const gateway = doorOf(s, "GATEWAY", { target: "resource", scope: "mcp whoami:read" }, problems);
  if (!agent && !gateway) problems.push("set PFO_OBO_AGENT_DOOR or PFO_OBO_GATEWAY_DOOR");
  if (problems.length) return { ok: false, problem: `${NOT_CONFIGURED} (${problems.join("; ")})` };
  const origins = [...new Set([issuer.origin, ...[agent, gateway].filter(Boolean).map((d) => d.origin)])];
  return {
    ok: true, issuer: issuer.origin, origins,
    user: { name: s.PFO_USER_NAME, password: s.PFO_USER_PASSWORD },
    signin: { client: s.PFO_OBO_SIGNIN_CLIENT, secret: s.PFO_OBO_SIGNIN_SECRET || "", auth: signinAuth, redirect: redirect.href },
    agentClient: { id: s.PFO_OBO_AGENT_CLIENT, secret: s.PFO_OBO_AGENT_SECRET },
    doors: { agent, gateway },
  };
}

// What the page may know: never a secret, never the password.
export function publicView(cfg) {
  if (!cfg?.ok) return { configured: false, reason: cfg?.problem || NOT_CONFIGURED, shapes: { agent: false, gateway: false } };
  return {
    configured: true,
    shapes: { agent: Boolean(cfg.doors.agent), gateway: Boolean(cfg.doors.gateway) },
    user: cfg.user.name,
    issuerHost: new URL(cfg.issuer).host,
    doors: {
      agent: cfg.doors.agent ? { host: new URL(cfg.doors.agent.url).host, target: cfg.doors.agent.target, scope: cfg.doors.agent.scope } : null,
      gateway: cfg.doors.gateway ? { host: new URL(cfg.doors.gateway.url).host, target: cfg.doors.gateway.target, scope: cfg.doors.gateway.scope } : null,
    },
  };
}

// ---- helpers ---------------------------------------------------------------------------------------------------

const sha8 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);
export function decodeClaims(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8")); } catch { return null; }
}
const tokenInfo = (jwt) => {
  const claims = decodeClaims(jwt);
  return { raw: String(jwt), hash: sha8(jwt), length: String(jwt).length, claims, lifetimeSec: claims && Number.isFinite(claims.exp) && Number.isFinite(claims.iat) ? claims.exp - claims.iat : null };
};

function scrubber(cfg, extra = []) {
  const secrets = [cfg.user.password, cfg.agentClient.secret, cfg.signin.secret, ...extra].filter((x) => x && x.length >= 4);
  return (text) => { let out = String(text ?? ""); for (const sec of secrets) out = out.split(sec).join("<redacted>"); return out; };
}

async function http(url, { method = "GET", headers = {}, body, signal } = {}) {
  const res = await fetch(url, { method, headers, body, redirect: "manual", signal: signal || AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status >= 300 && res.status < 400) { res.body?.cancel().catch(() => {}); return { status: res.status, headers: res.headers, text: "", redirected: true }; }
  const reader = res.body?.getReader();
  let text = "";
  if (reader) {
    const dec = new TextDecoder();
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        text += dec.decode(value, { stream: true });
        if (bytes > MAX_BYTES) break;
        if (/text\/event-stream/i.test(res.headers.get("content-type") || "") && sseMessages(text).length) break;
      }
    } finally { reader.cancel().catch(() => {}); }
  }
  return { status: res.status, headers: res.headers, text };
}

const form = (o) => new URLSearchParams(o).toString();
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

// PingFederate's authentication API: the person signs in with no redirect (pi.flow). -> { idToken } or throws.
async function signIn(cfg) {
  const base = cfg.issuer;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const a = await http(`${base}/as/authorization.oauth2?${form({ client_id: cfg.signin.client, response_type: "code", response_mode: "pi.flow", scope: "openid profile", redirect_uri: cfg.signin.redirect, code_challenge: challenge, code_challenge_method: "S256" })}`);
  let flow;
  try { flow = JSON.parse(a.text); } catch { flow = {}; }
  if (!FLOW_ID.test(flow.id || "")) throw new Error(`sign-in did not start (HTTP ${a.status}${flow.code ? `, ${String(flow.code).slice(0, 60)}` : ""})`);
  const cookie = (a.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const s = await http(`${base}/pf-ws/authn/flows/${flow.id}`, {
    method: "POST",
    headers: { "content-type": "application/vnd.pingidentity.checkUsernamePassword+json", "X-XSRF-Header": "PingFederate", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ username: cfg.user.name, password: cfg.user.password }),
  });
  let signed;
  try { signed = JSON.parse(s.text); } catch { signed = {}; }
  const code = signed.authorizeResponse?.code;
  if (!code) throw new Error(`sign-in was not completed (HTTP ${s.status}, ${String(signed.status || signed.code || "no status").slice(0, 60)})`);
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  const params = { grant_type: "authorization_code", code, redirect_uri: cfg.signin.redirect, code_verifier: verifier };
  if (cfg.signin.auth === "basic") headers.authorization = basic(cfg.signin.client, cfg.signin.secret);
  else { params.client_id = cfg.signin.client; if (cfg.signin.auth === "post") params.client_secret = cfg.signin.secret; }
  const t = await http(`${base}/as/token.oauth2`, { method: "POST", headers, body: form(params) });
  let tok;
  try { tok = JSON.parse(t.text); } catch { tok = {}; }
  if (!tok.id_token) throw new Error(`no ID token (HTTP ${t.status}, ${String(tok.error_description || tok.error || "no reason").slice(0, 120)})`);
  return { idToken: tok.id_token };
}

async function exchange(cfg, idToken, door) {
  const params = {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    [door.target]: door.url,
    scope: door.scope,
  };
  const r = await http(`${cfg.issuer}/as/token.oauth2`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic(cfg.agentClient.id, cfg.agentClient.secret) }, body: form(params),
  });
  let j;
  try { j = JSON.parse(r.text); } catch { j = {}; }
  return { status: r.status, accessToken: j.access_token || null, error: j.error_description || j.error || null, params };
}

async function rpc(url, token, method, params) {
  const r = await http(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  let json = null;
  if (/text\/event-stream/i.test(r.headers.get("content-type") || "")) json = sseMessages(r.text).find((m) => m && m.id === 1) ?? null;
  else { try { json = JSON.parse(r.text); } catch { json = null; } }
  return { status: r.status, headers: r.headers, text: r.text, json };
}

function challengeOf(headers) {
  const raw = headers.get("www-authenticate") || "";
  const out = {};
  for (const m of raw.matchAll(/([a-z_]+)="([^"]*)"/gi)) out[m[1]] = m[2];
  return { present: Boolean(raw), scheme: raw.split(/[ ,]/)[0] || null, params: out };
}

// ---- the run ---------------------------------------------------------------------------------------------------

// Spec notes shown beside a frame: only specs the script's Sources table lists as read. Paraphrased, never quoted at length.
const SPEC = {
  exchange: [
    { ref: "RFC 8693 §2.1", note: "The request names the token that proves the person (subject_token and its type, both required). resource and audience are optional ways to say where the new token will be used. An actor_token is optional; none is sent here." },
  ],
  token: [
    { ref: "RFC 8693 §4.1", note: "act is a JSON object naming the current actor; a nested act is a prior actor." },
    { ref: "RFC 7519 §4.1.3", note: "When aud is present, whoever processes the token must identify itself with a value in it, or reject the token." },
  ],
  refused: [
    { ref: "RFC 9110 §15.5.2", note: "A 401 means no valid credentials for the target, and the response must carry a WWW-Authenticate challenge." },
    { ref: "RFC 9728 §5.1", note: "resource_metadata in that challenge is the URL of the protected resource's metadata." },
  ],
  actor: [{ ref: "RFC 8693 §4.1", note: "A consumer looks at the top-level claims and the current actor; earlier actors in a nested act are informational." }],
};

export async function runReal(cfg, { shape, refusal = false } = {}) {
  if (!cfg?.ok) throw Object.assign(new Error(cfg?.problem || NOT_CONFIGURED), { status: 409 });
  if (!["agent", "gateway"].includes(shape)) throw Object.assign(new Error("shape must be agent or gateway"), { status: 400 });
  const door = cfg.doors[shape];
  if (!door) throw Object.assign(new Error(`the ${shape} door is not configured (PFO_OBO_${shape.toUpperCase()}_DOOR)`), { status: 409 });
  const scrub = scrubber(cfg);
  const frames = [];
  const started = Date.now();
  let failed = false;

  const add = (f) => { frames.push({ n: frames.length + 1, ...f }); };
  const timed = async (id, title, fn) => {
    if (failed) { add({ id, title, state: "skipped", summary: "Skipped: an earlier step did not complete." }); return null; }
    const t0 = Date.now();
    try {
      const f = await fn();
      add({ id, title, ms: Date.now() - t0, ...f });
      if (f.state === "error") failed = true;
      return f;
    } catch (err) {
      failed = true;
      add({ id, title, ms: Date.now() - t0, state: "error", summary: scrub(err?.message || "failed").slice(0, 300) });
      return null;
    }
  };

  let idToken = null;
  await timed("signin", "Sign in as the person", async () => {
    const si = await signIn(cfg);
    idToken = si.idToken;
    const info = tokenInfo(idToken);
    return {
      state: "ok",
      summary: `Signed in. The ID token's subject is ${info.claims?.sub ?? "?"}, valid ${info.lifetimeSec ?? "?"} s.`,
      request: { method: "POST", url: `${new URL(cfg.issuer).host}/as/authorization.oauth2 → /pf-ws/authn/flows → /as/token.oauth2`, params: [
        { name: "client_id", value: cfg.signin.client }, { name: "response_mode", value: "pi.flow" }, { name: "username", value: cfg.user.name }, { name: "password", value: "<not shown>" },
      ] },
      response: { status: 200 }, token: { kind: "ID token", ...info }, spec: [],
    };
  });

  let access = null;
  await timed("exchange", "Exchange for an access token (RFC 8693)", async () => {
    const x = await exchange(cfg, idToken, door);
    const request = {
      method: "POST", url: `${new URL(cfg.issuer).host}/as/token.oauth2`,
      params: [
        { name: "client authentication", value: `client_secret_basic as ${cfg.agentClient.id}` },
        ...Object.entries(x.params).map(([name, value]) => ({ name, value: value })),
        { name: "actor_token", value: "not sent" },
      ],
    };
    if (!x.accessToken) return { state: "error", summary: `PingFederate refused the exchange (HTTP ${x.status}): ${scrub(x.error || "no reason").slice(0, 200)}`, request, response: { status: x.status }, spec: SPEC.exchange };
    access = x.accessToken;
    const info = tokenInfo(access);
    return { state: "ok", summary: `Access token issued. sub ${info.claims?.sub ?? "?"}, act ${JSON.stringify(info.claims?.act ?? null)}, aud ${JSON.stringify(info.claims?.aud ?? null)}.`, request, response: { status: x.status }, token: { kind: "access token", ...info }, spec: [...SPEC.exchange, ...SPEC.token] };
  });

  await timed("door", shape === "agent" ? "Call the door with that token" : "Call the gateway door with that token", async () => {
    const r = await rpc(door.url, access, "tools/list", {});
    const tools = Array.isArray(r.json?.result?.tools) ? r.json.result.tools.slice(0, 40).map((t) => String(t?.name ?? "").slice(0, 120)) : [];
    const request = { method: "POST", url: new URL(door.url).host + new URL(door.url).pathname, params: [{ name: "Authorization", value: `Bearer ${access}` }, { name: "jsonrpc method", value: "tools/list" }] };
    if (r.status !== 200) return { state: "refused", summary: `The door answered ${r.status}.`, request, response: { status: r.status, challenge: challengeOf(r.headers) }, spec: SPEC.refused };
    return {
      state: "ok", summary: `Accepted: HTTP 200 with ${tools.length} tool${tools.length === 1 ? "" : "s"}.`, request,
      response: { status: 200, tools },
      inferred: "Privilege is configured to check the issuer, the audience, the required actor claim and the lifetime, then the key's grant. A real gateway reports no per-check detail, so these checks are inferred from the accepted call.",
      spec: [],
    };
  });

  if (shape === "gateway") {
    await timed("whoami", `Ask the backend who it saw (${door.tool})`, async () => {
      const r = await rpc(door.url, access, "tools/call", { name: door.tool, arguments: {} });
      const request = { method: "POST", url: new URL(door.url).host + new URL(door.url).pathname, params: [{ name: "Authorization", value: `Bearer ${access}` }, { name: "jsonrpc method", value: "tools/call" }, { name: "tool", value: door.tool }] };
      if (r.status !== 200) return { state: "refused", summary: `The gateway answered ${r.status}.`, request, response: { status: r.status, body: scrub(r.text).slice(0, 200) }, spec: [] };
      const text = (r.json?.result?.content || []).map((c) => (c?.type === "text" ? c.text : "")).join("\n");
      let seen = null;
      try { seen = JSON.parse(text); } catch { seen = null; }
      if (!seen) return { state: "error", summary: "The tool replied but not with the claims the backend saw.", request, response: { status: 200 }, spec: [] };
      const backend = { verifiedBy: seen.verifiedBy ?? null, issuer: seen.issuer ?? null, subject: seen.subject ?? null, audience: seen.audience ?? null, clientId: seen.clientId ?? null, scope: seen.scope ?? null, actor: seen.actor ?? null };
      return { state: "ok", summary: `The backend verified the token itself. Subject ${backend.subject}, audience ${backend.audience}, actor ${JSON.stringify(backend.actor)}.`, request, response: { status: 200 }, backend, spec: SPEC.actor };
    });
  }

  if (refusal) {
    await timed("refused", "Try the same call with a made-up token", async () => {
      const r = await rpc(door.url, MADE_UP_TOKEN, "tools/list", {});
      const request = { method: "POST", url: new URL(door.url).host + new URL(door.url).pathname, params: [{ name: "Authorization", value: `Bearer ${MADE_UP_TOKEN}` }, { name: "jsonrpc method", value: "tools/list" }] };
      const challenge = challengeOf(r.headers);
      let body = null;
      try { body = JSON.parse(r.text); } catch { body = null; }
      const refused = r.status === 401 || r.status === 403;
      return {
        state: refused ? "refused" : "error",
        summary: refused ? `Refused: HTTP ${r.status}${challenge.present ? " with a WWW-Authenticate challenge" : " (no challenge header)"}.` : `Expected a refusal but the door answered ${r.status}.`,
        request, response: { status: r.status, challenge, error: body ? { error: body.error ?? null, error_description: body.error_description ?? null } : null }, spec: SPEC.refused,
      };
    });
  }

  const ok = frames.every((f) => f.state === "ok" || (f.id === "refused" && f.state === "refused"));
  return { shape, at: new Date().toISOString(), ok, ms: Date.now() - started, frames, user: cfg.user.name };
}
