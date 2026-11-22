// "What Privilege did" (Rule 25): the vendored files are pinned by sha256, and every trace this lab builds passes assertTrace.
// Re-vendor (cp, never edit), then re-pin: cd web/src/gateway-trace && shasum -a 256 GatewayTrace.jsx gateway-trace.css gateway-trace.test.jsx
// (gatewayTrace.js in server/src is pinned by the same file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../server/src/index.js";
import { assertTrace } from "../server/src/gatewayTrace.js";
import { oboGatewayTrace } from "../server/src/oboTrace.js";
import { DEFAULT_CONFIG, runChain } from "../server/src/privilege.js";
import * as pf from "../server/src/pf.js";
import { SCENARIOS } from "../server/src/scenarios.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = "web/src/gateway-trace";
const WHERE = { "GatewayTrace.jsx": WEB, "gateway-trace.css": WEB, "gateway-trace.test.jsx": WEB, "gatewayTrace.js": "server/src" };
const sha = (p) => createHash("sha256").update(readFileSync(join(root, p))).digest("hex");
const pins = readFileSync(join(root, WEB, "gateway-trace.sha256"), "utf8").split("\n").filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.split(/\s+/));

test("every vendored gateway-trace file matches its pinned sha256, and all four are pinned", () => {
  assert.deepEqual(pins.map(([, f]) => f).sort(), Object.keys(WHERE).sort());
  for (const [hash, file] of pins) assert.equal(sha(`${WHERE[file]}/${file}`), hash, `${file} differs from gateway-trace.sha256 (hand-edited, or re-vendored without re-pinning)`);
});

async function withServer(fn) {
  process.env.LAB_ALLOWED_HOSTS = "localhost:7812,127.0.0.1:7812";
  // Hermetic: a developer's real settings (the lab .env, the shared settings file) must not turn Real on in a test.
  process.env.PFO_ENV_FILE = "/dev/null";
  process.env.STANDALONE_ENV = "/dev/null";
  const srv = buildServer().listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (p, b) => {
    const res = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(b || {}) });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(post); } finally { srv.close(); }
}

test("every scenario's run carries a mock trace that passes assertTrace, all decisions checked", async () => {
  await withServer(async (post) => {
    for (const s of SCENARIOS) {
      const r = await post("/api/run", { scenario: s.id });
      const t = r.body.trace;
      assert.deepEqual(assertTrace(t), [], s.id);
      assert.equal(t.source, "mock", s.id);
      assert.equal(t.response.status, r.body.http, s.id);
      assert.deepEqual(t.decisions.map((d) => d.id), ["nhi", "grant", "cedar", "backend"], s.id);
      for (const d of t.decisions) assert.equal(d.basis, "checked", `${s.id}/${d.id}`);
      assert.deepEqual(t.request.body, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: r.body.tool } }, s.id);
    }
  });
});

test("happy path: all four checks pass and the reply carries the backend's whoami", async () => {
  await withServer(async (post) => {
    const t = (await post("/api/run", { scenario: "happy-read" })).body.trace;
    assert.deepEqual(t.decisions.map((d) => d.outcome), ["pass", "pass", "pass", "pass"]);
    assert.equal(t.response.status, 200);
    assert.match(t.response.body.result.content[0].text, /sub=priya\.nair/);
    assert.match(t.response.body.result.content[0].text, /act\.sub=agent-client-example/);
  });
});

test("a refusal marks the refusing check failed and the later ones skipped, with the simulation's own reason", async () => {
  await withServer(async (post) => {
    const out = async (scenario) => (await post("/api/run", { scenario })).body.trace;
    let t = await out("garbage");
    assert.deepEqual(t.decisions.map((d) => d.outcome), ["fail", "skipped", "skipped", "skipped"]);
    assert.equal(t.response.status, 401);
    assert.match(t.decisions[0].evidence, /workload token rejected/);
    assert.ok(!JSON.stringify(t).includes("garbage.token.value"), "not even the garbage control is shown raw");
    t = await out("no-grant");
    assert.deepEqual(t.decisions.map((d) => d.outcome), ["pass", "fail", "skipped", "skipped"]);
    assert.equal(t.response.status, 403);
    t = await out("cedar-block");
    assert.deepEqual(t.decisions.map((d) => d.outcome), ["pass", "pass", "fail", "skipped"]);
    assert.equal(t.response.status, 400);
    assert.equal(t.response.body.error.code, -32600);
    assert.match(t.decisions[2].evidence, /scope-search-guard/);
  });
});

test("no token reaches the trace: a minted token is shown only by its length, and a fake key is absent", () => {
  const fakeKey = `fake-${randomBytes(12).toString("hex")}`;
  const token = pf.mintOboToken({ user: "u", agent: DEFAULT_CONFIG.agentId, clientId: DEFAULT_CONFIG.agentClientId, audience: DEFAULT_CONFIG.audience, scope: "mcp", issuer: DEFAULT_CONFIG.pfIssuer });
  const result = runChain({ token, tool: "SearchIndexTool", config: DEFAULT_CONFIG, verifyFn: pf.verify });
  const t = oboGatewayTrace({ token, tool: "SearchIndexTool", config: DEFAULT_CONFIG, result });
  assert.deepEqual(assertTrace(t), []);
  const text = JSON.stringify(t);
  assert.ok(!text.includes(token), "the full token is in the trace");
  assert.ok(!text.includes(token.split(".")[2]), "the token signature is in the trace");
  assert.match(t.request.headers.authorization, new RegExp(`^Bearer <token, ${token.length} characters, kept on the server>$`));
  // A key passed as the bearer the same way is hidden too.
  const t2 = oboGatewayTrace({ token: fakeKey, tool: "SearchIndexTool", config: DEFAULT_CONFIG, result });
  assert.ok(!JSON.stringify(t2).includes(fakeKey));
});

test("with Real not configured no real trace exists: Real stays refused (a real gateway reports no per-check detail)", async () => {
  await withServer(async (post) => {
    assert.equal((await post("/api/mode", { source: "real" })).status, 409);
  });
});
