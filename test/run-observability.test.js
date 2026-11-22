// Rule 27 for the lab: the pin, the decision lines, and the Mock record (the Real record is tested beside the Real run stub in obo-real.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildServer } from "../server/src/index.js";
import { assertRunObservability, classify, layerMatchers } from "../server/src/runObservability.js";
import { checkPin } from "../scripts/run-observability-checkPin.mjs";
import { lineValue, observeRealRun } from "../server/src/runLog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the vendored run-observability files match the pin; this lab reads logs in Real, so it vendors both server files", () => {
  assert.deepEqual(checkPin(root), []);
  assert.ok(existsSync(join(root, "server/src/runObservability.js")));
  assert.ok(existsSync(join(root, "server/src/runObservabilityReaders.js")));
  assert.ok(!existsSync(join(root, "web/src/run-observability/runObservability.js")), "the core is a server file only");
  const core = readFileSync(join(root, "server/src/runObservability.js"), "utf8");
  assert.ok(!/^\s*import\s/m.test(core), "the core has no imports");
});

test("compose never mounts the Docker socket; the read key and URL are passed through empty by default", () => {
  for (const file of ["docker-compose.yml", ".env.example"]) {
    const text = readFileSync(join(root, file), "utf8");
    assert.ok(!/docker\.sock/.test(text.replace(/#.*$/gm, "")), `${file} mounts no Docker socket`);
    assert.match(text, /RUN_OBS_ES_URL/, `${file} names RUN_OBS_ES_URL`);
    assert.match(text, /RUN_OBS_ES_READ_APIKEY/, `${file} names RUN_OBS_ES_READ_APIKEY`);
  }
  assert.ok(!/RUN_OBS_DOCKER\s*[:=]\s*["']?1/.test(readFileSync(join(root, "docker-compose.yml"), "utf8")), "the Docker reader stays off in the committed compose file");
});

test("a vendored byte edited, or a file added to the vendored folders without the pin, fails the pin check", () => {
  const copy = mkdtempSync(join(realpathSync(process.env.TMPDIR || tmpdir()), "obo-pin-"));
  try {
    const files = ["server/src/runObservability.js", "server/src/runObservabilityReaders.js", "web/src/run-observability/RunObservability.jsx", "web/src/run-observability/run-observability.css",
      "web/src/run-observability/run-observability.test.jsx", "web/src/run-observability/fixtures.js", "web/src/run-observability/run-observability.sha256"];
    for (const f of files) { mkdirSync(dirname(join(copy, f)), { recursive: true }); copyFileSync(join(root, f), join(copy, f)); }
    assert.deepEqual(checkPin(copy), []);
    writeFileSync(join(copy, "server/src/runObservability.js"), `${readFileSync(join(copy, "server/src/runObservability.js"), "utf8")}\n// edited`);
    assert.ok(checkPin(copy).some((p) => /runObservability\.js/.test(p)), "an edited core fails");
    copyFileSync(join(root, "server/src/runObservability.js"), join(copy, "server/src/runObservability.js"));
    writeFileSync(join(copy, "web/src/run-observability/extra.js"), "export {}");
    assert.ok(checkPin(copy).some((p) => /extra\.js/.test(p)), "an unpinned file in the vendored folder fails");
  } finally { rmSync(copy, { recursive: true, force: true }); }
});

// ---- the Mock record through the API -----------------------------------------------------------------------------------------

async function withMock(fn, opts = {}) {
  process.env.LAB_ALLOWED_HOSTS = "localhost:7812,127.0.0.1:7812";
  process.env.PFO_ENV_FILE = "/dev/null";
  process.env.STANDALONE_ENV = "/dev/null";
  const lines = [];
  const srv = buildServer({ runLogWrite: (l) => lines.push(l), runObsReaders: [], ...opts }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.on("listening", r));
  const api = `http://127.0.0.1:${srv.address().port}`;
  const j = async (p, b, method = "POST") => {
    const res = await fetch(api + p, { method, headers: { "content-type": "application/json", ...(method !== "GET" ? { origin: api } : {}) }, body: method === "GET" ? undefined : JSON.stringify(b || {}) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  try { await fn(j, lines); } finally { srv.close(); delete process.env.PFO_ENV_FILE; delete process.env.STANDALONE_ENV; }
}
const rowsOf = (rec, layer) => rec.rows.filter((r) => r.layer === layer);

test("no run yet in this mode: 204, not an error", async () => {
  await withMock(async (j) => { assert.equal((await j("/api/run-observability", null, "GET")).status, 204); });
});

test("Mock happy run: every row is simulated, the layers the lab computed have rows, and the record passes assertRunObservability", async () => {
  await withMock(async (j) => {
    const run = (await j("/api/run", { scenario: "happy-read" })).body;
    assert.equal(run.ok, true);
    const { status, body: rec } = await j("/api/run-observability", null, "GET");
    assert.equal(status, 200);
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.source, "mock");
    assert.equal(rec.runId, run.id);
    assert.ok(rec.rows.every((r) => r.origin === "simulated" || r.origin === "not-logged"));
    for (const layer of ["person", "agent", "privilege", "gateway", "resource"]) assert.equal(rec.coverage[layer], "simulated", layer);
    assert.equal(rec.coverage.authorize, "not-logged");
    assert.match(rec.reasons.authorize, /does not call PingOne Authorize/);
    // The Privilege layer carries the grant and the AI policy, the gateway layer the workload-identity check, the resource layer the backend.
    assert.equal(rowsOf(rec, "privilege").length, 2);
    // The rows keep the order the checks ran in (a Mock run is computed in one call, so each decision gets the next millisecond).
    assert.deepEqual(rec.rows.filter((r) => r.origin === "simulated").map((r) => r.layer), ["person", "agent", "gateway", "privilege", "privilege", "resource"]);
    assert.ok(rec.rows.filter((r) => r.origin === "simulated").every((r) => r.outcome === "allowed" || r.outcome === "info"));
  });
});

test("Mock refusals: the layer the call stopped at says refused, and the layers it never reached say so (never an invented row)", async () => {
  await withMock(async (j) => {
    // A garbage bearer: refused at the workload-identity check; the lab minted no person token and no exchange.
    await j("/api/run", { scenario: "garbage" });
    let rec = (await j("/api/run-observability", null, "GET")).body;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.coverage.person, "not-logged");
    assert.equal(rec.coverage.agent, "not-logged");
    assert.equal(rowsOf(rec, "gateway")[0].outcome, "refused");
    assert.equal(rec.coverage.privilege, "not-logged", "an earlier refusal never reached the grant");
    assert.equal(rec.coverage.resource, "not-logged");

    // No grant: the workload-identity check passes, the grant refuses, the backend is never asked.
    await j("/api/run", { scenario: "no-grant" });
    rec = (await j("/api/run-observability", null, "GET")).body;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rowsOf(rec, "gateway")[0].outcome, "allowed");
    assert.equal(rowsOf(rec, "privilege")[0].outcome, "refused");
    assert.equal(rec.coverage.resource, "not-logged");
    assert.ok(rec.summary.refused >= 1);
  });
});

test("a record is always for the latest run in the current mode: a second run replaces it, Reset clears it", async () => {
  await withMock(async (j) => {
    const a = (await j("/api/run", { scenario: "happy-read" })).body;
    const b = (await j("/api/run", { scenario: "no-grant" })).body;
    const rec = (await j("/api/run-observability", null, "GET")).body;
    assert.equal(rec.runId, b.id);
    assert.notEqual(rec.runId, a.id);
    assert.equal((await j("/api/reset", {})).status, 200);
    assert.equal((await j("/api/run-observability", null, "GET")).status, 204);
  });
});

test("one stdout line per decision, with the row's own timestamp, the actor and the result, and never a token", async () => {
  await withMock(async (j, lines) => {
    await j("/api/run", { scenario: "happy-read" });
    const rec = (await j("/api/run-observability", null, "GET")).body;
    const simulated = rec.rows.filter((r) => r.origin === "simulated");
    assert.equal(lines.length, simulated.length, "one line for each decision row");
    const LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] (INFO|WARN): pf-privilege-obo-lab decision layer=[a-z]+ check=[A-Za-z0-9._:/@-]+ actor=[A-Za-z0-9._:/@-]+ result=(passed|stopped|unclear) mode=(mock|real)$/;
    for (const l of lines) {
      assert.match(l, LINE);
      assert.ok(!/eyJ|Bearer|secret|password/i.test(l), "no token or secret in a line");
      assert.ok(!/\b(refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served)\b/i.test(l), `a family matcher word in: ${l}`);
    }
    // The line and the row carry the same time (each event is stamped once).
    const stamps = new Set(lines.map((l) => /^\[([^\]]+)\]/.exec(l)[1]));
    for (const r of simulated) assert.ok(stamps.has(r.atExact ?? r.at), `row time ${r.at} is on a stdout line`);
  });
});

test("none of this lab's lines is read by any shared matcher (no row of the wrong layer can come from the lab's own output)", async () => {
  await withMock(async (j, lines) => {
    for (const scenario of ["happy-read", "garbage", "no-grant", "cedar-block"]) await j("/api/run", { scenario });
    assert.ok(lines.length >= 8);
    const products = [...new Set(layerMatchers.map((m) => m.product))];
    for (const l of lines) for (const product of products) assert.equal(classify({ product, message: l }), null, `${product} read: ${l}`);
  });
});

test("lineValue keeps a hostile actor from adding a key, a quote or a line", () => {
  assert.equal(lineValue("a b=c\nresult=passed \"x\""), "a_b_c_result_passed_x_", "no space, equals sign, quote or newline survives");
  assert.equal(lineValue(""), "unknown");
  assert.ok(lineValue("x".repeat(500)).length <= 80);
});

test("observeRealRun: a skipped frame makes no row; a refused control is marked as the control; a whoami the gateway refused is the gateway's row", () => {
  const at = "2026-11-22T10:00:00.000Z";
  const run = { user: "u", frames: [
    { n: 1, id: "signin", title: "Sign in", state: "ok", at, summary: "Signed in", response: { status: 200 } },
    { n: 2, id: "exchange", title: "Exchange", state: "ok", at, summary: "Issued", token: { claims: { sub: "stub-user-1", act: { sub: "agent-client-1" } } }, response: { status: 200 } },
    { n: 3, id: "door", title: "Door", state: "ok", at, summary: "Accepted", response: { status: 200 } },
    { n: 4, id: "whoami", title: "Whoami", state: "refused", at, summary: "Refused 403", response: { status: 403 } },
    { n: 5, id: "refused", title: "Control", state: "skipped", at, summary: "Skipped" },
  ] };
  const ev = observeRealRun({ run });
  assert.deepEqual(ev.map((e) => e.layer), ["person", "agent", "gateway", "gateway"]);
  assert.equal(ev[3].outcome, "refused");
  assert.ok(ev.every((e) => /reply the lab received/.test(e.message)));
});
