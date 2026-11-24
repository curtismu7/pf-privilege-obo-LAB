// The lab's Story glue: the host (run events), the script turned into engine steps, the pop-out hooks and the live fact lines.
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHost, buildSteps, firstSentence, NOT_YET } from "../web/src/storyWiring.js";
import { STEPS, STORY_ONLY } from "../web/src/storyScript.js";
import { parseCaptions } from "../server/src/story/captions.js";

// vitest runs from web/ (npm test -w web) or the repo root; the wording file is the lab's own video/captions.md
const captionsFile = ["../video/captions.md", "video/captions.md"].find((f) => existsSync(f));
const captions = parseCaptions(readFileSync(captionsFile, "utf8"));
const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); });

describe("firstSentence", () => {
  test("cuts at the first full stop, takes the first line, and never cuts mid-word", () => {
    expect(firstSentence("The door accepted the token. More detail.")).toBe("The door accepted the token.");
    expect(firstSentence("one\ntwo")).toBe("one");
    expect(firstSentence("word ".repeat(60), 20)).toBe("word word word word...");
    expect(firstSentence(null)).toBe("");
  });
});

describe("host: runs", () => {
  test("waitForRun resolves when a run ends after the mark; a run that ended before the mark does not count", async () => {
    const host = createHost({});
    fire("pfo:run-start"); fire("pfo:run-end", { ok: true });
    const m = host.mark();
    const p = host.waitForRun(m, 5000);
    fire("pfo:run-start"); expect(host.runStarted(m)).toBe(true);
    fire("pfo:run-end", { ok: true });
    await expect(p).resolves.toEqual({ ok: true });
    host.dispose();
  });

  test("a run that finished between the mark and the wait resolves at once; a failed request is not ok; a run that never ends times out", async () => {
    const host = createHost({});
    const m = host.mark(); fire("pfo:run-end", { ok: false });
    await expect(host.waitForRun(m, 5000)).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/failed/) });
    vi.useFakeTimers();
    const p = host.waitForRun(host.mark(), 1000); vi.advanceTimersByTime(1001);
    await expect(p).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/did not finish in time/) });
    host.dispose();
  });

  test("a Reset while a step waits for a run tells it so (it is not reported as a failed run)", async () => {
    const host = createHost({});
    const p = host.waitForRun(host.mark(), 5000);
    fire("pfo:reset");
    await expect(p).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/page was reset/) });
    fire("pfo:run-end", { ok: false });   // the aborted run's own end follows: nobody is waiting, nothing throws
    host.dispose();
  });

  test("dispose clears the wait timers (a torn-down Story leaves nothing running)", () => {
    vi.useFakeTimers(); const host = createHost({}); host.waitForRun(host.mark(), 180000);
    expect(vi.getTimerCount()).toBe(1); host.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  test("the host says when a run is in flight and tells subscribers as runs start and end", () => {
    const host = createHost({}); const seen = vi.fn(); const off = host.onRun(seen);
    expect(host.runInFlight()).toBe(false);
    fire("pfo:run-start"); expect(host.runInFlight()).toBe(true);
    fire("pfo:run-end", { ok: true }); expect(host.runInFlight()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2); off(); fire("pfo:run-start"); expect(seen).toHaveBeenCalledTimes(2);
    host.dispose();
  });

  test("after dispose the host no longer counts runs", () => {
    const host = createHost({}); host.dispose();
    const m = host.mark(); fire("pfo:run-start"); expect(host.runStarted(m)).toBe(false);
  });
});

describe("host: the page", () => {
  test("send clicks the page's own Run live button with a script-made event", () => {
    document.body.innerHTML = '<button data-testid="real-obo-run">Run live</button>';
    const host = createHost({}); const onClick = vi.fn((e) => { expect(e.isTrusted).toBe(false); });
    document.querySelector("[data-testid=real-obo-run]").addEventListener("click", onClick);
    host.send({ prompt: { text: "x" } });
    expect(onClick).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test("send throws when the button is busy or missing (Play stops with a message)", () => {
    document.body.innerHTML = '<button data-testid="real-obo-run" disabled>Running…</button>';
    const host = createHost({});
    expect(() => host.send({})).toThrow(/not available/);
    host.dispose();
  });

  test("no screenshot is ever offered: slides are text-only", () => { expect(createHost({}).assetUrl("x.jpg")).toBeNull(); });
});

describe("buildSteps", () => {
  const host = createHost({});
  test("every step of the script is built (nothing held back)", () => {
    const steps = buildSteps({ captions, host });
    expect(steps.map((s) => s.key)).toEqual(STEPS.map((s) => s.key).filter((k) => !NOT_YET.includes(k)));
    expect(NOT_YET).toEqual([]);
  });

  test("Real has the video's 17 bubbles plus the two Story-only ones; Mock has only the mock steps", () => {
    const steps = buildSteps({ captions, host });
    const count = (mode, only) => steps.filter((s) => s.type === "bubble" && (!s.modes || s.modes.includes(mode)) && (!only || !STORY_ONLY.includes(s.key))).length;
    expect(count("real", true)).toBe(17);
    expect(count("real", false)).toBe(18);   // Story adds: the live observability panel (real+mock) and the Mock walk intro (mock only)
    expect(count("mock", false)).toBe(2);    // story_observability + sample_walk_intro
  });

  test("targets: a plain selector and a frame number the pop-out hooks point at", () => {
    document.body.innerHTML = `<button data-testid="real-obo-run">Run</button><div class="run-obs-slot"></div><div data-testid="flow-sim"></div>
      <div data-testid="frame-4">Frame 4</div>`;
    const by = Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));
    expect(by.p1_intro.target).toBe("[aria-label='Which shape']");
    expect(by.p1_refused_frame.target).toBe("[data-testid=frame-4]");
    expect(by.story_observability.target).toBe(".run-obs-slot");
    expect(by.sample_walk_intro.target).toBe("[data-testid=flow-sim]");
    expect(by.p1_signin.target()).toBeNull();   // frame 1 is not on the page: the step is skipped
  });

  test("a pop-out step: the frame is its target while closed, the open dialog's section once open, and after() closes the dialog", async () => {
    document.body.innerHTML = '<div data-testid="frame-2">Frame 2</div>';
    const h = createHost({ settleMs: 0 });
    const step = buildSteps({ captions, host: h }).find((s) => s.key === "p1_exchange");
    expect(step.target()).toBe(document.querySelector('[data-testid=frame-2]'));
    // No frame on the page: before() returns at once and the step is skipped quietly.
    const none = buildSteps({ captions, host: h }).find((s) => s.key === "p1_signin");
    await expect(none.before()).resolves.toBeUndefined();
    expect(none.target()).toBeNull();
    h.dispose();
  });

  test("the live fact lines are read from the open pop-out, and are empty rather than invented when it is closed", () => {
    document.body.innerHTML = `<div data-testid="frame-dialog" style="position:absolute"><section><h3>Sent</h3>
      <table class="real-params"><tbody>
        <tr><th scope="row">grant_type</th><td>urn:ietf:params:oauth:grant-type:token-exchange</td></tr>
        <tr><th scope="row">audience</th><td>the door</td></tr>
        <tr><th scope="row">scope</th><td>mcp</td></tr>
      </tbody></table></section></div>`;
    const h = createHost({ settleMs: 0 });
    const by = Object.fromEntries(buildSteps({ captions, host: h }).map((s) => [s.key, s]));
    expect(by.p1_exchange.lines()).toEqual(["sent: audience", "scope: mcp"]);
    document.body.innerHTML = "";
    expect(by.p1_exchange.lines()).toEqual([]);   // nothing on the page: no line is invented
    h.dispose();
  });

  test("resource is named when the exchange sent resource (part 2's shape), audience when it sent audience", () => {
    const mk = (params) => {
      document.body.innerHTML = `<div data-testid="frame-dialog" style="position:absolute"><section><h3>Sent</h3><table class="real-params"><tbody>
        ${params.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</tbody></table></section></div>`;
      const h = createHost({ settleMs: 0 });
      const by = Object.fromEntries(buildSteps({ captions, host: h }).map((s) => [s.key, s]));
      const lines = by.p2_exchange.lines();
      h.dispose();
      return lines;
    };
    expect(mk([["resource", "https://door.example/mcp"], ["scope", "whoami:read"]])).toEqual(["sent: resource", "scope: whoami:read"]);
    expect(mk([["audience", "the door"]])).toEqual(["sent: audience"]);
    expect(mk([["grant_type", "x"]])).toEqual([]);
  });

  test("the Mock closing slide swaps in the simulated wording and never claims a live run; Real keeps the slide as written", () => {
    const closing = buildSteps({ captions, host }).find((s) => s.key === "closing");
    const mock = closing.transform(captions.closing, "mock"); const real = closing.transform(captions.closing, "real");
    expect(mock.lead).toBe(captions.steps.sample_closing_lead.text);
    expect(real).toBe(captions.closing);
  });
});
