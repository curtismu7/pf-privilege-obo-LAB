// Real OBO run, against an in-process stand-in for PingFederate and the two doors (loopback only: nothing leaves the machine).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oboConfig, publicView, runReal, parseSettings, MADE_UP_TOKEN } from "../server/src/oboReal.js";
import { buildServer } from "../server/src/index.js";

const PASSWORD = "stub-user-password-1";
const AGENT_SECRET = "stub-agent-secret-2";
const SIGNIN_SECRET = "stub-signin-secret-3";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "none" })}.${b64(payload)}.sig`;
const basicOf = (id, s) => `Basic ${Buffer.from(`${id}:${s}`).toString("base64")}`;

let stub; let base; const minted = new Set(); let lastExchange = null; let challenge = null;

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((resolve) => { let t = ""; req.on("data", (c) => { t += c; }); req.on("end", () => resolve(t)); });

before(async () => {
  stub = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readBody(req);
    if (url.pathname === "/as/authorization.oauth2") { challenge = url.searchParams.get("code_challenge"); return reply(res, 200, { id: "flow-abc-123", status: "USERNAME_PASSWORD_REQUIRED" }, { "set-cookie": "ST=1; Path=/" }); }
    if (url.pathname === "/pf-ws/authn/flows/flow-abc-123") {
      if (req.headers["x-xsrf-header"] !== "PingFederate") return reply(res, 400, { code: "INVALID_REQUEST" });
      const b = JSON.parse(body);
      if (b.password !== PASSWORD) return reply(res, 400, { code: "VALIDATION_ERROR", message: `bad password ${b.password}` });
      return reply(res, 200, { status: "COMPLETED", authorizeResponse: { code: "code-1" } });
    }
    if (url.pathname === "/as/token.oauth2") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        if (req.headers.authorization !== basicOf("signin-client", SIGNIN_SECRET)) return reply(res, 401, { error: "invalid_client" });
        if (createHash("sha256").update(p.get("code_verifier")).digest("base64url") !== challenge) return reply(res, 400, { error: "invalid_grant" });
        const now = Math.floor(Date.now() / 1000);
        return reply(res, 200, { id_token: jwt({ iss: base, sub: "stub-user", aud: "signin-client", iat: now, exp: now + 300 }) });
      }
      if (req.headers.authorization !== basicOf("agent-client", AGENT_SECRET)) return reply(res, 401, { error: "invalid_client" });
      lastExchange = Object.fromEntries(p);
      const target = p.get("audience") || p.get("resource");
      const now = Math.floor(Date.now() / 1000);
      const t = jwt({ iss: base, sub: "stub-user", aud: target, client_id: "agent-client", act: { sub: "agent-client" }, scope: p.get("scope"), iat: now, exp: now + 3600 });
      minted.add(t);
      return reply(res, 200, { access_token: t, token_type: "Bearer" });
    }
    if (url.pathname === "/agent/mcp" || url.pathname === "/gw/mcp") {
      const bearer = String(req.headers.authorization || "").replace(/^Bearer /, "");
      if (!minted.has(bearer)) return reply(res, 401, { error: "unauthorized", error_description: "Bearer token required" }, { "www-authenticate": `Bearer realm="stub", resource_metadata="${base}/.well-known/oauth-protected-resource${url.pathname}"` });
      const rpc = JSON.parse(body);
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
after(() => stub.close());

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

test("the made-up token is not a secret and is not any minted token", () => {
  assert.ok(!minted.has(MADE_UP_TOKEN));
});

// ---- through the API ----------------------------------------------------------------------------------------

async function withApi(envText, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pfo-"));
  const file = join(dir, ".env");
  writeFileSync(file, envText);
  process.env.PFO_ENV_FILE = file;
  process.env.STANDALONE_ENV = "/dev/null";
  process.env.LAB_ALLOWED_HOSTS = "localhost:7812,127.0.0.1:7812";
  const srv = buildServer().listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const api = `http://127.0.0.1:${srv.address().port}`;
  const j = async (p, b, method = "POST") => {
    const res = await fetch(api + p, { method, headers: { "content-type": "application/json", ...(method !== "GET" ? { origin: api } : {}) }, body: method === "GET" ? undefined : JSON.stringify(b || {}) });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(j); } finally { srv.close(); delete process.env.PFO_ENV_FILE; delete process.env.STANDALONE_ENV; }
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
