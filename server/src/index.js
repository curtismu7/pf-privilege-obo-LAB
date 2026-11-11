// Express server: run the mock chain, decode tokens, serve catalog + mode APIs.
import express from "express";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as pf from "./pf.js";
import * as privilege from "./privilege.js";
import { installNetguard, netguardSelfTest } from "./netguard.js";
import { fillTokens, tokensFor, undefinedTokens, VERTICALS } from "./cast.js";
import { SCENARIOS, CHAIN_STEPS, ISSUES, WHAT_PRIVILEGE_DOES, WHAT_PRIVILEGE_CANT, OPENING } from "./scenarios.js";

const state = { source: "mock", runs: [], workspaceId: process.env.LAB_WORKSPACE_ID || "default" };
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

export function buildServer({ netguard } = {}) {
  // Rule 1: zero real outbound by default. The mock issuer/gateway/backend are
  // in-process, so nothing here has a reason to leave the machine.
  installNetguard();
  const app = express();
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
    res.json({ source: state.source, realAvailable: false, realReason: "Real mode is not configured for this lab; it is a simulated chain (rule 19)." });
  });

  app.post("/api/mode", (req, res) => {
    const { source } = req.body || {};
    if (source === "real") return res.status(409).json({ error: "Real mode is not configured for this lab; it is a simulated chain (rule 19)." });
    if (source !== "mock") return res.status(400).json({ error: "body must be {source:\"mock\"|\"real\"}" });
    state.source = "mock";
    res.json({ source: state.source });
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
      } else {
        subjectToken = pf.mintSubjectToken({ user, clientId: cfg.agentClientId, issuer: cfg.pfIssuer });
        effToken = pf.mintOboToken({
          user,
          agent: cfg.agentId,
          clientId: cfg.agentClientId,
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
      subjectToken: subjectToken ? tokenSummary(subjectToken) : null
    };
    state.runs.push(run);
    if (state.runs.length > 200) state.runs.shift();
    res.json(run);
  });

  app.post("/api/decode", (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });
    res.json({ claims: pf.decodePayload(token), verified: pf.verify(token).ok, label: "mock" });
  });

  app.get("/api/runs", (req, res) => res.json({ runs: state.runs }));

  app.post("/api/reset", (req, res) => {
    state.runs = [];
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
