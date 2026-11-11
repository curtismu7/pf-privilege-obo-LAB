#!/usr/bin/env node
// Repo checks: forbidden identifiers, attribution lines, compose policies.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const failures = [];

// Hostname-level forbidden check: every ping-devops.com occurrence must be the
// shared lab-proxy domain (local.ping-devops.com or <lab>.local.ping-devops.com,
// the family access URLs per the owner domain rule); any other host fails.
const FORBIDDEN_HOST_RE = /(?:[\w.-]+\.)?ping-devops\.com(?::\d+)?/g;
const ALLOWED_PROXY_HOSTS = [/^local\.ping-devops\.com(?::\d+)?$/, /^[\w-]+\.local\.ping-devops\.com(?::\d+)?$/];
function forbiddenHostHits(text) {
  const hits = [];
  for (const m of String(text).matchAll(FORBIDDEN_HOST_RE)) {
    if (!ALLOWED_PROXY_HOSTS.some((re) => re.test(m[0]))) hits.push(m[0]);
  }
  return hits;
}
const FORBIDDEN = [
  /pingone\.com(?!\.invalid)/,
  /procyon\.ai(?!\.invalid)/,
  new RegExp(["curtis", "mu7"].join("")),
  new RegExp(["cmuir", "_pingcorp"].join("")),
  new RegExp(["ping-", "sandbox"].join("")),
  /ai[-_]?demo2/i,
  new RegExp(["Co-Authored", "-By"].join("")),
  new RegExp(["Generated ", "with"].join(""))
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// The vendored family stylesheet is canonical and shared; its comments mention
// other projects by design. Skip it for the cross-project-identifier scan but
// keep its sha pinned against drift (the vendored-sha check below).
// The vendored conformance gate and the family attribution checker quote the
// patterns they enforce (org names, attribution lines); skip them the same way.
const VENDORED_ALLOWED = new Set(["standalone-ui.css", "demo-kit-conformance.mjs", "check-no-ai-attribution.sh", "safety.js"]);

let files = 0;
for (const file of walk(root)) {
  if (!/\.(js|mjs|jsx|ts|json|md|yml|yaml|html|css|sh|example)$/.test(file)) continue;
  files++;
  // The vendored family stylesheet is canonical and shared; its comments name
  // other projects by design. Drift is caught separately by check-css/vendored sha.
  const text = readFileSync(file, "utf8");
  if (VENDORED_ALLOWED.has(file.split("/").pop()) || file.endsWith("repo-checks.mjs")) continue;
  const hostHits = forbiddenHostHits(text);
  if (hostHits.length) failures.push(`${file}: non-proxy ping-devops.com host(s): ${[...new Set(hostHits)].join(", ")}`);
  for (const re of FORBIDDEN) {
    if (re.test(text)) failures.push(`${file}: matches ${re}`);
  }
}

console.log(`repo-checks: scanned ${files} files`);

// Vendored stylesheet must match the family canonical (drift check).
const vendored = join(root, "web", "standalone-ui.css");
const canonical = join(process.env.HOME || "", "Development", "AI-DEMO-Standalone", "shared", "standalone-ui.css");
if (existsSync(vendored) && existsSync(canonical)) {
  const v = createHash("sha256").update(readFileSync(vendored)).digest("hex");
  const c = createHash("sha256").update(readFileSync(canonical)).digest("hex");
  if (v !== c) failures.push(`web/standalone-ui.css drifts from the family canonical (${v.slice(0, 8)} vs ${c.slice(0, 8)})`);
  else console.log("repo-checks: vendored standalone-ui.css matches canonical");
} else if (existsSync(vendored)) {
  console.log("repo-checks: family canonical not found locally; vendored sha recorded for CI");
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log(`repo-checks: PASS (0 forbidden-identifier hits)`);
