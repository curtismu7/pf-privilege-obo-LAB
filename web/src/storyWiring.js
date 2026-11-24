// Story wiring: the lab's own glue between the shared Story engine (web/src/story/, vendored) and this page. It turns the script (storyScript.js) into engine
// steps and gives the engine a `host` that reads and drives the page: the Real run's frames and pop-outs, the run events. It never edits the page's own markup;
// it clicks the page's own buttons with script-made events (isTrusted is false, so Play for me is not mistaken for the viewer's own input).
//
// The page announces runs with pfo:run-start and pfo:run-end ({ ok }): ok is false only when the request itself failed. A run whose last frame is the refusal
// completes normally (the 401 is an expected frame), so it is a run that ended ok.

import { STEPS } from './storyScript.js';

const text = (el) => (el && el.textContent ? el.textContent.trim() : '');
const RUN_BTN = '[data-testid=real-obo-run]';

/** The first sentence, never cut mid-word (the video's first_sentence). */
export function firstSentence(s, limit = 150) {
  let t = String(s || '').trim().split('\n')[0] || '';
  const cut = t.indexOf('. ');
  if (cut > 0) t = t.slice(0, cut + 1);
  if (t.length <= limit) return t;
  const head = t.slice(0, limit);
  const sp = head.lastIndexOf(' ');
  return `${sp > 0 ? head.slice(0, sp) : head}...`;
}

export function createHost({ win = window, doc = document, mode = () => 'real', settleMs = 500 } = {}) {
  const runs = { starts: 0, ends: 0, lastOk: true };
  const waiters = new Set();   // each is (ok, reason) => void
  const timers = new Set();
  const watchers = new Set();  // onRun subscribers: told when a run starts or ends, so the bar can say whose turn it is
  const onStart = () => { runs.starts += 1; watchers.forEach((f) => f()); };
  const onEnd = (e) => {
    runs.ends += 1; runs.lastOk = e.detail ? e.detail.ok !== false : true;
    for (const w of [...waiters]) w(runs.lastOk);
    watchers.forEach((f) => f());
  };
  // A Reset clears the page: a step waiting for a run is told so (and the run's own end, which follows, finds nobody waiting).
  const onReset = () => { for (const w of [...waiters]) w(false, 'The page was reset. Press Next to carry on, or Exit.'); };
  win.addEventListener('pfo:run-start', onStart);
  win.addEventListener('pfo:run-end', onEnd);
  win.addEventListener('pfo:reset', onReset);

  const q = (sel) => doc.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (el) => { if (!el || el.disabled) throw new Error('the button is not available'); el.click(); };

  return {
    mode,
    query: q,
    mark: () => ({ starts: runs.starts, ends: runs.ends }),
    runStarted: (m) => runs.starts > m.starts,
    runInFlight: () => runs.starts > runs.ends,
    onRun: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
    waitForRun(m, timeoutMs) {
      return new Promise((resolve) => {
        const finish = (r) => { clearTimeout(t); timers.delete(t); waiters.delete(check); resolve(r); };
        const done = (ok, reason) => finish(ok ? { ok: true } : { ok: false, reason: reason || 'The run failed. Press Next to carry on, or Exit.' });
        const check = (ok, reason) => { if (reason || runs.ends > m.ends) done(ok, reason); };
        const t = setTimeout(() => finish({ ok: false, reason: 'The run did not finish in time. Press Next to carry on, or Exit.' }), timeoutMs);
        timers.add(t);
        if (runs.ends > m.ends) { done(runs.lastOk); return; }
        waiters.add(check);
      });
    },
    prefill(step) {
      if (!step.prompt || !step.prompt.text) return;
      const input = q(step.target);
      if (!input) return;
      input.value = step.prompt.text;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    },
    send(step) {
      // This lab has no typed question: a step whose prompt names a button clicks it, anything else clicks Run live.
      const sel = (step.prompt && step.prompt.press) || RUN_BTN;
      click(q(sel));
    },
    assetUrl: () => null,   // no screenshot ships; a slide is text-only
    dispose() { win.removeEventListener('pfo:run-start', onStart); win.removeEventListener('pfo:run-end', onEnd); win.removeEventListener('pfo:reset', onReset); timers.forEach(clearTimeout); timers.clear(); waiters.clear(); watchers.clear(); },
    _sleep: sleep, _settleMs: settleMs,
  };
}

// ---- finding what a bubble points at
const DLG = '[data-testid=frame-dialog]';
// The pop-out is a FloatingDialog portal: `isOpen ? <portal> : null`, so a dialog in the DOM IS an open one (jsdom renders nothing when closed).
const dlgOpen = (doc) => doc.querySelector(DLG);
const frameEl = (doc, n) => doc.querySelector(`[data-testid=frame-${n}]`) || null;
// The open pop-out, pointed at the section whose heading starts with `heading` (the whole dialog when there is no such section).
function dlgSection(doc, heading) {
  const open = dlgOpen(doc);
  if (!open || !heading) return open;
  const sec = [...open.querySelectorAll('section')].find((s) => { const h = s.querySelector('h3'); return h && h.textContent.startsWith(heading); });
  return sec || open;
}
const firstDetailParagraph = (doc) => doc.querySelector(`${DLG} [data-testid=frame-detail] > p`) || null;

// ---- the frame pop-outs: open a frame's detail, and close it again
function popoutHooks(doc, po, host) {
  const sectionOf = (d) => {
    if (!d) return null;
    if (po.detail) return firstDetailParagraph(doc) || d;   // the actor trail: the pop-out's first paragraph
    if (!po.section) return d;                              // the whole pop-out
    const sec = [...d.querySelectorAll('section')].find((s) => { const h = s.querySelector('h3'); return h && h.textContent.startsWith(po.section); });
    return sec || d;
  };
  return {
    // No such frame in this run: null (the step is skipped). Frame there, pop-out not open yet: the frame itself (the engine's wait for the step ends, then before() opens it).
    target: () => { const f = frameEl(doc, po.frame); return f && dlgOpen(doc) ? sectionOf(dlgOpen(doc)) : f; },
    async before() {
      const f = frameEl(doc, po.frame);
      if (!f) return;   // this run has no such frame: the step is skipped quietly; only a frame that will not open is worth a warning
      f.scrollIntoView({ block: 'nearest' }); f.click();
      for (let i = 0; i < 30 && !dlgOpen(doc); i += 1) await host._sleep(100);
      if (!dlgOpen(doc)) throw new Error('the pop-out did not open');
      await host._sleep(host._settleMs);
    },
    after() {
      const btn = doc.querySelector(`${DLG} button[aria-label="Close"], ${DLG} button[title="Close"], ${DLG} .fd-close-btn`);
      if (btn) btn.click();
    },
  };
}

// ---- the live fact lines a bubble shows (what the video's take read from the page)
function linesFor(doc, step) {
  if (step.askLine) return () => [step.askLine];
  switch (step.lines) {
    case 'exchLines': {
      // From the open exchange pop-out: which of audience / resource was sent, and the scope. Never a host name or an id.
      return () => {
        const dlg = dlgOpen(doc);
        if (!dlg) return [];
        const d = {};
        for (const r of dlg.querySelectorAll('table.real-params tr')) {
          const th = r.querySelector('th'); const td = r.querySelector('td');
          if (th && td) d[th.textContent.trim()] = td.textContent.trim();
        }
        const sent = 'audience' in d ? 'audience' : 'resource' in d ? 'resource' : null;
        return [(sent ? `sent: ${sent}` : null), (d.scope ? `scope: ${d.scope}` : null)].filter(Boolean);
      };
    }
    default: return undefined;
  }
}

// Steps left out of the walk-through. None now: the observability scene is the live panel (a Story-only bubble), and the video's captured slide is not in the script.
export const NOT_YET = [];

/** The script as engine steps. `captions` is /api/story; it supplies the Mock closing slide's replacement lines. */
export function buildSteps({ captions, host, doc = document, win = window, script = STEPS, notYet = NOT_YET }) {
  return script.filter((s) => !notYet.includes(s.key)).map((s) => {
    const step = { key: s.key, type: s.type, trigger: s.trigger, modes: s.modes, sampleKey: s.sampleKey, prefer: s.prefer, place: s.place, fixedSecs: s.fixedSecs, frameTimeoutMs: s.frameTimeoutMs };
    if (s.type === 'bubble') {
      if (s.popout) Object.assign(step, popoutHooks(doc, s.popout, host));
      else step.target = s.target;
      const lines = linesFor(doc, s);
      if (lines) step.lines = lines;
    }
    if (s.key === 'closing') {   // the simulated run never claims a live one: its replaced line comes from the Mock wording
      step.transform = (slide, mode) => (mode === 'mock'
        ? { ...slide, lead: captions.steps.sample_closing_lead.text }
        : slide);
    }
    return step;
  });
}
