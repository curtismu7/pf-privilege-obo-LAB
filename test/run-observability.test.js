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
import { lineValue, observeRealRun, buildRunRecord, createRunLog } from "../server/src/runLog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the vendored run-observability files match the pin; this lab reads logs in Real, so it vendors both server files", () => {
  assert.deepEqual(checkPin(root), []);
  assert.ok(existsSync(join(root, "server/src/runObservability.js")));
  assert.ok(existsSync(join(root, "server/src/runObservabilityReaders.js")));
  assert.ok(!existsSync(join(root, "web/src/run-observability/runObservability.js")), "the core is a server file only");
  const core = readFileSync(join(root, "server/src/runObservability.js"), "utf8");
  assert.ok(!/^\s*import\s/m.test(core), "the core has no imports");
});

test("compose never mounts the Docker socket; the read key and URL are passed through EMPTY by default (a default of http://x.example:9200 fails)", () => {
  for (const file of ["docker-compose.yml", ".env.example"]) {
    const text = readFileSync(join(root, file), "utf8");
    const code = text.replace(/#.*$/gm, "");
    assert.ok(!/docker\.sock/.test(code), `${file} mounts no Docker socket`);
    for (const name of ["RUN_OBS_ES_URL", "RUN_OBS_ES_READ_APIKEY"]) {
      const lines = code.split("\n").filter((l) => new RegExp(`(^|[\\s-])${name}\\s*=`).test(l));
      assert.ok(lines.length >= 1, `${file} names ${name}`);
      // compose: `- NAME=${NAME:-}` (empty default); .env.example: `NAME=` (nothing after the sign). Any default value, in either, fails.
      for (const l of lines) assert.match(l.trim(), file === "docker-compose.yml" ? new RegExp(`^- ${name}=\\$\\{${name}:-\\}$`) : new RegExp(`^${name}=$`), `${file}: ${name} must default to empty: ${l.trim()}`);
    }
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
    return { status: res.status, note: res.headers.get("x-run-observability-note"), body: res.status === 204 ? null : await res.json() };
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
    const LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] (INFO|WARN): pf-privilege-obo-lab decision layer=[a-z]+ check=[A-Za-z0-9._:/@-]+ actor=[A-Za-z0-9._:/@-]+ result=(passed|stopped|unclear|no-reply) mode=(mock|real)$/;
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

test("Mock autonomous run: there is no person, so no sign-in row and no actor to correlate; the access token row says there is no actor", async () => {
  await withMock(async (j, lines) => {
    await j("/api/run", { scenario: "autonomous" });
    const rec = (await j("/api/run-observability", null, "GET")).body;
    assert.deepEqual(assertRunObservability(rec), []);
    assert.equal(rec.coverage.person, "not-logged");
    // A client-credentials issuance, not an exchange and not a decision.
    assert.equal(rowsOf(rec, "agent")[0].outcome, "info");
    assert.match(rowsOf(rec, "agent")[0].message, /client-credentials token was issued for .*; there is no act claim/);
    assert.ok(!lines.some((l) => /layer=person/.test(l)), "no person line either");
    assert.ok(!lines.some((l) => /check=exchange/.test(l)), "the autonomous line does not read as an exchange");
    assert.ok(lines.some((l) => /layer=agent check=client-credentials/.test(l)));
  });
});

test("Mock Cedar pass is worded as 'no policy refused', not 'a policy passed it'", async () => {
  await withMock(async (j) => {
    await j("/api/run", { scenario: "happy-read" });
    const rec = (await j("/api/run-observability", null, "GET")).body;
    assert.ok(rowsOf(rec, "privilege").some((r) => /No AI policy \(Cedar\) refused the call/.test(r.message)));
  });
});

test("Real: a raw token or bearer echoed in an upstream message never reaches the record or its correlation ids; a failed exchange leaves no actor id", async () => {
  const jwt = `eyJhbGciOiJub25lIn0.${Buffer.from('{"sub":"leak-me-please"}').toString("base64url")}.sig-value-1`;
  const at = "2026-11-22T10:00:00.000Z";
  const run = { source: "real", runId: "run-x", startedAt: at, user: "typed-user-name", frames: [
    { n: 1, id: "signin", title: "Sign in", state: "ok", at, summary: "Signed in", token: { claims: { sub: "person-sub-123456" } }, response: { status: 200 } },
    { n: 2, id: "exchange", title: "Exchange", state: "error", at, summary: `PingFederate refused the exchange (HTTP 400): saw Bearer ${jwt} and ${jwt}`, response: { status: 400 } },
  ] };
  const lines = [];
  const stored = createRunLog({ write: (l) => lines.push(l) }).recordRun({ source: "real", runId: run.runId, startedAt: at, events: observeRealRun({ run }) });
  const rec = await buildRunRecord({ run: stored, readers: [], clock: () => Date.parse(at) + 1000 });
  assert.deepEqual(assertRunObservability(rec), []);
  const text = JSON.stringify(rec) + lines.join("\n");
  assert.ok(!text.includes(jwt) && !text.includes("leak-me-please") && !/Bearer eyJ/.test(text), "no token in the record or a stdout line");
  assert.ok(!text.includes("typed-user-name"), "the configured user name is not written to a line");
  assert.ok(stored.events.every((e) => e.actClient === undefined), "no actor id without an act claim");
  assert.equal(rec.rows.find((r) => r.layer === "agent").outcome, "info");
});

// ---- review fixes --------------------------------------------------------------------------------------------------------------

test("Mock act-text: act is the string \"{}\", never read as an object: the row says the act claim is malformed, no actor is named, and no function text reaches a row or a line", async () => {
  await withMock(async (j, lines) => {
    await j("/api/run", { scenario: "act-text" });
    const rec = (await j("/api/run-observability", null, "GET")).body;
    assert.deepEqual(assertRunObservability(rec), []);
    const agent = rowsOf(rec, "agent")[0];
    assert.equal(agent.outcome, "allowed", "the mock issuer issued the exchanged token");
    assert.match(agent.message, /act claim is not an object with a string sub \(it is text\), so it names no actor/);
    assert.ok(!/acting as/.test(agent.message));
    const all = JSON.stringify(rec) + lines.join("\n");
    assert.ok(!/function|native code/i.test(all), "no String.prototype.sub text");
    assert.equal(rowsOf(rec, "person")[0].outcome, "info", "the sign-in happened (an issuance), the person is the subject");
    assert.equal(rowsOf(rec, "gateway")[0].outcome, "refused", "the workload identity check refuses the malformed act");
    assert.ok(lines.every((l) => /actor=[A-Za-z0-9._:/@-]+ /.test(l) && !/actor=function/.test(l)));
  });
});

test("observeRealRun: a malformed act (text) names no actor and its sub is never read as a function", () => {
  const at = "2026-11-22T10:00:00.000Z";
  const run = { user: "u", frames: [
    { n: 1, id: "signin", title: "Sign in", state: "ok", at, summary: "Signed in", token: { claims: { sub: "person-sub-123456" } }, response: { status: 200 } },
    { n: 2, id: "exchange", title: "Exchange", state: "ok", at, summary: "Issued", token: { claims: { sub: "person-sub-123456", act: "{}" } }, response: { status: 200 } },
  ] };
  const ev = observeRealRun({ run });
  assert.ok(ev.every((e) => e.actClient === undefined), "no actor id from a text act");
  assert.ok(!JSON.stringify(ev).includes("native code"));
  assert.ok(ev.every((e) => typeof e.actor === "string"));
});

test("only a policy point's decision is allowed or refused: the sign-in is information, the Cedar block counts one refusal", async () => {
  await withMock(async (j) => {
    await j("/api/run", { scenario: "cedar-block" });
    const rec = (await j("/api/run-observability", null, "GET")).body;
    assert.deepEqual(rec.summary, { allowed: 3, refused: 1, blocked: 0, info: 1, unverified: 0 });
    assert.deepEqual(rec.rows.filter((r) => r.origin === "simulated").map((r) => `${r.layer}:${r.outcome}`), ["person:info", "agent:allowed", "gateway:allowed", "privilege:allowed", "privilege:refused"]);
  });
});

test("a record is the run asked for: overlapping Mock runs never show each other's record, the last three are kept, an evicted run is a 204 with its reason", async () => {
  await withMock(async (j) => {
    const ids = [];
    for (const scenario of ["happy-read", "cedar-block", "wrong-audience", "no-grant"]) ids.push((await j("/api/run", { scenario })).body.id);
    const rec = (id) => j(`/api/run-observability?runId=${id}`, null, "GET");
    assert.equal((await rec(ids[3])).body.runId, ids[3]);
    const b = (await rec(ids[1])).body;
    assert.equal(b.runId, ids[1], "an earlier run is its own record while it is one of the last three");
    assert.equal(b.summary.refused, 1);
    const evicted = await rec(ids[0]);
    assert.equal(evicted.status, 204, "never a newer run's record");
    assert.equal(evicted.note, "No run with that id in this mode");
    assert.equal((await j("/api/run-observability", null, "GET")).body.runId, ids[3], "no runId: the newest finished run");
    assert.equal((await j("/api/run-observability?runId=bad%20id", null, "GET")).status, 400);
    assert.equal((await j(`/api/run-observability?runId=${"x".repeat(65)}`, null, "GET")).status, 400);
  });
});

test("Mock events are stamped once with the real clock, with no invented spacing: a run computed in one instant shares one time, in write order", async () => {
  const lines = [];
  const log = createRunLog({ write: (l) => lines.push(l), clock: () => Date.parse("2026-11-22T10:00:00.000Z") });
  const run = log.recordRun({ source: "mock", runId: "run-1-1", events: ["gateway", "privilege", "resource"].map((layer) => ({ layer, check: layer, actor: "a", outcome: "allowed", product: "p", message: "m", detail: {} })) });
  assert.deepEqual([...new Set(run.events.map((e) => e.at))], ["2026-11-22T10:00:00.000Z"]);
  const rec = await buildRunRecord({ run: { ...run, events: [{ ...run.events[2] }, { ...run.events[0] }, { ...run.events[1] }] }, readers: [], clock: () => Date.parse("2026-11-22T10:00:00.000Z") });
  assert.deepEqual(rec.rows.filter((r) => r.at).map((r) => r.layer), ["gateway", "privilege", "resource"], "equal times list the Mock layers in the order the checks run");
});
