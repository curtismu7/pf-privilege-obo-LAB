#!/usr/bin/env node
// Preflight: ports, health, the mock run behaves as written, reset works.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

// Netguard self-test: every route out is refused and recorded (rule 1).
const ng = await import(new URL("../server/src/netguard.js", import.meta.url));
const ngResult = await ng.netguardSelfTest();
console.log(`${ngResult.ok ? "PASS" : "FAIL"} netguard self-test (${ngResult.blocked}/7 routes blocked)${ngResult.ok ? "" : ` — ${ngResult.detail}`}`);
if (!ngResult.ok) failures++;

// Use a doctor-only port so the check never collides with a running lab.
const PORT = Number(process.env.DOCTOR_PORT || 17812);
const base = `http://127.0.0.1:${PORT}`;
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const server = spawn(process.execPath, ["server/src/index.js"], {
  env: { ...process.env, PORT: String(PORT), LAB_ALLOWED_HOSTS: `localhost:${PORT},127.0.0.1:${PORT}` },
  stdio: "ignore"
});

try {
  let healthy = false;
  for (let i = 0; i < 40 && !healthy; i++) {
    await sleep(250);
    try {
      const r = await fetch(`${base}/api/health`);
      healthy = r.status === 200;
    } catch {}
  }
  ok("server healthy", healthy);

  const health = await (await fetch(`${base}/api/health`)).json();
  ok("health contract", health.contract === "demo-health/1");

  const info = await (await fetch(`${base}/api/info`)).json();
  ok("info reports mock", info.source === "mock" && info.realAvailable === false);

  const runRes = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ scenario: "happy-read" })
  });
  const run = await runRes.json();
  ok("happy run 200 with full chain", run.http === 200 && run.hops && run.hops.length === 5);
  ok("run shows sub=user act.sub=agent", run.hops && run.hops.length > 0 && /sub=priya\.nair/.test(run.hops.at(-1).reason) && /act\.sub=/.test(run.hops.at(-1).reason));

  const cedarRes = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ scenario: "cedar-block" })
  });
  const cedar = await cedarRes.json();
  ok("cedar block 400 with policy name", cedar.http === 400 && /scope-search-guard/.test(cedar.hops.at(-1).reason));

  const real = await fetch(`${base}/api/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "real" })
  });
  ok("real mode refused 409", real.status === 409);

  await fetch(`${base}/api/reset`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" });
  const runs = await (await fetch(`${base}/api/runs`)).json();
  ok("reset clears runs", runs.runs.length === 0);
} finally {
  server.kill();
}

console.log(failures ? `doctor: ${failures} FAIL` : "doctor: all checks PASS");
process.exit(failures ? 1 : 0);
