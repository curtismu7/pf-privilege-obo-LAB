// Run observability (rule 27), the lab's own half. The shared collector (runObservability.js, vendored byte for byte) is never edited.
//
//   1. createRunLog keeps the decisions THIS lab made or was told about on the latest run of each mode (in memory) and writes each one
//      as ONE timestamped stdout line: actor and result, never a token. That line is what a collector can ship.
//   2. observeMockRun / observeRealRun turn what a run actually computed or received into those decisions. Mock: from the hops runChain
//      computed. Real: from the frames oboReal.js received (PingFederate's replies, the door's HTTP status). Nothing is added that the
//      run did not compute or receive.
//   3. buildRunRecord hands them to the shared collector: Mock rows are `simulated`; Real rows are `response` (a reply the lab received,
//      never presented as read from a log) plus whatever the log readers find `logged` (`not-logged` when absent, never invented).
//
// Stdout line: `[<iso>] INFO: pf-privilege-obo-lab decision layer=<layer> check=<check> actor=<who> result=<passed|stopped|unclear> mode=<mode>`.
// The family's MCP-server matcher reads a `[time] INFO|WARN:` line for words such as token, audience, scope, served, refused, denied,
// forbidden, unauthorized, invalid, failed, expired, mismatch and rejected, so the lab's own lines use none of them (result=stopped, never
// refused). NO shared matcher reads these lines, so one can never become a `logged` row on the wrong layer; they are for a collector and
// a SIEM. A test runs every kind of line through the shared classify() for every product and expects null.
import { createRunObservability } from './runObservability.js';
import { readersFromEnv } from './runObservabilityReaders.js';

const text = (v, n = 240) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, n);
// A value that goes INTO a stdout line: only safe characters survive, so a claim cannot add a fake key=value pair, a quote or a newline.
export const lineValue = (v, n = 80) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || 'unknown';
const RESULT = { allowed: 'passed', refused: 'stopped', info: 'unclear', blocked: 'stopped' };

// Real log lines can arrive a little after the run (a collector's delay) and the products' clocks are not this host's clock: the window
// reaches this far past the last decision. Window-matched rows are tagged as such by the collector.
const GRACE_MS = 5000;

export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = () => Date.now() } = {}) {
  const latest = { mock: null, real: null };

  // One run: every event is stamped once (its own `at`, else now); the stdout line and the row carry that same time.
  function recordRun({ source, runId, startedAt, events }) {
    const run = { source, runId, startedAt: startedAt || new Date(clock()).toISOString(), events: [] };
    // A Mock run is computed in one call, so its decisions would all share one millisecond and the panel could not keep the order the checks ran in:
    // an event with no time of its own gets the next millisecond after the one before it (they are simulated rows and say so).
    const t0 = clock();
    let n = 0;
    for (const e of events) {
      const at = e.at || new Date(t0 + n++).toISOString();
      const ev = { ...e, at };
      run.events.push(ev);
      write(`[${at}] ${ev.level === 'WARN' ? 'WARN' : 'INFO'}: pf-privilege-obo-lab decision layer=${lineValue(ev.layer ?? 'none', 12)} check=${lineValue(ev.check)} actor=${lineValue(ev.actor)} result=${ev.result || RESULT[ev.outcome] || 'unclear'} mode=${lineValue(source, 8)}`);
    }
    latest[source] = run;
    return run;
  }

  return { recordRun, forSource: (source) => latest[source] ?? null, reset: () => { latest.mock = null; latest.real = null; } };
}

// ---- Runs -> decisions -------------------------------------------------------------------------------------------------------------
// who: { sub, actor } read from the run's decoded claims (never a token).
// Mock: runChain's hops, in the order it ran them. A check an earlier refusal never reached has no hop and so no row.
export function observeMockRun({ run, who = {}, minted = true }) {
  const out = [];
  const actor = who.actor || who.sub || 'unknown';
  const base = { actor, sub: who.sub };
  // A person signed in only when the token has an actor: the autonomous shape (sub = the agent, no act) has no person, so it gets no sign-in row.
  if (minted && run.subjectToken && who.actor) {
    out.push({ ...base, actor: who.sub || 'unknown', layer: 'person', check: 'sign-in', outcome: 'allowed', product: 'lab mock issuer',
      message: `Mock sign-in of ${text(who.sub, 60)}: the mock issuer minted a person token`, detail: {} });
  }
  if (minted) {
    out.push(who.actor
      ? { ...base, actClient: who.actor, layer: 'agent', check: 'exchange', outcome: 'allowed', product: 'lab mock issuer',
        message: `Mock exchange: the mock issuer issued an access token for ${text(who.sub, 60)} acting as ${text(who.actor, 60)}`, detail: {} }
      : { ...base, layer: 'agent', check: 'exchange', outcome: 'info', product: 'lab mock issuer',
        message: 'Mock issuer issued an access token with no actor (act) claim; its subject is the agent itself, with no person behind it', detail: {} });
  }
  const ROW = { nhi: ['gateway', 'workload identity'], grant: ['privilege', 'grant'], cedar: ['privilege', 'AI policy (Cedar)'], backend: ['resource', 'backend verification'] };
  // What a pass means: cedarCheck returns ok when no policy applied, so the row says no policy refused the call, not that a policy passed it.
  const PASSED = { nhi: 'The workload identity check passed', grant: 'The grant check passed', cedar: 'No AI policy (Cedar) refused the call', backend: 'The backend verified the forwarded token' };
  for (const hop of run.hops) {
    const where = ROW[hop.stage];
    if (!where) continue;
    out.push({ ...base, layer: where[0], check: hop.stage, outcome: hop.ok ? 'allowed' : 'refused', product: `lab mock ${where[0] === 'resource' ? 'backend' : 'Privilege door'}`,
      message: hop.ok ? PASSED[hop.stage] : `The ${where[1]} check stopped the call: ${text(hop.reason, 160)}`,
      detail: { http: run.http } });
  }
  return out;
}

// Real: one event per frame the lab received (a skipped frame made no call, so it has no row). `at` is when the lab had the reply.
const FRAME = {
  signin: { layer: 'person', check: 'sign-in', product: 'PingFederate sign-in reply' },
  exchange: { layer: 'agent', check: 'exchange', product: 'PingFederate token endpoint reply' },
  door: { layer: 'gateway', check: 'door', product: 'Privilege door reply' },
  whoami: { layer: 'resource', check: 'backend-report', product: 'backend reply through the gateway' },
  refused: { layer: 'gateway', check: 'control', product: 'Privilege door reply' },
};
const OUTCOME = { ok: 'allowed', refused: 'refused', error: 'info' };

export function observeRealRun({ run }) {
  const out = [];
  // Ids come from the claims the lab received: the person's sub from the sign-in's ID token (else the exchange's), the actor only from an act claim.
  const signin = run.frames.find((f) => f.id === 'signin' && f.token?.claims);
  const exchange = run.frames.find((f) => f.id === 'exchange' && f.token?.claims);
  const sub = signin?.token.claims.sub || exchange?.token.claims.sub;
  const actClient = exchange?.token.claims.act?.sub;
  const actor = actClient || sub;
  for (const f of run.frames) {
    const spec = FRAME[f.id];
    const outcome = OUTCOME[f.state];
    if (!spec || !outcome) continue;
    let layer = spec.layer;
    const said = text(f.summary, 200).replace(/[.\s]+$/, '');
    let message = `${f.title}: ${said}. This is a reply the lab received, not a log line`;
    // A whoami call the gateway refused is the gateway's decision; only an answered call is the backend's report.
    if (f.id === 'whoami' && f.state !== 'ok') layer = 'gateway';
    if (f.id === 'refused') message = `Control: the same call with a made-up token. ${said}. This is a reply the lab received, not a log line`;
    out.push({ at: f.at, layer, check: spec.check, outcome, level: f.state === 'error' ? 'WARN' : undefined, product: spec.product, actor: f.id === 'signin' ? sub : actor, actClient, sub, message,
      detail: { frame: f.n, status: f.response?.status, ...(f.id === 'refused' ? { control: true } : {}) } });
  }
  return out;
}

// ---- The record --------------------------------------------------------------------------------------------------------------------
const NO_AUTHORIZE = 'This lab does not call PingOne Authorize, so there is no Authorize decision to show.';
const NO_PRIVILEGE_MOCK = 'The lab mock reports grant and AI policy checks on the Privilege layer; it has no AI Guard or approval event.';
const NOT_YET = {
  person: 'No sign-in ran on this run.',
  agent: 'No token exchange ran on this run.',
  gateway: 'The door was not reached on this run.',
  resource: 'The backend was not reached on this run: an earlier check stopped the call, or this shape does not ask the backend.',
};

const pick = (events, layer) => events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: e.detail }));

export async function buildRunRecord({ run, readers = readersFromEnv(), clock = () => Date.now() }) {
  const { source, events } = run;
  const obs = createRunObservability({ readers, clock });
  const sub = events.find((e) => e.sub)?.sub;
  const actor = events.find((e) => e.actClient)?.actClient;
  let layers;
  if (source === 'mock') {
    layers = [
      { layer: 'person', simulated: pick(events, 'person'), reason: NOT_YET.person },
      { layer: 'agent', simulated: pick(events, 'agent'), reason: NOT_YET.agent },
      { layer: 'authorize', simulated: [], reason: NO_AUTHORIZE },
      { layer: 'privilege', simulated: pick(events, 'privilege'), reason: NO_PRIVILEGE_MOCK },
      { layer: 'gateway', simulated: pick(events, 'gateway'), reason: NOT_YET.gateway },
      { layer: 'resource', simulated: pick(events, 'resource'), reason: NOT_YET.resource },
    ];
  } else {
    layers = [
      { layer: 'person', products: ['pingfederate'], responses: pick(events, 'person') },
      { layer: 'agent', products: ['pingfederate', 'privilege-gateway'], responses: pick(events, 'agent') },
      { layer: 'authorize', products: [], reason: NO_AUTHORIZE },
      { layer: 'privilege', products: ['privilege-siem', 'privilege-gateway'] },
      { layer: 'gateway', products: ['privilege-gateway'], responses: pick(events, 'gateway') },
      { layer: 'resource', products: ['mcp-server'], responses: pick(events, 'resource') },
    ];
  }
  const last = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), Date.parse(run.startedAt) || 0);
  return obs.collectRun({
    runId: run.runId,
    startedAt: run.startedAt,
    endedAt: new Date(last + (source === 'real' ? GRACE_MS : 0)).toISOString(),
    correlation: { sub, actClientId: actor },
    layers,
    source,
  });
}
