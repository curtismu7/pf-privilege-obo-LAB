// Real OBO run, against an in-process stand-in for PingFederate and the two doors (loopback only: nothing leaves the machine).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oboConfig, publicView, runReal, parseSettings, MADE_UP_TOKEN } from "../server/src/oboReal.js";
import { stop, startVerified } from "./test-helpers.js";
import { buildServer } from "../server/src/index.js";
import { assertRunObservability } from "../server/src/runObservability.js";
import { ElasticsearchReader } from "../server/src/runObservabilityReaders.js";

const PASSWORD = "stub-user-password-1";
const AGENT_SECRET = "stub-agent-secret-2";
const SIGNIN_SECRET = "stub-signin-secret-3";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "none" })}.${b64(payload)}.sig`;
const basicOf = (id, s) => `Basic ${Buffer.from(`${id}:${s}`).toString("base64")}`;

let stub; let base; const minted = new Set(); let lastExchange = null; let challenge = null;
const hits = {}; let lastSignInAuth = null;
const knob = { flowDelayMs: 0, exchangeEcho: false, exchangeFail: false, exchangeCode: null, exchangeStatus: 400, doorMode: "ok", delayMs: 0, refusalEcho: false };
const resetKnobs = () => { Object.assign(knob, { flowDelayMs: 0, exchangeEcho: false, exchangeFail: false, exchangeCode: null, exchangeStatus: 400, doorMode: "ok", delayMs: 0, refusalEcho: false }); };

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((resolve) => { let t = ""; req.on("data", (c) => { t += c; }); req.on("end", () => resolve(t)); });

before(async () => {
  stub = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readBody(req);
    hits[url.pathname] = (hits[url.pathname] || 0) + 1;
    if (knob.delayMs && url.pathname === "/as/token.oauth2") await new Promise((r) => setTimeout(r, knob.delayMs));
    if (url.pathname === "/as/authorization.oauth2") { challenge = url.searchParams.get("code_challenge"); return reply(res, 200, { id: "flow-abc-123", status: "USERNAME_PASSWORD_REQUIRED" }, { "set-cookie": "ST=1; Path=/" }); }
    if (knob.flowDelayMs && url.pathname.startsWith("/pf-ws/authn/flows/")) await new Promise((r) => setTimeout(r, knob.flowDelayMs));
    if (url.pathname === "/pf-ws/authn/flows/flow-abc-123") {
      if (req.headers["x-xsrf-header"] !== "PingFederate") return reply(res, 400, { code: "INVALID_REQUEST" });
      const b = JSON.parse(body);
      if (b.password !== PASSWORD) return reply(res, 400, { code: "VALIDATION_ERROR", message: `bad password ${b.password}` });
      return reply(res, 200, { status: "COMPLETED", authorizeResponse: { code: "code-1" } });
    }
    if (url.pathname === "/as/token.oauth2") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        lastSignInAuth = req.headers.authorization ? "basic" : p.get("client_secret") ? "post" : "none";
        if (req.headers.authorization && req.headers.authorization !== basicOf("signin-client", SIGNIN_SECRET)) return reply(res, 401, { error: "invalid_client" });
        if (p.get("client_secret") && p.get("client_secret") !== SIGNIN_SECRET) return reply(res, 401, { error: "invalid_client" });
        if (createHash("sha256").update(p.get("code_verifier")).digest("base64url") !== challenge) return reply(res, 400, { error: "invalid_grant" });
        const now = Math.floor(Date.now() / 1000);
        return reply(res, 200, { id_token: jwt({ iss: base, sub: "stub-user", aud: "signin-client", iat: now, exp: now + 300 }) });
      }
      if (req.headers.authorization !== basicOf("agent-client", AGENT_SECRET)) return reply(res, 401, { error: "invalid_client" });
      if (knob.exchangeCode) return reply(res, knob.exchangeStatus, { error: knob.exchangeCode });
      if (knob.exchangeEcho) return reply(res, 400, { error: "invalid_request", error_description: `the secret was ${AGENT_SECRET} and the password ${PASSWORD}` });
      if (knob.exchangeFail) return reply(res, 400, { error: "invalid_target", error_description: "audience value is invalid" });
      lastExchange = Object.fromEntries(p);
      const target = p.get("audience") || p.get("resource");
      const now = Math.floor(Date.now() / 1000);
      const t = jwt({ iss: base, sub: "stub-user", aud: target, client_id: "agent-client", act: { sub: "agent-client" }, scope: p.get("scope"), iat: now, exp: now + 3600 });
      minted.add(t);
      return reply(res, 200, { access_token: t, token_type: "Bearer" });
    }
    if (url.pathname === "/redirect/mcp") return reply(res, 302, "", { location: `${base}/agent/mcp` });
    if (url.pathname === "/agent/mcp" || url.pathname === "/gw/mcp") {
      const bearer = String(req.headers.authorization || "").replace(/^Bearer /, "");
      if (knob.doorMode === "refuse-real" && minted.has(bearer)) return reply(res, 403, { error: "forbidden" }, { "www-authenticate": 'Bearer realm="stub"' });
      if (knob.doorMode === "500" && minted.has(bearer)) return reply(res, 500, { error: "boom" });
      if (knob.doorMode === "rpc-error" && minted.has(bearer)) return reply(res, 200, { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "tool listing failed" } });
      if (knob.doorMode === "html" && minted.has(bearer)) return reply(res, 200, "<html>login</html>", { "content-type": "text/html" });
      if (!minted.has(bearer)) return reply(res, 401, { error: "unauthorized", error_description: knob.refusalEcho ? `Bearer token required (saw ${PASSWORD})` : "Bearer token required" }, { "www-authenticate": `Bearer realm="stub", resource_metadata="${base}/.well-known/oauth-protected-resource${url.pathname}"` });
      const rpc = JSON.parse(body);
      if (knob.doorMode === "sse") {
        const msg = rpc.method === "tools/list" ? { jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "OnlyTool" }] } } : { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ verifiedBy: "stub-backend", subject: "stub-user", audience: "backend-aud", actor: { sub: "gateway-client" } }) }] } };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } })}\n\n`);
        // The notification is flushed alone; the reply follows in a later chunk. Ending the read at the first message would lose it.
        return setTimeout(() => res.end(`data: ${JSON.stringify(msg)}\n\n`), 80);
      }
      if (knob.doorMode === "whoami-true" && rpc.method === "tools/call") return reply(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "true" }] } });
      if (rpc.method === "tools/list") return reply(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { tools: url.pathname === "/agent/mcp" ? [{ name: "ListTool" }, { name: "SearchTool" }, { name: "CountTool" }] : [{ name: "whoami" }] } });
      if (rpc.method === "tools/call") {
        const seen = { verifiedBy: "stub-backend", issuer: base, subject: "stub-user", audience: "backend-aud", clientId: "agent-client", scope: "mcp whoami:read", actor: { sub: "gateway-client", act: { sub: "agent-client" } }, claims: { secret_looking: "must-not-be-copied" } };
        return reply(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(seen) }] } });
      }
    }
    return reply(res, 404, {});
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${stub.address().port}`;
});
after(() => stop(stub));
beforeEach(() => resetKnobs());

const settings = () => `PFO_USER_NAME=stub-user
PFO_USER_PASSWORD=${PASSWORD}
PFO_OBO_ISSUER=${base}
PFO_OBO_SIGNIN_CLIENT=signin-client
PFO_OBO_SIGNIN_SECRET=${SIGNIN_SECRET}
PFO_OBO_REDIRECT_URI=http://127.0.0.1:1/callback
PFO_OBO_AGENT_CLIENT=agent-client
PFO_OBO_AGENT_SECRET=${AGENT_SECRET}
PFO_OBO_AGENT_DOOR=${base}/agent/mcp
PFO_OBO_GATEWAY_DOOR=${base}/gw/mcp
`;
const cfg = () => oboConfig(settings());
// Tokens are shown in full (demo); the password and the client secrets are write-only and never appear.
const noSecrets = (run) => {
  const text = JSON.stringify(run);
  for (const s of [PASSWORD, AGENT_SECRET, SIGNIN_SECRET]) assert.ok(!text.includes(s), "a secret leaked into the run");
};

test("settings: not configured says what to set; a complete file is ok", () => {
  const empty = oboConfig("");
  assert.equal(empty.ok, false);
  assert.match(empty.problem, /PFO_OBO_ISSUER/);
  assert.equal(cfg().ok, true);
  assert.deepEqual(publicView(cfg()).shapes, { agent: true, gateway: true });
});

test("settings: refuses a non-loopback http issuer, a door that does not end in /mcp, and a bad target", () => {
  assert.match(oboConfig(settings().replace(base, "http://pf.example")).problem, /https/);
  assert.match(oboConfig(settings().replace("/agent/mcp", "/agent/mc")).problem, /must end in \/mcp/);
  assert.match(oboConfig(settings() + "PFO_OBO_AGENT_TARGET=nonsense\n").problem, /audience or resource/);
});

test("settings: the environment overrides the file, and unrelated keys are ignored", () => {
  const s = parseSettings("PFO_USER_NAME=a\nOTHER=1\n", { PFO_USER_NAME: "b", NOTPFO: "x" });
  assert.deepEqual(s, { PFO_USER_NAME: "b" });
});

test("the page's view of the config carries no secret", () => {
  const v = JSON.stringify(publicView(cfg()));
  for (const s of [PASSWORD, AGENT_SECRET, SIGNIN_SECRET]) assert.ok(!v.includes(s));
});

test("agent-side run: sign in, exchange with audience, door lists tools, a made-up token is refused", async () => {
  const run = await runReal(cfg(), { shape: "agent", refusal: true });
  assert.equal(run.ok, true);
  assert.deepEqual(run.frames.map((f) => f.id), ["signin", "exchange", "door", "refused"]);
  assert.deepEqual(run.frames.map((f) => f.state), ["ok", "ok", "ok", "refused"]);
  assert.ok(lastExchange.audience && !lastExchange.resource, "the agent door is asked with audience");
  assert.equal(lastExchange.subject_token_type, "urn:ietf:params:oauth:token-type:id_token");
  assert.equal(lastExchange.actor_token, undefined);
  const ex = run.frames[1];
  assert.equal(ex.token.claims.sub, "stub-user");
  assert.deepEqual(ex.token.claims.act, { sub: "agent-client" });
  assert.equal(ex.token.lifetimeSec, 3600);
  assert.deepEqual(run.frames[2].response.tools, ["ListTool", "SearchTool", "CountTool"]);
  assert.match(run.frames[2].inferred, /inferred/);
  const ref = run.frames[3].response;
  assert.equal(ref.status, 401);
  assert.equal(ref.challenge.present, true);
  assert.match(ref.challenge.params.resource_metadata, /oauth-protected-resource/);
  noSecrets(run);
});

test("the exchange frame shows the request as sent, tokens in full, secrets never", async () => {
  const run = await runReal(cfg(), { shape: "agent" });
  const params = Object.fromEntries(run.frames[1].request.params.map((p) => [p.name, p.value]));
  assert.equal(params.subject_token, run.frames[0].token.raw, "the exchange shows the very ID token the sign-in returned");
  assert.equal(params.actor_token, "not sent");
  assert.match(params["client authentication"], /client_secret_basic as agent-client/);
  assert.equal(run.frames.find((f) => f.id === "signin").request.params.find((p) => p.name === "password").value, "<not shown>");
});

test("gateway run: exchange with resource, door, whoami shows the backend's actor chain", async () => {
  const run = await runReal(cfg(), { shape: "gateway", refusal: true });
  assert.equal(run.ok, true);
  assert.deepEqual(run.frames.map((f) => f.id), ["signin", "exchange", "door", "whoami", "refused"]);
  assert.ok(lastExchange.resource && !lastExchange.audience, "the gateway door is asked with resource");
  const w = run.frames[3];
  assert.equal(w.state, "ok");
  assert.deepEqual(w.backend.actor, { sub: "gateway-client", act: { sub: "agent-client" } });
  assert.equal(w.backend.subject, "stub-user");
  assert.equal(w.backend.claims, undefined, "only the named fields are copied");
  noSecrets(run);
});

test("a wrong password stops the run, skips the rest and never echoes the password", async () => {
  const bad = oboConfig(settings().replace(PASSWORD, "wrong-password-9"));
  const run = await runReal(bad, { shape: "agent", refusal: true });
  assert.equal(run.ok, false);
  assert.equal(run.frames[0].state, "error");
  assert.deepEqual(run.frames.slice(1).map((f) => f.state), ["skipped", "skipped", "skipped"]);
  assert.ok(!JSON.stringify(run).includes("wrong-password-9"));
});

test("a shape whose door is not configured is refused 409; an unknown shape 400", async () => {
  const onlyAgent = oboConfig(settings().replace(/PFO_OBO_GATEWAY_DOOR=.*\n/, ""));
  await assert.rejects(runReal(onlyAgent, { shape: "gateway" }), (e) => e.status === 409);
  await assert.rejects(runReal(cfg(), { shape: "other" }), (e) => e.status === 400);
  await assert.rejects(runReal(oboConfig(""), { shape: "agent" }), (e) => e.status === 409);
});

test("tokens are shown in full: the frame carries the raw token and the door call shows the bearer it sent", async () => {
  const run = await runReal(cfg(), { shape: "agent", refusal: true });
  const access = run.frames[1].token.raw;
  assert.ok(minted.has(access), "the shown token is the one PingFederate issued");
  assert.equal(run.frames[2].request.params.find((p) => p.name === "Authorization").value, `Bearer ${access}`);
  assert.equal(run.frames[3].request.params.find((p) => p.name === "Authorization").value, `Bearer ${MADE_UP_TOKEN}`);
  assert.equal(run.frames[0].token.claims.sub, "stub-user");
});

test("the password and the client secret echoed back by PingFederate never reach the run", async () => {
  knob.exchangeEcho = true;
  const run = await runReal(cfg(), { shape: "agent" });
  assert.equal(run.frames[1].state, "error");
  assert.match(run.frames[1].summary, /<redacted>/);
  assert.deepEqual(run.frames.slice(2).map((f) => f.state), ["skipped"]);
  noSecrets(run);
});

test("a secret echoed by the door's own refusal body is redacted too (the final scrub, not only the per-field one)", async () => {
  knob.refusalEcho = true;
  const run = await runReal(cfg(), { shape: "agent", refusal: true });
  const refusal = run.frames.at(-1);
  assert.equal(refusal.state, "refused");
  assert.match(refusal.response.error.error_description, /<redacted>/);
  noSecrets(run);
});

test("a refused exchange stops the run with PingFederate's reason and skips the door", async () => {
  knob.exchangeFail = true;
  const run = await runReal(cfg(), { shape: "gateway", refusal: true });
  assert.equal(run.ok, false);
  assert.deepEqual(run.frames.map((f) => f.state), ["ok", "error", "skipped", "skipped", "skipped"]);
  assert.match(run.frames[1].summary, /audience value is invalid/);
});

test("a door that refuses the real token is shown refused, stops the run and the backend is not asked", async () => {
  knob.doorMode = "refuse-real";
  const before = hits["/gw/mcp"] || 0;
  const run = await runReal(cfg(), { shape: "gateway", refusal: true });
  assert.equal(run.frames[2].state, "refused");
  assert.equal(run.frames[2].response.status, 403);
  assert.deepEqual(run.frames.slice(3).map((f) => f.state), ["skipped", "skipped"]);
  assert.equal(run.ok, false);
  assert.equal((hits["/gw/mcp"] || 0) - before, 1, "only the one refused tools/list reached the door");
});

test("a 500 from the door is an error, not an authorization refusal", async () => {
  knob.doorMode = "500";
  const run = await runReal(cfg(), { shape: "agent" });
  assert.equal(run.frames[2].state, "error");
  assert.match(run.frames[2].summary, /not an authorization decision/);
});

test("HTTP 200 that is not a tools list is not 'accepted' (JSON-RPC error, HTML page)", async () => {
  for (const mode of ["rpc-error", "html"]) {
    knob.doorMode = mode;
    const run = await runReal(cfg(), { shape: "agent" });
    assert.equal(run.frames[2].state, "error", mode);
    assert.match(run.frames[2].summary, /nothing shows the token was accepted/, mode);
    assert.equal(run.frames[2].inferred, undefined, mode);
  }
});

test("an SSE reply with a notification first still yields the reply with the matching id", async () => {
  knob.doorMode = "sse";
  const run = await runReal(cfg(), { shape: "gateway" });
  assert.equal(run.ok, true);
  assert.deepEqual(run.frames[2].response.tools, ["OnlyTool"]);
  assert.equal(run.frames[3].backend.subject, "stub-user");
});

test("a whoami reply that is not the claims object is an error", async () => {
  knob.doorMode = "whoami-true";
  const run = await runReal(cfg(), { shape: "gateway" });
  assert.equal(run.frames[3].state, "error");
});

test("sign-in client authentication: basic, post and none each reach the token endpoint as configured", async () => {
  await runReal(cfg(), { shape: "agent" });
  assert.equal(lastSignInAuth, "basic");
  await runReal(oboConfig(settings() + "PFO_OBO_SIGNIN_AUTH=post\n"), { shape: "agent" });
  assert.equal(lastSignInAuth, "post");
  const pub = oboConfig(settings().replace(/PFO_OBO_SIGNIN_SECRET=.*\n/, ""));
  assert.equal(pub.signin.auth, "none");
  await runReal(pub, { shape: "agent" });
  assert.equal(lastSignInAuth, "none");
});

test("a redirect is never followed: the target is not requested and the frame says so", async () => {
  const c = oboConfig(settings().replace("/agent/mcp", "/redirect/mcp"));
  const before = hits["/agent/mcp"] || 0;
  const run = await runReal(c, { shape: "agent" });
  assert.equal(run.frames[2].state, "error");
  assert.equal(run.frames[2].response.status, 302);
  assert.equal((hits["/agent/mcp"] || 0) - before, 0);
});

test("settings: a URL with credentials is refused; a quote ends a value only as a matching pair; export lines work", () => {
  assert.match(oboConfig(settings().replace(base, base.replace("http://", "http://user:pw@"))).problem, /credentials/);
  const s = parseSettings("PFO_A=\"quoted\"\nPFO_B='single'\nPFO_C=ends-in-quote'\nexport PFO_D=exported\nPFO_E=a b\n");
  assert.deepEqual(s, { PFO_A: "quoted", PFO_B: "single", PFO_C: "ends-in-quote'", PFO_D: "exported", PFO_E: "a b" });
});

// ---- through the API ----------------------------------------------------------------------------------------

async function withApi(envText, fn, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pfo-"));
  const file = join(dir, ".env");
  writeFileSync(file, envText);
  process.env.PFO_ENV_FILE = file;
  process.env.STANDALONE_ENV = "/dev/null";
  process.env.LAB_ALLOWED_HOSTS = "localhost:7812,127.0.0.1:7812";
  const app = buildServer({ runLogWrite: () => {}, runObsReaders: [], ...opts });
  const srv = await startVerified(async () => {
    const s = app.listen(0, "127.0.0.1");
    await new Promise((r) => s.on("listening", r));
    return s;
  });
  const api = `http://127.0.0.1:${srv.address().port}`;
  const j = async (p, b, method = "POST") => {
    const res = await fetch(api + p, { method, headers: { "content-type": "application/json", ...(method !== "GET" ? { origin: api } : {}) }, body: method === "GET" ? undefined : JSON.stringify(b || {}) });
    return { status: res.status, note: res.headers.get("x-run-observability-note"), body: res.status === 204 ? null : await res.json() };
  };
  try { await fn(j, app); } finally { await stop(srv); delete process.env.PFO_ENV_FILE; delete process.env.STANDALONE_ENV; }
}

test("API: Real is refused 409 until configured; info says why", async () => {
  await withApi("", async (j) => {
    assert.equal((await j("/api/mode", { source: "real" })).status, 409);
    const info = await j("/api/info", null, "GET");
    assert.equal(info.body.realAvailable, false);
    assert.match(info.body.realReason, /PFO_OBO_ISSUER/);
    assert.equal((await j("/api/real/obo/run", { shape: "agent" })).status, 409);
  });
});

test("API: configured Real switches, runs both shapes, lists the runs and Reset clears them", async () => {
  await withApi(settings(), async (j) => {
    assert.equal((await j("/api/info", null, "GET")).body.realAvailable, true);
    assert.equal((await j("/api/real/obo/run", { shape: "agent" })).status, 409, "mock mode: run refused");
    const sw = await j("/api/mode", { source: "real" });
    assert.equal(sw.status, 200);
    assert.equal(sw.body.source, "real");
    const view = await j("/api/real/obo", null, "GET");
    assert.deepEqual(view.body.shapes, { agent: true, gateway: true });
    assert.ok(!JSON.stringify(view.body).includes(PASSWORD));
    assert.equal((await j("/api/real/obo/run", { shape: "agent", extra: 1 })).status, 400);
    const a = await j("/api/real/obo/run", { shape: "agent", refusal: true });
    assert.equal(a.status, 200);
    assert.equal(a.body.ok, true);
    const g = await j("/api/real/obo/run", { shape: "gateway" });
    assert.equal(g.status, 200);
    assert.equal((await j("/api/runs", null, "GET")).body.realRuns.length, 2);
    assert.equal((await j("/api/reset", {})).status, 200);
    assert.equal((await j("/api/runs", null, "GET")).body.realRuns.length, 0);
    noSecrets(a.body);
    noSecrets(g.body);
    assert.equal((await j("/api/mode", { source: "mock" })).body.source, "mock");
  });
});

test("API: a second run while one is in flight is refused 409, and the lock is released afterwards", async () => {
  await withApi(settings(), async (j) => {
    assert.equal((await j("/api/mode", { source: "real" })).status, 200);
    knob.delayMs = 300;
    const [a, b] = await Promise.all([j("/api/real/obo/run", { shape: "agent" }), j("/api/real/obo/run", { shape: "agent" })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    knob.delayMs = 0;
    assert.equal((await j("/api/real/obo/run", { shape: "agent" })).status, 200);
  });
});

test("API: switching to Real lets exactly the configured hosts through the netguard; Mock takes them away again", async () => {
  const env = settings().split(base).join("https://pf.invalid").replace("https://pf.invalid/agent/mcp", "https://gw.invalid/agent/mcp").replace("https://pf.invalid/gw/mcp", "https://gw.invalid/gw/mcp");
  await withApi(env, async (j) => {
    const reach = (host) => fetch(`https://${host}/`, { signal: AbortSignal.timeout(4000) }).then(() => "reached", (e) => (/network blocked/.test(e.message) ? "blocked" : "allowed"));
    assert.equal(await reach("pf.invalid"), "blocked");
    assert.equal((await j("/api/mode", { source: "real" })).status, 200);
    assert.equal(await reach("pf.invalid"), "allowed", "the issuer host may be resolved and dialled");
    assert.equal(await reach("gw.invalid"), "allowed", "the door host too");
    assert.equal(await reach("elsewhere.invalid"), "blocked", "any other host is still refused");
    assert.equal((await j("/api/mode", { source: "mock" })).status, 200);
    assert.equal(await reach("pf.invalid"), "blocked");
  });
});

// ---- run observability (rule 27) in Real: what each layer logged for the run ---------------------------------------------------

async function withEs(hits, fn) {
  const seen = [];
  const es = http.createServer((req, res) => {
    let t = ""; req.on("data", (c) => { t += c; });
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: t });
      if (req.headers.authorization !== "ApiKey stub-read-key") return reply(res, 401, { error: "security_exception" });
      reply(res, 200, { hits: { hits: hits().map((message) => ({ _source: { "@timestamp": new Date().toISOString(), message, host: "pod-1" } })) } });
    });
  });
  await new Promise((r) => es.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${es.address().port}`, seen); } finally { await new Promise((r) => { es.closeAllConnections(); es.close(r); }); }
}

test("run observability, Real: one response row per frame the lab received, never simulated and never logged; every layer named; no secret or raw token", async () => {
  await withApi(settings(), async (j) => {
    await j("/api/mode", { source: "real" });
    assert.equal((await j("/api/run-observability", null, "GET")).status, 204, "no Real run yet");
    const run = (await j("/api/real/obo/run", { shape: "agent", refusal: true })).body;
    const { status, body: rec } = await j("/api/run-observability", null, "GET");
    assert.equal(status, 200);
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.source, "real");
    assert.equal(rec.runId, run.id);
    assert.ok(rec.rows.every((r) => r.origin !== "simulated" && r.origin !== "logged"), "no reader is configured, so nothing is logged");
    const resp = rec.rows.filter((r) => r.origin === "response");
    assert.deepEqual(resp.map((r) => r.layer), ["person", "agent", "gateway", "gateway"]);
    // The sign-in is an issuance, not a decision (info); PingFederate answering the exchange with a token, the door's accept and the control's refusal are.
    assert.deepEqual(resp.map((r) => r.outcome), ["info", "allowed", "allowed", "refused"]);
    assert.ok(resp.every((r) => /reply the lab received/.test(r.message)), "a reply is said to be a reply");
    // The control is the lab's own check: it is a genuine door refusal, and the row says plainly that the lab sent it on purpose.
    assert.match(resp[3].message, /^Control: the lab sent a made-up credential on purpose; the door is expected to refuse it\./);
    assert.equal(resp[3].detail.control, true);
    assert.ok(resp.slice(0, 3).every((r) => r.detail.control === undefined), "only the control row carries the flag");
    for (const layer of ["person", "agent", "gateway"]) assert.equal(rec.coverage[layer], "response");
    assert.equal(rec.coverage.authorize, "not-logged");
    assert.ok(["unreachable", "not-logged"].includes(rec.coverage.privilege));
    assert.match(rec.reasons.privilege, /RUN_OBS_ES_URL/);
    const text = JSON.stringify(rec);
    for (const x of [PASSWORD, AGENT_SECRET, SIGNIN_SECRET, ...minted]) assert.ok(!text.includes(x), "a secret or a raw token reached the record");
    // The row's time is the frame's own time (when the lab had the reply), inside the run's window.
    for (const r of resp) assert.ok(Date.parse(r.at) >= Date.parse(rec.window.from) && Date.parse(r.at) <= Date.parse(rec.window.to));
  });
});

test("run observability, Real: a run that stopped early has rows only for the frames that made a call, and a failed call is information, not allowed", async () => {
  await withApi(settings().replace(PASSWORD, "wrong"), async (j) => {
    await j("/api/mode", { source: "real" });
    await j("/api/real/obo/run", { shape: "gateway", refusal: true });
    const rec = (await j("/api/run-observability", null, "GET")).body;
    assert.deepEqual(assertRunObservability(rec), []);
    const resp = rec.rows.filter((r) => r.origin === "response");
    assert.deepEqual(resp.map((r) => [r.layer, r.outcome]), [["person", "info"]]);
    assert.equal(rec.summary.allowed, 0);
    assert.equal(rec.coverage.agent, "unreachable");
    assert.ok(!JSON.stringify(rec).includes("wrong"), "the typed password is not echoed");
  });
});

test("run observability, Real: the Elasticsearch reader's lines come back as logged rows with the product's own time, matched by the run's ids; the read key never leaves the server", async () => {
  const lines = () => [
    'level=info msg="Access token found for user: stub-user, client: agent-client"',
    'level=info msg="Proxying to: http://backend.example/mcp"',
    'level=info msg="something this lab has no matcher for"',
  ];
  await withEs(lines, async (esUrl, seen) => {
    await withApi(settings(), async (j) => {
      await j("/api/mode", { source: "real" });
      await j("/api/real/obo/run", { shape: "agent", refusal: false });
      const rec = (await j("/api/run-observability", null, "GET")).body;
      assert.deepEqual(assertRunObservability(rec), []);
      const logged = rec.rows.filter((r) => r.origin === "logged");
      assert.ok(logged.length >= 2, `logged rows: ${logged.length}`);
      assert.equal(rec.coverage.agent, "logged");
      assert.equal(rec.coverage.gateway, "logged", "a logged row wins over the response row");
      assert.ok(logged.every((r) => /^\d{4}-\d{2}-\d{2}T/.test(r.atExact)), "the source's own timestamp");
      assert.ok(logged.some((r) => r.matchedBy === "id"), "the access-token line names this run's agent client");
      assert.ok(rec.rows.filter((r) => r.origin === "response").length >= 3, "the lab's response rows are still there");
      assert.ok(seen.length >= 1 && seen.every((x) => x.auth === "ApiKey stub-read-key" && x.url.endsWith("/_search")), "only read-only searches, with the read key");
      assert.ok(!JSON.stringify(rec).includes("stub-read-key"), "the read key is not in the record");
    }, { runObsReaders: [new ElasticsearchReader({ url: esUrl, apiKey: "stub-read-key" })] });
  });
});

test("run observability, Real: a wrong read key makes the log layers unreachable with a reason; the run and the response rows still show", async () => {
  await withEs(() => [], async (esUrl) => {
    await withApi(settings(), async (j) => {
      await j("/api/mode", { source: "real" });
      await j("/api/real/obo/run", { shape: "agent", refusal: false });
      const res = await j("/api/run-observability", null, "GET");
      assert.equal(res.status, 200);
      const rec = res.body;
      assert.deepEqual(assertRunObservability(rec), []);
      assert.match(rec.reasons.resource, /refused the read credential|unreachable|HTTP 401/i);
      assert.ok(rec.rows.some((r) => r.origin === "response"));
      assert.ok(!JSON.stringify(rec).includes("wrong-key"));
    }, { runObsReaders: [new ElasticsearchReader({ url: esUrl, apiKey: "wrong-key" })] });
  });
});

test("run observability: a Real record is never served under Mock, and Mock has its own", async () => {
  await withApi(settings(), async (j) => {
    await j("/api/mode", { source: "real" });
    await j("/api/real/obo/run", { shape: "agent" });
    assert.equal((await j("/api/run-observability", null, "GET")).body.source, "real");
    await j("/api/mode", { source: "mock" });
    assert.equal((await j("/api/run-observability", null, "GET")).status, 204, "no Mock run yet: the Real record is not shown");
    await j("/api/run", { scenario: "happy-read" });
    assert.equal((await j("/api/run-observability", null, "GET")).body.source, "mock");
    await j("/api/mode", { source: "real" });
    assert.equal((await j("/api/run-observability", null, "GET")).body.source, "real");
  });
});

// ---- review fixes: only a policy point's decision is allowed or refused; a record is for the run asked for; Reset wins over a run in flight -------------

const exchangeRow = (rec) => rec.rows.find((r) => r.layer === "agent" && r.origin === "response");

test("run observability, Real: PingFederate's exchange is refused only for its refusal codes; invalid_client and other 4xx are information, and the row text never says refused beside info", async () => {
  await withApi(settings(), async (j) => {
    await j("/api/mode", { source: "real" });
    for (const [code, status, outcome] of [["invalid_grant", 400, "refused"], ["invalid_target", 400, "refused"], ["invalid_scope", 400, "refused"], ["access_denied", 403, "refused"],
      ["invalid_client", 401, "info"], ["invalid_request", 400, "info"], ["unauthorized_client", 400, "info"], ["server_error", 503, "info"]]) {
      knob.exchangeCode = code; knob.exchangeStatus = status;
      const run = (await j("/api/real/obo/run", { shape: "agent", refusal: false })).body;
      assert.equal(run.frames[1].response.error, code, "the frame carries the OAuth error code");
      const rec = (await j(`/api/run-observability?runId=${run.id}`, null, "GET")).body;
      assert.deepEqual(assertRunObservability(rec), []);
      const row = exchangeRow(rec);
      assert.equal(row.outcome, outcome, code);
      assert.equal(rec.summary.refused, outcome === "refused" ? 1 : 0, code);
      if (outcome === "refused") assert.match(row.message, new RegExp(`PingFederate refused the exchange: ${code}`));
      else assert.ok(!/refused/i.test(row.message), `an info row must not say refused: ${row.message}`);
      if (status >= 400 && status < 500 && outcome === "info") assert.match(row.message, /configuration or request problem, not an exchange decision/);
    }
  });
});

test("run observability, Real: a record is the run asked for: a failed attempt began no run, an unknown id is a 204 with its reason, a bad id is a 400", async () => {
  await withApi(settings(), async (j) => {
    await j("/api/mode", { source: "real" });
    const good = (await j("/api/real/obo/run", { shape: "agent", refusal: false })).body;
    assert.equal((await j("/api/real/obo/run", { shape: "nonsense" })).status, 400, "an attempt that began no run");
    const none = await j("/api/run-observability?runId=run-0-0", null, "GET");
    assert.equal(none.status, 204);
    assert.equal(none.note, "No run with that id in this mode");
    assert.equal((await j(`/api/run-observability?runId=${good.id}`, null, "GET")).body.runId, good.id);
    assert.equal((await j("/api/run-observability", null, "GET")).body.runId, good.id, "no runId: the newest finished run of the mode");
    assert.equal((await j("/api/run-observability?runId=a%20b", null, "GET")).status, 400);
    assert.equal((await j(`/api/run-observability?runId=${"x".repeat(65)}`, null, "GET")).status, 400);
    await j("/api/mode", { source: "mock" });
    assert.equal((await j(`/api/run-observability?runId=${good.id}`, null, "GET")).status, 204, "a Real run is not served in Mock mode");
  });
});

test("a Real run that started before Reset does not re-enter the stores when it finishes", async () => {
  await withApi(settings(), async (j) => {
    await j("/api/mode", { source: "real" });
    knob.delayMs = 250;
    const submitted = hits["/pf-ws/authn/flows/flow-abc-123"] || 0;
    const inFlight = j("/api/real/obo/run", { shape: "agent", refusal: false });
    // Reset only once the run is really in flight (its sign-in reached the stand-in, whose token endpoint then waits knob.delayMs).
    for (let i = 0; i < 200 && (hits["/pf-ws/authn/flows/flow-abc-123"] || 0) === submitted; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await j("/api/reset", {})).status, 200);
    const run = (await inFlight).body;
    assert.equal(run.ok, true, "the run itself still answered its caller");
    assert.equal((await j("/api/run-observability", null, "GET")).status, 204, "the stale run is not in the record store");
    assert.equal((await j(`/api/run-observability?runId=${run.id}`, null, "GET")).status, 204);
    assert.deepEqual((await j("/api/runs", null, "GET")).body.realRuns, [], "nor in the run list");
    knob.delayMs = 0;
    const after = (await j("/api/real/obo/run", { shape: "agent", refusal: false })).body;
    assert.equal((await j("/api/run-observability", null, "GET")).body.runId, after.id, "a run started after Reset is recorded");
  });
});

// ---- review fixes, second round ------------------------------------------------------------------------------------------------------------

import { observeRealRun } from "../server/src/runLog.js";

test("a Real run in flight blocks a mode switch with a 409 {error, message}; an idle switch works both ways and 'Real not configured' is still its own 409", async () => {
  await withApi(settings(), async (j) => {
    assert.equal((await j("/api/mode", { source: "real" })).status, 200);
    knob.delayMs = 300;
    const inFlight = j("/api/real/obo/run", { shape: "agent", refusal: false });
    const before = hits["/pf-ws/authn/flows/flow-abc-123"] || 0;
    for (let i = 0; i < 200 && (hits["/pf-ws/authn/flows/flow-abc-123"] || 0) === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const blocked = await j("/api/mode", { source: "mock" });
    assert.equal(blocked.status, 409);
    assert.deepEqual(blocked.body, { error: "run_in_progress", message: "A Real run is still in progress: wait for it to finish before switching mode." });
    assert.equal((await j("/api/info", null, "GET")).body.source, "real", "the mode did not change");
    const run = (await inFlight).body;
    assert.equal(run.ok, true);
    knob.delayMs = 0;
    assert.equal((await j("/api/mode", { source: "mock" })).body.source, "mock", "idle: Real to Mock");
    assert.equal((await j("/api/mode", { source: "real" })).body.source, "real", "idle: Mock to Real");
    assert.equal((await j("/api/run-observability", null, "GET")).body.runId, run.id, "the run that was in flight finished under Real");
  });
  await withApi("", async (j) => {
    const r = await j("/api/mode", { source: "real" });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Real is not configured/, "the existing 409 is unchanged");
  });
});

test("the run deadline: a call that would start after it is not made (sign-in alone is three calls), and the row says so", async () => {
  const token = () => hits["/as/token.oauth2"] || 0;
  // Already past: nothing is called at all.
  let before = Object.values(hits).reduce((a, b) => a + b, 0);
  let run = await runReal(cfg(), { shape: "agent", refusal: true, deadlineMs: 0 });
  assert.equal(Object.values(hits).reduce((a, b) => a + b, 0), before, "no call was made");
  assert.equal(run.frames[0].state, "error");
  assert.equal(run.frames[0].deadline, true);
  assert.ok(run.frames.slice(1).every((f) => f.state === "skipped"));
  // Passes while the sign-in's second call is waiting: the third sign-in call (the code exchange) is never made.
  knob.flowDelayMs = 300;
  const t0 = token();
  run = await runReal(cfg(), { shape: "agent", refusal: false, deadlineMs: 150 });
  knob.flowDelayMs = 0;
  assert.equal(token() - t0, 0, "the sign-in's token call was not made after the deadline");
  assert.equal(run.frames[0].state, "error");
  assert.equal(run.frames[0].deadline, true);
  assert.match(run.frames[0].summary, /deadline passed before this call could start/);
  assert.deepEqual(run.frames.map((f) => f.state), ["error", "skipped", "skipped"]);
  const ev = observeRealRun({ run });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].outcome, "info");
  assert.equal(ev[0].result, "no-reply");
  assert.match(ev[0].message, /deadline passed before this call could start, so it was not made\. There is no reply to show/);
  // The happy path is unchanged: the default deadline does not interfere.
  run = await runReal(cfg(), { shape: "agent", refusal: true });
  assert.equal(run.ok, true);
});

function countingReader() {
  const r = { name: "count", calls: 0, canRead: () => true, async readLines() { r.calls += 1; return { lines: [] }; } };
  return r;
}

test("a Real record is kept for 10 s per run: repeated reads (with or without runId) do not search again; a deliberate fresh read does; it expires; Reset drops it; Mock is never kept", async () => {
  const reader = countingReader();
  let t = 1_000_000;
  await withApi(settings(), async (j, app) => {
    await j("/api/mode", { source: "real" });
    const run = (await j("/api/real/obo/run", { shape: "agent", refusal: false })).body;
    assert.equal(reader.calls, 0);
    const first = await j(`/api/run-observability?runId=${run.id}`, null, "GET");
    const perRead = reader.calls;
    assert.ok(perRead >= 4, `one read searches each product once (${perRead})`);
    assert.equal(app.locals.recordCache.size, 1);
    assert.deepEqual((await j(`/api/run-observability?runId=${run.id}`, null, "GET")).body, first.body);
    assert.deepEqual((await j("/api/run-observability", null, "GET")).body, first.body, "the no-runId path honours it too");
    assert.equal(reader.calls, perRead, "no search was fired again");
    // The page's Re-read asks for a rebuild, which also refreshes what is kept.
    await j(`/api/run-observability?runId=${run.id}&fresh=1`, null, "GET");
    assert.equal(reader.calls, perRead * 2);
    await j("/api/run-observability", null, "GET");
    assert.equal(reader.calls, perRead * 2, "the rebuilt record is the one kept");
    // Expiry.
    t += 10_001;
    await j("/api/run-observability", null, "GET");
    assert.equal(reader.calls, perRead * 3, "after the TTL a read searches again");
    // Reset drops it.
    assert.equal(app.locals.recordCache.size, 1);
    await j("/api/reset", {});
    assert.equal(app.locals.recordCache.size, 0);
    // Mock records are built from the lab's own rows: nothing is kept and no reader is asked.
    await j("/api/mode", { source: "mock" });
    await j("/api/run", { scenario: "happy-read" });
    const calls = reader.calls;
    await j("/api/run-observability", null, "GET");
    assert.equal(reader.calls, calls, "no search for a Mock record");
    assert.equal(app.locals.recordCache.size, 0);
  }, { runObsReaders: [reader], recordTtlMs: 10_000, now: () => t });
});
