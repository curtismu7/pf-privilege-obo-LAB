// Express server: run the mock chain, decode tokens, serve catalog + mode APIs.
import express from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as pf from "./pf.js";
import * as privilege from "./privilege.js";
import { installNetguard, netguardSelfTest, setAllowedOrigins } from "./netguard.js";
import { readFileSettings, doorConfig, createRealDoor } from "./gatewayReal.js";
import { oboConfig, publicView, runReal, NOT_CONFIGURED } from "./oboReal.js";
import { createRunLog, observeMockRun, observeRealRun, buildRunRecord } from "./runLog.js";
import { RunObsError } from "./runObservability.js";
import { readersFromEnv } from "./runObservabilityReaders.js";
import { storyResponse } from "./storyRoute.js";

// Real mode = the shared gateway hop: an agent key from the shared settings file calling a live Privilege door.
const PFO_REFUSAL = "Real is not configured: set PFO_GW_URL, PFO_GW_APPS and at least one PFO_GW_KEY_<NAME> in the shared settings file (~/Development/.env, or STANDALONE_ENV). Mock keeps working.";
function realDoorFrom(env = process.env) {
  const p = env.STANDALONE_ENV || `${env.HOME || ""}/Development/.env`;
  let text = "";
  try { text = readFileSync(p, "utf8"); } catch { /* the environment may still carry the keys */ }
  for (const [k, v] of Object.entries(env)) if (k.startsWith("PFO_GW_") && v) text += `\n${k}=${v}`;
  const cfg = doorConfig(text, "PFO");
  return cfg.ok ? createRealDoor({ config: cfg, clientInfo: { name: "pf-privilege-obo", version: "0.1.0" } }) : null;
}
// Real OBO settings: this lab's own .env (beside the compose file), or the environment (compose env_file).
function oboConfigNow(env = process.env) {
  const file = env.PFO_ENV_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { /* the environment may carry the settings */ }
  return oboConfig(text, env);
}
import { fillTokens, tokensFor, undefinedTokens, VERTICALS } from "./cast.js";
import { oboGatewayTrace } from "./oboTrace.js";
import { SCENARIOS, CHAIN_STEPS, ISSUES, WHAT_PRIVILEGE_DOES, WHAT_PRIVILEGE_CANT, OPENING } from "./scenarios.js";

const state = { source: "mock", runs: [], realRuns: [], realBusy: false, workspaceId: process.env.LAB_WORKSPACE_ID || "default" };
const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "..", "dist");

function sha8(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

let runCounter = 0;
function nextRunId() {
  runCounter += 1;
  return `run-${Date.now()}-${runCounter}`;
}

// Never show a raw token in a run record: claims + short hash only.
function tokenSummary(token) {
  const payload = pf.decodePayload(token);
  return {
    hash: sha8(token),
    claims: payload || null,
    note: "mock token; body stays server-side"
  };
}

// runLog / runLogWrite: the run's decision log and where its one-line-per-decision output goes (stdout by default). runObsReaders: the log
// readers for a Real record (readersFromEnv() by default: Elasticsearch with a read-only key, nothing else unless opted in).
export function buildServer({ netguard, runLog: injectedRunLog, runLogWrite, runObsReaders, recordTtlMs = 10_000, now = () => Date.now() } = {}) {
  // Rule 1: zero real outbound by default. The mock issuer/gateway/backend are
  // in-process, so nothing here has a reason to leave the machine.
  installNetguard();
  const runLog = injectedRunLog ?? createRunLog({ write: runLogWrite });
  let generation = 0; // bumped by Reset: a Real run that started before it must not re-enter the stores when it finishes
  // A Real record costs up to seven Elasticsearch searches. The record built for a run is kept for a few seconds (by mode and run id) so repeated reads do not
  // fire them again; Reset drops it, and the page's deliberate Re-read (?fresh=1) rebuilds it, because it exists to read lines the collector shipped late.
  const recordCache = new Map();
  const app = express();
  app.locals.recordCache = recordCache; // exposed for the tests: the kept Real records (size 0 after Reset)
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  // Writes must be JSON: express.json skips other types, so refuse them explicitly.
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("application/json")) return res.status(415).json({ error: "content-type must be application/json" });
    next();
  });

  // Same-origin guard for writes; Host check.
  // fetch() forbids setting the Host header, so tests and local curl-style probes
  // are allowed on any loopback host:port; non-loopback hosts must be allowlisted.
  const allowedHosts = String(process.env.LAB_ALLOWED_HOSTS || "localhost:7812,127.0.0.1:7812,local.ping-devops.example:8443")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const loopbackRe = /^127\.0\.0\.1(:\d+)?$/;
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (!allowedHosts.includes(host) && !loopbackRe.test(host)) return res.status(403).json({ error: "host not allowed" });
    next();
  });
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        const same = originHost === req.headers.host;
        const loopbackOrigin = /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
        // Behind the shared lab-proxy the browser origin (local.ping-devops.com:8443)
        // never equals the upstream Host; the proxy vouches via X-Forwarded-Host
        // matching its own allowlist entry.
        const xfwd = req.headers["x-forwarded-host"];
        const proxied = xfwd && String(xfwd).split(",")[0].trim() === originHost && !/local\.ping-devops\.example/.test(originHost);
        if (!same && !loopbackOrigin && !proxied) return res.status(403).json({ error: "cross-origin write refused" });
      } catch {
        return res.status(403).json({ error: "bad origin" });
      }
    }
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, contract: "demo-health/1", app: "pf-privilege-obo-LAB", source: state.source });
  });

  app.get("/api/info", (req, res) => {
    res.json({ source: state.source, realAvailable: Boolean(realDoorFrom()) || oboConfigNow().ok, realReason: NOT_CONFIGURED });
  });

  // Story mode wording (shared/story/README.md): the page's live Story and the recorded video both read this one copy of captions.md.
  app.get("/api/story", (req, res) => {
    const { status, body } = storyResponse();
    res.status(status).json(body);
  });

  app.post("/api/mode", (req, res) => {
    const { source } = req.body || {};
    // A Real run in flight records itself under Real when it ends: switching under it would leave the page showing one mode while the run finishes in the other.
    if (state.realBusy) return res.status(409).json({ error: "run_in_progress", message: "A Real run is still in progress: wait for it to finish before switching mode." });
    if (source === "real") {
      const door = realDoorFrom();
      const obo = oboConfigNow();
      if (!door && !obo.ok) return res.status(409).json({ error: NOT_CONFIGURED });
      // Real mode may reach only the hosts the settings name: the netguard allows exactly those, nothing else.
      setAllowedOrigins([...(door ? [door.origin] : []), ...(obo.ok ? obo.origins : [])]);
      state.source = "real";
      return res.json({ source: state.source, doors: door ? door.apps : [], gateway: door ? door.origin : null, obo: publicView(obo) });
    }
    if (source !== "mock") return res.status(400).json({ error: "body must be {source:\"mock\"|\"real\"}" });
    state.source = "mock";
    setAllowedOrigins([]);
    res.json({ source: state.source });
  });

  // One real gateway check: tools/list through the door, then the gateway's refusal for a tool nothing grants.
  app.post("/api/gateway-check", async (req, res) => {
    const door = realDoorFrom();
    if (!door) return res.status(409).json({ error: PFO_REFUSAL });
    if (req.body && Object.keys(req.body).some((k) => !["app", "caller"].includes(k))) return res.status(400).json({ error: "the only accepted body fields are { app, caller }" });
    const app = String(req.body?.app || door.apps[0]);
    if (!door.apps.includes(app)) return res.status(400).json({ error: `app must be one of ${door.apps.join(", ")}` });
    const caller = req.body?.caller && door.callers.some((c) => c.id === req.body.caller) ? req.body.caller : door.callers[0].id;
    const listing = await door.list(app, caller);
    const out = { app, caller, gateway: door.origin, listing };
    if (listing.ok) out.refusal = await door.call(app, caller, "pf_obo_refusal_probe_tool", {});
    res.json(out);
  });

  // Real OBO: what is configured (never a secret), and one live run as numbered frames.
  app.get("/api/real/obo", (req, res) => res.json(publicView(oboConfigNow())));

  app.post("/api/real/obo/run", async (req, res) => {
    if (state.source !== "real") return res.status(409).json({ error: "switch to Real first (POST /api/mode)" });
    const body = req.body || {};
    if (Object.keys(body).some((k) => !["shape", "refusal"].includes(k))) return res.status(400).json({ error: "the only accepted body fields are { shape, refusal }" });
    if (state.realBusy) return res.status(409).json({ error: "a run is already in progress" });
    const cfg = oboConfigNow();
    state.realBusy = true;
    const startedIn = generation;
    try {
      const run = await runReal(cfg, { shape: body.shape, refusal: body.refusal === true });
      run.id = nextRunId();
      if (startedIn === generation) {
        state.realRuns.push(run);
        if (state.realRuns.length > 20) state.realRuns.shift();
        runLog.recordRun({ source: "real", runId: run.id, startedAt: run.startedAt, events: observeRealRun({ run }) });
      }
      res.json(run);
    } catch (err) {
      res.status(err.status || 500).json({ error: String(err.message || "run failed").slice(0, 400) });
    } finally { state.realBusy = false; }
  });

  app.get("/api/catalog", (req, res) => {
    const v = String(req.query.vertical || "finance");
    const tokens = tokensFor(v);
    res.json({
      workspaceId: state.workspaceId,
      verticals: Object.keys(VERTICALS),
      cast: tokens,
      opening: OPENING,
      does: WHAT_PRIVILEGE_DOES.map((t) => fillTokens(t, v)),
      cant: WHAT_PRIVILEGE_CANT.map((t) => fillTokens(t, v)),
      issues: ISSUES.map((i) => ({ ...i, title: fillTokens(i.title, v), what: fillTokens(i.what, v), fix: fillTokens(i.fix, v) })),
      steps: CHAIN_STEPS.map((s) => ({ ...s, title: fillTokens(s.title, v), what: fillTokens(s.what, v) })),
      scenarios: SCENARIOS
    });
  });

  // The vertical packs (rule 10): every token used in the catalog is defined.
  app.get("/api/cast-check", (req, res) => {
    const v = String(req.query.vertical || "finance");
    const texts = [
      ...WHAT_PRIVILEGE_DOES, ...WHAT_PRIVILEGE_CANT,
      ...ISSUES.flatMap((i) => [i.title, i.what, i.fix]),
      ...CHAIN_STEPS.flatMap((s) => [s.title, s.what, s.claim]),
      "{{castUser}} {{castAgent}} {{castBackend}} {{castBrand}}"
    ];
    const missing = undefinedTokens(texts, v);
    res.json({ ok: missing.length === 0, missing });
  });

  // Mint the subject token (SSO stand-in).
  app.post("/api/mint-subject", (req, res) => {
    const { user = fillTokens("{{castUser}}") } = req.body || {};
    const token = pf.mintSubjectToken({ user, clientId: privilege.DEFAULT_CONFIG.agentClientId, issuer: privilege.DEFAULT_CONFIG.pfIssuer });
    res.json({ token, claims: pf.decodePayload(token), label: "mock subject token (mock)" });
  });

  // The RFC 8693 exchange at PingFederate.
  app.post("/api/exchange", (req, res) => {
    const { subjectToken, user, audience, scope, actIsText } = req.body || {};
    if (!subjectToken && !user) return res.status(400).json({ error: "subjectToken or user required" });
    if (subjectToken) {
      const v = pf.verify(subjectToken);
      if (!v.ok) return res.status(400).json({ error: `subject token rejected: ${v.reason}` });
    }
    const cfg = privilege.DEFAULT_CONFIG;
    const token = pf.mintOboToken({
      user: user || pf.decodePayload(subjectToken).sub,
      agent: cfg.agentId,
      clientId: cfg.agentClientId,
      audience: audience || cfg.audience,
      scope: scope || cfg.scope,
      issuer: cfg.pfIssuer,
      actIsText: Boolean(actIsText)
    });
    res.json({ token, claims: pf.decodePayload(token), label: "mock OBO token (mock): sub = user, act.sub = agent" });
  });

  // Run the chain.
  app.post("/api/run", (req, res) => {
    const { scenario, token, tool, scope, audience, actIsText } = req.body || {};
    const cfg = { ...privilege.DEFAULT_CONFIG };
    let subjectToken = req.body && req.body.subjectToken;
    const shape = scenario === "autonomous" ? "autonomous" : "obo";
    let effToken = token;
    let garbageBearer = false;

    if (!effToken) {
      // Mint from the scenario so the UI can drive everything with one call.
      const scen = SCENARIOS.find((s) => s.id === (scenario || "happy-read")) || SCENARIOS[0];
      let user = fillTokens("{{castUser}}");
      let useAudience = audience || cfg.audience;
      let useScope = scope || scen.scope;
      const useActText = actIsText !== undefined ? actIsText : scen.expect === "reject-act";
      if (scen.expect === "reject-audience") useAudience = "https://enduser.example.com";
      if (scen.expect === "reject-autonomous") {
        // Autonomous shape: sub = agent, no act, client-credentials style.
        user = cfg.agentId;
      }
      if (scen.expect === "reject-signature") {
        // A garbage bearer never reaches the grant: refused at sign-in.
        effToken = "garbage.token.value";
        subjectToken = null;
        garbageBearer = true;
      } else {
        // "cedar-actsub": the identity trusts two agents (any-of required claims); the token comes from the second
        // one, so it passes the identity and the grant and only the act.sub Cedar policy refuses it.
        let tokenAgent = cfg.agentId;
        let tokenClient = cfg.agentClientId;
        if (scen.expect === "block-cedar-actsub") {
          tokenAgent = privilege.SECOND_AGENT_ID;
          tokenClient = privilege.SECOND_AGENT_ID;
          cfg.requiredClaims = {
            "act.sub": [cfg.agentId, privilege.SECOND_AGENT_ID],
            client_id: [cfg.agentClientId, privilege.SECOND_AGENT_ID]
          };
        }
        subjectToken = pf.mintSubjectToken({ user, clientId: tokenClient, issuer: cfg.pfIssuer });
        effToken = pf.mintOboToken({
          user,
          agent: tokenAgent,
          clientId: tokenClient,
          audience: useAudience,
          scope: useScope,
          issuer: cfg.pfIssuer,
          actIsText: useActText,
          withAct: scen.expect !== "reject-autonomous"
        });
      }
    }
    const effectiveTool = tool || (SCENARIOS.find((s) => s.id === scenario) || {}).tool || "SearchIndexTool";

    const result = privilege.runChain({ token: effToken, tool: effectiveTool, config: cfg, verifyFn: pf.verify, shape });
    const run = {
      id: nextRunId(),
      at: new Date().toISOString(),
      tool: effectiveTool,
      http: result.http,
      ok: result.ok,
      hops: result.hops,
      token: tokenSummary(effToken),
      subjectToken: subjectToken ? tokenSummary(subjectToken) : null,
      // "What Privilege did": the simulated gateway call, drawn by the page (Rule 25).
      trace: oboGatewayTrace({ token: effToken, tool: effectiveTool, config: cfg, result })
    };
    state.runs.push(run);
    if (state.runs.length > 200) state.runs.shift();
    // Rule 27: the lab minted a person token and an access token only when it built them itself (not a caller-supplied or garbage bearer).
    const minted = !req.body?.token && !garbageBearer;
    const claims = pf.decodePayload(effToken);
    // `"{}".sub` is String.prototype.sub, so only an object with a string sub names an actor; any other act is malformed.
    const act = claims?.act;
    const actState = act === undefined ? "absent" : act && typeof act === "object" && typeof act.sub === "string" ? "object" : "malformed";
    const who = { sub: claims?.sub, actor: actState === "object" ? act.sub : undefined, actState };
    runLog.recordRun({ source: "mock", runId: run.id, startedAt: run.at, events: observeMockRun({ run, who, minted }) });
    res.json(run);
  });

  app.post("/api/decode", (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });
    res.json({ claims: pf.decodePayload(token), verified: pf.verify(token).ok, label: "mock" });
  });

  // Run observability (rule 27): what each layer left behind for a run in the CURRENT mode. Mock rows are simulated (computed by the mock on
  // that run); Real rows are the replies the lab received plus whatever the Elasticsearch reader found. ?runId=<id>: that run's record, only if it
  // is one of the last three runs of this mode, else 204 (a 204 has no body, so the reason is in the X-Run-Observability-Note header); a bad id is
  // 400. Without runId: the newest finished run of this mode.
  app.get("/api/run-observability", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const asked = req.query.runId;
    if (asked !== undefined && !(typeof asked === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(asked))) return res.status(400).json({ error: "bad_run_id", message: "runId must be 1 to 64 characters from A-Z a-z 0-9 . _ -" });
    const run = runLog.forSource(state.source, asked);
    if (!run) { // no run yet in this mode, or not that one: not an error, the page shows its empty state
      if (asked !== undefined) res.set("X-Run-Observability-Note", "No run with that id in this mode");
      return res.status(204).end();
    }
    try {
      const key = `${state.source}|${run.runId}`;
      const hit = state.source === "real" && req.query.fresh !== "1" ? recordCache.get(key) : null;
      if (hit && now() - hit.at < recordTtlMs) return res.json(hit.record);
      const record = await buildRunRecord({ run, readers: runObsReaders ?? readersFromEnv() });
      if (state.source === "real") {
        for (const [k, v] of recordCache) if (now() - v.at >= recordTtlMs) recordCache.delete(k);
        recordCache.set(key, { at: now(), record });
      }
      res.json(record);
    } catch (e) {
      if (e instanceof RunObsError) return res.status(e.status).json({ error: e.code, message: e.message });
      res.status(500).json({ error: "run_observability_failed", message: "The run record could not be built." });
    }
  });

  app.get("/api/runs", (req, res) => res.json({ runs: state.runs, realRuns: state.realRuns }));

  app.post("/api/reset", (req, res) => {
    state.runs = [];
    state.realRuns = [];
    generation += 1;
    runLog.reset();
    recordCache.clear();
    res.json({ ok: true });
  });

  if (netguard) netguard(app);

  // Serve the built UI when present (Docker/dev build).
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(distDir, "index.html")));
  }

  return app;
}

export function readState() {
  return state;
}

// Entry point when run directly (`node server/src/index.js`).
const invoked = process.argv[1] && new URL("file://" + process.argv[1]).pathname;
if (invoked && invoked === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT || 7812);
  // Host binding: 0.0.0.0 when explicitly asked (Docker routes to the container
  // via its eth0 address); the Docker publish pins 127.0.0.1 on the HOST, which
  // is the loopback-only guarantee. Bare host runs default to loopback.
  const bind = process.env.BIND_ALL === "1" ? "0.0.0.0" : "127.0.0.1";
  buildServer().listen(port, bind, () => {
    console.log(`pf-privilege-obo-LAB listening on http://${bind}:${port}`);
  });
}
