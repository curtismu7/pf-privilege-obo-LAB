// The "What Privilege did" panel is in the page: it is there (empty) before a run, and after a run it shows the request, the
// response and the decisions of the trace the server returned.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import App from "../web/src/App.jsx";
import { setJsonView } from "../web/src/components/JsonPane.jsx";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.DOMMatrixReadOnly = class {};
});
beforeEach(() => setJsonView("raw"));

const trace = {
  source: "mock",
  request: { method: "POST", url: "https://gateway.example.com/mcp-example/mcp", headers: { authorization: "Bearer <token, 400 characters, kept on the server>" }, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "SearchIndexTool" } } },
  response: { status: 400, headers: { "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "denied by scope-search-guard" } } },
  decisions: [
    { id: "nhi", label: "Workload token (federated identity)", outcome: "pass", basis: "checked", evidence: "all matched" },
    { id: "grant", label: "Grant", outcome: "pass", basis: "checked", evidence: "rule tier-read" },
    { id: "cedar", label: "AI policy (Cedar)", outcome: "fail", basis: "checked", evidence: "denied by scope-search-guard" },
    { id: "backend", label: "Backend verification (Pass Agent Token)", outcome: "skipped", basis: "checked", evidence: "not reached" }
  ],
  record: "gateway refused the call"
};

function mockFetch() {
  global.fetch = (path) => {
    const j = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path === "/api/catalog") return j({ steps: [], scenarios: [{ id: "cedar-block", label: "Cedar", tool: "SearchIndexTool", scope: "mcp", expect: "block-cedar" }], issues: [], does: [], cant: [] });
    if (path === "/api/info") return j({ source: "mock", realAvailable: false, realReason: "no real" });
    if (path === "/api/exchange") return j({ token: "t" });
    if (path === "/api/run") return j({ id: "r1", tool: "SearchIndexTool", http: 400, ok: false, hops: [{ stage: "cedar", ok: false, reason: "denied" }], token: { hash: "abcd1234", claims: { sub: "u" } }, trace });
    return j({}, 404);
  };
}

describe("What Privilege did in the page", () => {
  it("is on the page before a run, then shows the call's request, response and decisions", async () => {
    mockFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cedar" })).toBeTruthy());
    expect(screen.getByTestId("gateway-trace")).toBeInTheDocument();
    expect(screen.getByTestId("gateway-trace-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cedar" }));
    await waitFor(() => expect(screen.getByTestId("run-result")).toBeTruthy(), { timeout: 8000 });
    const panel = screen.getByTestId("gateway-trace");
    expect(within(panel).queryByTestId("gateway-trace-empty")).toBeNull();
    expect(panel).toHaveTextContent(/Agent calls the gateway: tools\/call SearchIndexTool/);
    expect(panel).toHaveTextContent(/Workload token \(federated identity\)/);
    expect(panel).toHaveTextContent(/AI policy \(Cedar\)/);
    expect(screen.getByTestId("gateway-trace-basis")).toHaveTextContent(/Simulated/);
  });
});
