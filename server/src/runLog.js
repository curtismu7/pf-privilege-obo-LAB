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
// A closed run is kept per mode so a page that asks for ITS run id still gets it after the next run began (and never gets another run's record).
const KEEP_RUNS = 3;
// Only a string is an identifier: `"{}".sub` is String.prototype.sub, a function, so a malformed `act` (text) must never be read like an object.
const str = (v) => (typeof v === 'string' ? v : undefined);
// PingFederate's token endpoint refuses an exchange with these OAuth error codes. invalid_client (a wrong agent secret), invalid_request and any
// other 4xx are a configuration or request problem, not an exchange decision.
const EXCHANGE_REFUSALS = new Set(['invalid_grant', 'invalid_target', 'invalid_scope', 'access_denied']);

// Real log lines can arrive a little after the run (a collector's delay) and the products' clocks are not this host's clock: the window
// reaches this far past the last decision. Window-matched rows are tagged as such by the collector.
const GRACE_MS = 5000;

export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = () => Date.now() } = {}) {
  const runs = { mock: [], real: [] };

  // One run: every event is stamped once (its own `at`, else now); the stdout line and the row carry that same time.
  function recordRun({ source, runId, startedAt, events }) {
    const run = { source, runId, startedAt: startedAt || new Date(clock()).toISOString(), events: [] };
    for (const e of events) {
      // Stamped once, with the real clock: a Mock run is computed in one call, so decisions may tie; the record lists the Mock layers in the
      // order the checks ran, and the core keeps that order for equal times.
      const at = e.at || new Date(clock()).toISOString();
      const ev = { ...e, at };
      run.events.push(ev);
      write(`[${at}] ${ev.level === 'WARN' ? 'WARN' : 'INFO'}: pf-privilege-obo-lab decision layer=${lineValue(ev.layer ?? 'none', 12)} check=${lineValue(ev.check)} actor=${lineValue(ev.actor)} result=${ev.result || RESULT[ev.outcome] || 'unclear'} mode=${lineValue(source, 8)}`);
    }
    runs[source] = [...runs[source].filter((r) => r.runId !== runId), run].slice(-KEEP_RUNS);
    return run;
  }

  return {
    recordRun,
    // The newest finished run of a mode, or the run with that id if it is still one of the last few of that mode (null when evicted or never stored).
    forSource: (source, runId) => (runId === undefined ? runs[source].at(-1) : runs[source].find((r) => r.runId === runId)) ?? null,
    reset: () => { runs.mock = []; runs.real = []; },
  };
}

// ---- Runs -> decisions -------------------------------------------------------------------------------------------------------------
// who: { sub, actor } read from the run's decoded claims (never a token).
// Mock: runChain's hops, in the order it ran them. A check an earlier refusal never reached has no hop and so no row.
export function observeMockRun({ run, who = {}, minted = true }) {
  const out = [];
  const actor = who.actor || who.sub || 'unknown';
  const base = { actor, sub: who.sub };
  // Issuing a token is not a policy point's decision: a sign-in and a client-credentials issuance are `info`. Only the OBO exchange (the mock issuer
  // answered it with a token, as PingFederate does in Real) is `allowed`. who.actState: "object" (act.sub is a string), "malformed" (an act that
  // is not such an object, for example text) or "absent" (no act claim: the autonomous shape, sub = the agent, no person behind it).
  if (minted && run.subjectToken && who.actState !== 'absent') {
    out.push({ ...base, actor: who.sub || 'unknown', layer: 'person', check: 'sign-in', outcome: 'info', product: 'lab mock issuer',
      message: `Mock sign-in of ${text(who.sub, 60)}: the mock issuer issued a person token (an issuance, not a decision)`, detail: {} });
  }
  if (minted) {
    if (who.actState === 'object') {
      out.push({ ...base, actClient: who.actor, layer: 'agent', check: 'exchange', outcome: 'allowed', product: 'lab mock issuer',
        message: `Mock exchange: the mock issuer issued an access token for ${text(who.sub, 60)} acting as ${text(who.actor, 60)}`, detail: {} });
    } else if (who.actState === 'malformed') {
      out.push({ ...base, layer: 'agent', check: 'exchange', outcome: 'allowed', product: 'lab mock issuer',
        message: `Mock exchange: the mock issuer issued an access token for ${text(who.sub, 60)}, but its act claim is not an object with a string sub (it is text), so it names no actor`, detail: { act: 'malformed' } });
    } else {
      out.push({ ...base, layer: 'agent', check: 'client-credentials', outcome: 'info', product: 'lab mock issuer',
        message: `A client-credentials token was issued for ${text(who.sub, 60)}; there is no act claim, so no person is behind it`, detail: {} });
    }
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
const REPLY = 'This is a reply the lab received, not a log line';

export function observeRealRun({ run }) {
  const out = [];
  // Ids come from the claims the lab received: the person's sub from the sign-in's ID token (else the exchange's), the actor only from an act claim.
  const signin = run.frames.find((f) => f.id === 'signin' && f.token?.claims);
  const exchange = run.frames.find((f) => f.id === 'exchange' && f.token?.claims);
  const sub = str(signin?.token.claims.sub) || str(exchange?.token.claims.sub);
  const act = exchange?.token.claims.act;
  const actClient = act && typeof act === 'object' ? str(act.sub) : undefined;
  const actor = actClient || sub;
  for (const f of run.frames) {
    const spec = FRAME[f.id];
    let outcome = OUTCOME[f.state];
    if (!spec || !outcome) continue;
    let layer = spec.layer;
    const said = text(f.summary, 200).replace(/[.\s]+$/, '');
    let message = `${f.title}: ${said}. ${REPLY}`;
    // A completed sign-in is an issuance, not a decision.
    if (f.id === 'signin' && f.state === 'ok') { outcome = 'info'; message = `${f.title}: ${said}. An issuance, not a decision. ${REPLY}`; }
    // PingFederate's exchange: refused only for its refusal codes; any other failure is a configuration, request or transport problem.
    if (f.id === 'exchange' && f.state === 'error') {
      const code = /^[a-z_]{1,40}$/.test(f.response?.error ?? '') ? f.response.error : null;
      const status = f.response?.status;
      if (code && EXCHANGE_REFUSALS.has(code)) { outcome = 'refused'; message = `PingFederate refused the exchange: ${code} (HTTP ${status}). ${REPLY}`; }
      else message = typeof status === 'number' && status >= 400 && status < 500
        ? `PingFederate answered the exchange with HTTP ${status}${code ? ` (${code})` : ''}: a configuration or request problem, not an exchange decision. ${REPLY}`
        : `The exchange did not complete${typeof status === 'number' ? ` (HTTP ${status})` : ''}, so there is no exchange decision to show. ${REPLY}`;
    }
    // A whoami call the gateway refused is the gateway's decision; only an answered call is the backend's report.
    if (f.id === 'whoami' && f.state !== 'ok') layer = 'gateway';
    // The made-up-credential control is the lab's own check that the door refuses, not part of the person's or the agent's run: it stays a genuine door
    // answer (a 401 is the door's refusal) and says plainly that the lab sent it on purpose. The summary counts include it.
    if (f.id === 'refused') message = `Control: the lab sent a made-up credential on purpose; the door is expected to refuse it. ${said}. ${REPLY}`;
    // A call the run's deadline stopped was never made: there is no reply, and the row says so.
    if (f.deadline) message = `${f.title}: the run's deadline passed before this call could start, so it was not made. There is no reply to show`;
    // A call that got no reply (a timeout, a connection failure, a call the deadline stopped) is `no-reply` on the stdout line, not a decision.
    const noReply = f.state === 'error' && typeof f.response?.status !== 'number';
    out.push({ at: f.at, layer, check: spec.check, outcome, level: f.state === 'error' ? 'WARN' : undefined, ...(noReply ? { result: 'no-reply' } : {}), product: spec.product, actor: f.id === 'signin' ? sub : actor, actClient, sub, message,
      detail: { frame: f.n, status: f.response?.status, ...(f.id === 'exchange' && f.state === 'error' && typeof f.response?.error === 'string' ? { error: text(f.response.error, 40) } : {}), ...(f.id === 'refused' ? { control: true } : {}) } });
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
      // Listed in the order the checks ran (the core keeps this order for rows with the same time): gateway check, then grant and Cedar, then backend.
      { layer: 'gateway', simulated: pick(events, 'gateway'), reason: NOT_YET.gateway },
      { layer: 'privilege', simulated: pick(events, 'privilege'), reason: NO_PRIVILEGE_MOCK },
      { layer: 'resource', simulated: pick(events, 'resource'), reason: NOT_YET.resource },
      { layer: 'authorize', simulated: [], reason: NO_AUTHORIZE },
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
