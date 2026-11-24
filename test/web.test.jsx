import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import App from "../web/src/App.jsx";
import OpeningCard from "../web/src/OpeningCard.jsx";
import ScenarioPicker from "../web/src/ScenarioPicker.jsx";
import IssuesPanel from "../web/src/IssuesPanel.jsx";
import ChainSteps from "../web/src/ChainSteps.jsx";
import Banner from "../web/src/Banner.jsx";
import { setJsonView } from "../web/src/components/JsonPane.jsx";

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  global.DOMMatrixReadOnly = class {
    constructor() {}
  };
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {};
});

// Browser fetch mock: catalog + info + one run.
function mockFetch(overrides = {}) {
  const calls = [];
  global.fetch = (path, opts) => {
    calls.push({ path, opts });
    const key = `${(opts && opts.method) || "GET"} ${path.split("?")[0]}`;
    const j = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (overrides[key]) return overrides[key]();
    if (path === "/api/catalog")
      return j({
        steps: [{ id: "sso", title: "SSO", lane: "pf", what: "w", claim: "c" }],
        scenarios: [
          { id: "happy-read", label: "Happy", tool: "T", scope: "mcp", expect: "allow" },
          { id: "cedar-block", label: "Cedar", tool: "T", scope: "mcp", expect: "block-cedar" }
        ],
        issues: [{ id: "i1", severity: "blocker", title: "t", what: "w", fix: "f" }],
        does: ["d1"],
        cant: ["c1"]
      });
    if (path === "/api/info") return j({ source: "mock", realAvailable: false, realReason: "no real" });
    if (path === "/api/run")
      return j({
        id: "r1",
        http: 400,
        ok: false,
        hops: [
          { stage: "nhi", ok: true, reason: "accepted" },
          { stage: "cedar", ok: false, reason: "denied by scope-search-guard" }
        ],
        token: { hash: "abcd1234", claims: { sub: "u" } }
      });
    if (path === "/api/mode") return j({ source: "mock" });
    return j({}, 404);
  };
  return calls;
}

// The Form | JSON choice is shared module state: every test names the view it reads.
beforeEach(() => setJsonView("raw"));
afterEach(() => cleanup());

describe("App", () => {
  it("renders simulation banner first, scenario picker and issues", async () => {
    mockFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("sim-banner")).toBeTruthy());
    expect(screen.getByTestId("sim-banner").textContent).toMatch(/fully simulated/i);
    await waitFor(() => expect(screen.getByRole("button", { name: "Happy" })).toBeTruthy());
    await waitFor(() => expect(screen.getByText("What Privilege does here")).toBeTruthy());
    expect(screen.getByText("What Privilege does here")).toBeTruthy();
  });

  it("Real option is disabled with a reason when unconfigured (the shared TopMenu's mode select)", async () => {
    mockFetch();
    render(<App />);
    const select = await waitFor(() => screen.getByTestId("mode-select"));
    const realOpt = screen.getByTestId("mode-real");
    expect(realOpt.disabled).toBe(true);
    expect(realOpt.title || select.title).toMatch(/no real/i);
  });

  it("theme picker sets and clears data-theme", async () => {
    mockFetch();
    render(<App />);
    const select = await waitFor(() => screen.getByTestId("theme-select"));
    fireEvent.change(select, { target: { value: "dark" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.change(select, { target: { value: "auto" } });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("selecting a scenario runs the flow and shows the refusal", async () => {
    mockFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cedar" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cedar" }));
    await waitFor(() => expect(screen.getByTestId("run-result")).toBeTruthy(), { timeout: 8000 });
    const result = screen.getByTestId("run-result");
    expect(result.textContent).toMatch(/REFUSED/);
    expect(result.textContent).toMatch(/HTTP 400/);
    expect(result.textContent).toMatch(/scope-search-guard/);
    // The token claims go through the shared JSON pane (JSON view here): key and value as colored tokens, Form | JSON toggle.
    const claims = screen.getByTestId("token-claims");
    expect(claims.textContent).toBe('{\n  "sub": "u"\n}');
    expect(screen.getByTestId("token-claims-box").querySelector(".jsonbox__toggle").textContent).toBe("FormJSON");
    fireEvent.click(screen.getByTestId("token-claims-formatted"));
    await waitFor(() => expect(screen.getByTestId("token-claims").textContent).toBe("subu"));
  });

  it("shows the mode toggle in the header (the shared TopMenu's mode select)", async () => {
    mockFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("mode-select")).toBeTruthy());
  });

  it("names the subject in the header and the page title: on-behalf-of (OBO) in PingOne Privilege", async () => {
    mockFetch();
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".shell-brand")).toBeTruthy());
    const NAME = "On-behalf-of (OBO) in PingOne Privilege";
    // exactly the name (the decorative mark aside), not text that merely contains it
    expect(container.querySelector(".shell-brand").textContent.replace("\u25c6", "").trim()).toBe(NAME);
    // the browser tab says the same, so the two hand-edited strings cannot drift apart
    expect(readFileSync(resolve(process.cwd(), "web/index.html"), "utf8")).toMatch(new RegExp(`<title>${NAME.replace(/[()]/g, "\\$&")}</title>`));
  });
});

describe("OpeningCard", () => {
  const opening = {
    headline: "An AI agent tries to call an MCP tool.",
    sub: "It should be refused - and then allowed, provably on behalf of the person who asked.",
    call: { method: "tools/call", tool: "SearchIndexTool", args: "{}", jsonrpc: '{"jsonrpc":"2.0"}' }
  };

  it("opens on the agent's MCP call with the two deciding questions", () => {
    render(<OpeningCard opening={opening} />);
    expect(screen.getByTestId("opening-card").textContent).toMatch(/AI agent tries to call an MCP tool/);
    expect(screen.getByTestId("opening-card").textContent).toMatch(/who is asking/);
    expect(screen.getByTestId("opening-card").textContent).toMatch(/what is acting for them/);
  });

  it("toggles the raw JSON-RPC", () => {
    render(<OpeningCard opening={opening} />);
    expect(screen.queryByText(/"jsonrpc"/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show raw JSON-RPC/i }));
    expect(screen.getByText(/"jsonrpc"/)).toBeTruthy();
  });

  it("shows the tool call and its arguments, and the JSON-RPC, in the shared Form | JSON pane", () => {
    render(<OpeningCard opening={{ ...opening, call: { ...opening.call, args: '{ "index": "i", "query": "q" }' } }} />);
    expect(screen.getByText("tools/call SearchIndexTool")).toBeTruthy();
    expect(screen.getByTestId("mcp-args").textContent).toBe('{ "index": "i", "query": "q" }');
    fireEvent.click(screen.getByTestId("mcp-args-formatted"));
    expect(screen.getByTestId("mcp-args").textContent).toBe("indexiqueryq");
    fireEvent.click(screen.getByRole("button", { name: /Show raw JSON-RPC/i }));
    expect(screen.getByTestId("mcp-jsonrpc-box").querySelector(".jsonbox__toggle").textContent).toBe("FormJSON");
  });
});

describe("IssuesPanel", () => {
  it("labels severities honestly", () => {
    render(
      <IssuesPanel
        issues={[
          { id: "a", severity: "blocker", title: "Title A", what: "w", fix: "f" },
          { id: "b", severity: "honesty", title: "Title B", what: "w", fix: "f" }
        ]}
        does={["d"]}
        cant={["c"]}
      />
    );
    expect(screen.getByText("Blocked us")).toBeTruthy();
    expect(screen.getByText("Honesty note")).toBeTruthy();
  });
});

describe("ChainSteps", () => {
  it("renders steps with lanes and claims", () => {
    render(<ChainSteps steps={[{ id: "x", title: "T", lane: "privilege", what: "W", claim: "sub = user" }]} />);
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByText("privilege")).toBeTruthy();
    expect(screen.getByText("sub = user")).toBeTruthy();
  });
});

// ---- run observability (rule 27) in the page ----------------------------------------------------------------------------------
import { mockRecord, realRecord } from "../web/src/run-observability/fixtures.js";

const res = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe("App: what each layer logged for this run", () => {
  it("shows the empty state before a run, then reads the record after a scenario run (the Mock record, labelled Mock)", async () => {
    let record = null;
    const calls = mockFetch({ "GET /api/run-observability": () => (record ? res(record) : Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error("no body")) })) });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeTruthy());
    expect(screen.queryByTestId("ro-reread")).toBeNull(); // the Re-read control is a Real-mode control
    record = mockRecord;
    await waitFor(() => expect(screen.getByRole("button", { name: "Cedar" })).toBeTruthy());
    const before = calls.filter((c) => c.path.startsWith("/api/run-observability")).length;
    fireEvent.click(screen.getByRole("button", { name: "Cedar" }));
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy(), { timeout: 8000 });
    expect(calls.filter((c) => c.path.startsWith("/api/run-observability")).length).toBeGreaterThan(before);
  });

  it("a record that is for the other mode is never shown under the wrong label (the page drops it; the panel would refuse it too)", async () => {
    const calls = mockFetch({ "GET /api/run-observability": () => res(realRecord) });
    render(<App />);
    await waitFor(() => expect(calls.some((c) => c.path.startsWith("/api/run-observability"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeTruthy());
    expect(screen.queryByTestId("ro-table")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed read is an alert with the server's reason, never an empty table", async () => {
    mockFetch({ "GET /api/run-observability": () => res({ error: "bad_window", message: "endedAt is before startedAt" }, 400) });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/endedAt is before startedAt/));
  });

  it("Real mode has the Re-read control and the delay note", async () => {
    mockFetch({
      "GET /api/info": () => res({ source: "real", realAvailable: true }),
      "GET /api/real/obo": () => res({ configured: true, user: "someone", shapes: { agent: true, gateway: true } }),
      "GET /api/run-observability": () => res(realRecord),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("ro-reread")).toBeTruthy());
    expect(screen.getByTestId("ro-read-note").textContent).toMatch(/ships lines with a delay/);
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy());
  });
});

describe("App: the record is for the run just made (review fixes)", () => {
  const noRecord = () => Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error("no body")) });

  it("asks for the run's own id, shows 'Collecting' (never the previous run's record) while it is read, then the record", async () => {
    let release;
    const runs = ["r1", "r2"];
    const calls = mockFetch({
      "POST /api/run": () => res({ id: runs.shift(), http: 400, ok: false, hops: [{ stage: "nhi", ok: false, reason: "no" }], token: { hash: "abcd1234", claims: { sub: "u" } } }),
      "GET /api/run-observability": () => {
        const last = calls.at(-1).path;
        if (last.endsWith("runId=r2")) return new Promise((r) => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve({ ...mockRecord, runId: "r2" }) }); });
        return last.endsWith("runId=r1") ? res({ ...mockRecord, runId: "r1" }) : noRecord();
      },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Happy" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Happy" }));
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy(), { timeout: 8000 });
    expect(calls.some((c) => c.path === "/api/run-observability?runId=r1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cedar" }));
    await waitFor(() => expect(screen.getByTestId("ro-loading")).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByTestId("ro-loading").textContent).toMatch(/Collecting this run's logs/);
    expect(screen.queryByTestId("ro-table")).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy());
    expect(screen.queryByTestId("ro-loading")).toBeNull();
  }, 30000);

  it("an answer that is not a run record (valid JSON that is not an object, an object with no rows, an error with no reason) is an alert, never the 'no run yet' empty state", async () => {
    for (const [status, body, expected] of [[200, [1, 2], /not a run record/], [200, "text", /not a run record/], [200, null, /not a run record/], [200, { runId: "x" }, /not a run record/], [500, { error: "boom" }, /HTTP 500|boom/], [502, ["x"], /HTTP 502/]]) {
      mockFetch({ "GET /api/run-observability": () => res(body, status) });
      render(<App />);
      await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(expected), { timeout: 4000 });
      expect(screen.queryByTestId("ro-empty")).toBeNull();
      cleanup();
    }
  });

  it("Real: a failed attempt (no run began) shows the empty state, not the older run's record, and reads nothing", async () => {
    const posts = [() => res({ id: "run-real-1", shape: "agent", ok: true, ms: 5, frames: [] }), () => res({ error: "a run is already in progress" }, 409)];
    const calls = mockFetch({
      "GET /api/info": () => res({ source: "real", realAvailable: true }),
      "GET /api/real/obo": () => res({ configured: true, user: "someone", shapes: { agent: true, gateway: true } }),
      "POST /api/real/obo/run": () => posts.shift()(),
      "GET /api/run-observability": () => (calls.at(-1).path.endsWith("runId=run-real-1") ? res(realRecord) : noRecord()),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("real-obo-run")).toBeTruthy());
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy());
    const reads = calls.filter((c) => c.path.startsWith("/api/run-observability")).length;
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(screen.getByTestId("real-obo-error")).toBeTruthy());
    expect(screen.queryByTestId("ro-table")).toBeNull();
    expect(screen.getByTestId("ro-empty")).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith("/api/run-observability")).length).toBe(reads);
  });
});

describe("App: a mode switch refused while a Real run is in progress, and the deliberate Re-read (review fixes)", () => {
  it("shows the server's reason, keeps the mode, and clears it after a switch that works", async () => {
    let answer = () => res({ error: "run_in_progress", message: "A Real run is still in progress: wait for it to finish before switching mode." }, 409);
    mockFetch({ "GET /api/info": () => res({ source: "mock", realAvailable: true }), "POST /api/mode": () => answer() });
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Mock or Real")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Mock or Real"), { target: { value: "real" } });
    await waitFor(() => expect(screen.getByTestId("mode-error").textContent).toMatch(/Real run is still in progress/));
    expect(screen.getByLabelText("Mock or Real").value).toBe("mock");
    answer = () => res({ source: "real" });
    fireEvent.change(screen.getByLabelText("Mock or Real"), { target: { value: "real" } });
    await waitFor(() => expect(screen.queryByTestId("mode-error")).toBeNull());
  });

  it("Re-read logs asks the server to rebuild the record (?fresh=1); the first read does not", async () => {
    const calls = mockFetch({
      "GET /api/info": () => res({ source: "real", realAvailable: true }),
      "GET /api/real/obo": () => res({ configured: true, user: "someone", shapes: { agent: true, gateway: true } }),
      "GET /api/run-observability": () => res(realRecord),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy());
    expect(calls.some((c) => c.path === "/api/run-observability")).toBe(true);
    expect(calls.some((c) => c.path.includes("fresh=1"))).toBe(false);
    fireEvent.click(screen.getByTestId("ro-reread"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/run-observability?fresh=1")).toBe(true));
  });
});
