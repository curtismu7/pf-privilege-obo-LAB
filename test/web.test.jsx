import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
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
    const key = `${(opts && opts.method) || "GET"} ${path}`;
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
    expect(screen.getByTestId("token-claims").textContent).toBe("subu");
  });

  it("shows the mode toggle in the header (the shared TopMenu's mode select)", async () => {
    mockFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("mode-select")).toBeTruthy());
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
    const before = calls.filter((c) => c.path === "/api/run-observability").length;
    fireEvent.click(screen.getByRole("button", { name: "Cedar" }));
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeTruthy(), { timeout: 8000 });
    expect(calls.filter((c) => c.path === "/api/run-observability").length).toBeGreaterThan(before);
  });

  it("a record that is for the other mode is never shown under the wrong label (the page drops it; the panel would refuse it too)", async () => {
    const calls = mockFetch({ "GET /api/run-observability": () => res(realRecord) });
    render(<App />);
    await waitFor(() => expect(calls.some((c) => c.path === "/api/run-observability")).toBe(true));
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
