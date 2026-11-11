import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, readState } from "../server/src/index.js";
import * as pf from "../server/src/pf.js";

const HOST = "localhost:7812";
const PORT = 0;

async function withServer(fn) {
  process.env.LAB_ALLOWED_HOSTS = "localhost:7812,127.0.0.1:7812";
  const app = buildServer();
  const srv = app.listen(PORT, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const addr = srv.address();
  const base = `http://127.0.0.1:${addr.port}`;
  const j = async (p, b, method = "POST") => {
    const res = await fetch(base + p, {
      method,
      headers: { "content-type": "application/json", ...(method !== "GET" && b ? { origin: base } : {}) },
      body: method === "GET" ? undefined : JSON.stringify(b || {})
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn(j, base);
  } finally {
    srv.close();
  }
}

test("health contract", async () => {
  await withServer(async (j, base) => {
    const res = await fetch(base + "/api/health", { headers: { host: HOST } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.contract, "demo-health/1");
    assert.equal(body.source, "mock");
  });
});

test("happy path runs the full chain with user in sub and agent in act.sub", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "happy-read" });
    assert.equal(r.status, 200);
    assert.equal(r.body.http, 200);
    assert.equal(r.body.ok, true);
    const stages = r.body.hops.map((h) => h.stage);
    assert.deepEqual(stages, ["nhi", "grant", "cedar", "backend", "done"]);
    assert.match(r.body.hops.at(-1).reason, /sub=priya\.nair/);
    assert.match(r.body.hops.at(-1).reason, /act\.sub=agent-client-example/);
  });
});

test("admin tier allows ClusterHealthTool", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "happy-admin" });
    assert.equal(r.body.http, 200);
  });
});

test("cedar-block: Active policy refuses SearchIndexTool without the scope", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "cedar-block" });
    assert.equal(r.body.http, 400);
    const stopped = r.body.hops.at(-1);
    assert.match(stopped.reason, /-32600/);
    assert.match(stopped.reason, /scope-search-guard/);
  });
});

test("act emitted as text is refused at the NHI with the measured log reason", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "act-text" });
    assert.equal(r.body.http, 401);
    assert.match(r.body.hops[0].reason, /required claim "act\.sub" does not match/);
  });
});

test("wrong audience is refused at the NHI", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "wrong-audience" });
    assert.equal(r.body.http, 401);
    assert.match(r.body.hops[0].reason, /audience/);
  });
});

test("no matching grant rule is a bare 403", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "no-grant" });
    assert.equal(r.body.http, 403);
    assert.match(r.body.hops[1].reason, /policy denied/);
  });
});

test("garbage bearer is 401 at sign-in", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "garbage" });
    assert.equal(r.body.http, 401);
    assert.match(r.body.hops[0].reason, /not a three-part token|bad signature/);
  });
});

test("autonomous shape (sub=agent, no act) is refused by the act.sub required claim", async () => {
  await withServer(async (j) => {
    const r = await j("/api/run", { scenario: "autonomous" });
    assert.equal(r.body.http, 401);
    assert.match(r.body.hops[0].reason, /required claim "act\.sub" does not match/);
  });
});

test("run records never contain a raw token", async () => {
  await withServer(async (j) => {
    for (const s of ["happy-read", "garbage", "cedar-block"]) {
      const r = await j("/api/run", { scenario: s });
      assert.ok(!JSON.stringify(r.body).includes("garbage.token.value"));
      assert.ok(r.body.token.hash && r.body.token.hash.length === 8);
    }
  });
});

test("mode: real refused 409, mock accepted", async () => {
  await withServer(async (j) => {
    const real = await j("/api/mode", { source: "real" });
    assert.equal(real.status, 409);
    const bad = await j("/api/mode", { source: "bogus" });
    assert.equal(bad.status, 400);
    const mock = await j("/api/mode", { source: "mock" });
    assert.equal(mock.status, 200);
    assert.equal(mock.body.source, "mock");
  });
});

test("info reports realAvailable false", async () => {
  await withServer(async (j, base) => {
    const res = await fetch(base + "/api/info", { headers: { host: HOST } });
    const body = await res.json();
    assert.equal(body.realAvailable, false);
    assert.equal(body.source, "mock");
  });
});

test("catalog serves steps, scenarios and issues", async () => {
  await withServer(async (j, base) => {
    const res = await fetch(base + "/api/catalog", { headers: { host: HOST } });
    const body = await res.json();
    assert.equal(body.steps.length, 7);
    assert.ok(body.opening && body.opening.headline && /MCP tool/.test(body.opening.headline));
    assert.equal(body.scenarios.length, 8);
    assert.ok(body.issues.length >= 10);
    assert.ok(body.does.length >= 5);
    assert.ok(body.cant.length >= 5);
  });
});

test("exchange refuses a bad subject token and mints OBO claims for a good one", async () => {
  await withServer(async (j) => {
    const bad = await j("/api/exchange", { subjectToken: "nope" });
    assert.equal(bad.status, 400);
    const subj = await j("/api/mint-subject", { user: "priya.nair" });
    assert.equal(subj.status, 200);
    const ex = await j("/api/exchange", { subjectToken: subj.body.token });
    assert.equal(ex.status, 200);
    assert.equal(ex.body.claims.sub, "priya.nair");
    assert.equal(ex.body.claims.act.sub, "agent-client-example");
  });
});

test("host check refuses unknown non-loopback hosts", async () => {
  const app = buildServer();
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;
  // Use node:http directly: fetch forbids setting the Host header.
  const { request } = await import("node:http");
  const status = await new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/health", headers: { host: "evil.example.com" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.end();
  });
  assert.equal(status, 403);
  srv.close();
});

test("cross-origin write refused (origin mismatch)", async () => {
  const app = buildServer();
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, origin: "http://evil.example.com" },
    body: JSON.stringify({ scenario: "happy-read" })
  });
  assert.equal(res.status, 403);
  srv.close();
});

test("reset clears runs", async () => {
  await withServer(async (j) => {
    await j("/api/run", { scenario: "happy-read" });
    assert.ok(readState().runs.length > 0);
    await j("/api/reset");
    assert.equal(readState().runs.length, 0);
  });
});

test("pf verify: signature check and decode", () => {
  const t = pf.mintOboToken({ user: "u", agent: "a", clientId: "c", audience: "x", scope: "s", issuer: "i" });
  assert.equal(pf.verify(t).ok, true);
  assert.equal(pf.verify("garbage.token.value").ok, false);
  assert.equal(pf.verify("garbage.token.value").reason, "bad signature");
  const tampered = t.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  assert.equal(pf.verify(tampered).ok, false);
  assert.equal(pf.verify(tampered).reason, "bad signature");
});
