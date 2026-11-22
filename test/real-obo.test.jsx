import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import React from "react";
import App from "../web/src/App.jsx";
import RealObo from "../web/src/RealObo.jsx";
import SimulationBanner from "../web/src/Banner.jsx";
import { setJsonView } from "../web/src/components/JsonPane.jsx";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.DOMMatrixReadOnly = class { constructor() {} };
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); setJsonView("raw"); });

const CONFIG = { configured: true, shapes: { agent: true, gateway: true }, user: "demo-person", issuerHost: "pf.example", doors: {} };
const RUN = {
  shape: "agent", ok: true, ms: 1234, at: "2026-11-22T00:00:00Z", user: "demo-person",
  frames: [
    { n: 1, id: "signin", title: "Sign in as the person", state: "ok", ms: 800, summary: "Signed in. The ID token's subject is demo-person, valid 300 s.", request: { method: "POST", url: "pf.example/as/authorization.oauth2", params: [{ name: "password", value: "<not shown>" }] }, response: { status: 200 }, token: { kind: "ID token", raw: "idtoken.raw.value", hash: "abcd1234", length: 900, lifetimeSec: 300, claims: { sub: "demo-person" } }, spec: [] },
    { n: 2, id: "exchange", title: "Exchange for an access token (RFC 8693)", state: "ok", ms: 90, summary: "Access token issued.", request: { method: "POST", url: "pf.example/as/token.oauth2", params: [{ name: "audience", value: "https://gw.example/app/mcp" }, { name: "actor_token", value: "not sent" }] }, response: { status: 200 }, token: { kind: "access token", raw: "access.raw.token", hash: "ffff0000", length: 1200, lifetimeSec: 3600, claims: { sub: "demo-person", act: { sub: "agent-client" }, aud: "https://gw.example/app/mcp" } }, spec: [{ ref: "RFC 8693 §4.1", note: "act names the current actor." }] },
    { n: 3, id: "door", title: "Call the door with that token", state: "ok", ms: 300, summary: "Accepted: HTTP 200 with 3 tools.", request: { method: "POST", url: "gw.example/app/mcp", params: [] }, response: { status: 200, tools: ["A", "B", "C"] }, inferred: "Privilege is configured to check the audience.", spec: [] },
    { n: 4, id: "refused", title: "Try the same call with a made-up token", state: "refused", ms: 60, summary: "Refused: HTTP 401 with a WWW-Authenticate challenge.", request: { method: "POST", url: "gw.example/app/mcp", params: [] }, response: { status: 401, challenge: { present: true } }, spec: [{ ref: "RFC 9110 §15.5.2", note: "A 401 carries a challenge." }] },
  ],
};

function mockFetch({ cfg = CONFIG, run = RUN, runStatus = 200, source = "real" } = {}) {
  const calls = [];
  global.fetch = (path, opts) => {
    calls.push({ path, body: opts?.body ? JSON.parse(opts.body) : null });
    const j = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path === "/api/real/obo") return j(cfg);
    if (path === "/api/real/obo/run") return j(runStatus === 200 ? run : { error: "a run is already in progress" }, runStatus);
    if (path === "/api/info") return j({ source, realAvailable: true, realReason: "" });
    if (path === "/api/catalog") return j({ steps: [], scenarios: [{ id: "happy-read", label: "Happy", tool: "T", scope: "mcp", expect: "allow" }], issues: [], does: [], cant: [] });
    return j({}, 404);
  };
  return calls;
}

describe("Real OBO page", () => {
  it("runs the chosen shape and shows numbered frames with their state", async () => {
    const calls = mockFetch();
    render(<RealObo />);
    await waitFor(() => expect(screen.getByText(/Signing in as demo-person/)).toBeTruthy());
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(screen.getByTestId("real-obo-frames")).toBeTruthy());
    expect(calls.find((c) => c.path === "/api/real/obo/run").body).toEqual({ shape: "agent", refusal: true });
    for (const n of [1, 2, 3, 4]) expect(screen.getByTestId(`frame-${n}`)).toBeTruthy();
    expect(within(screen.getByTestId("frame-4")).getByText("refused")).toBeTruthy();
    expect(screen.getByTestId("frame-3").textContent).toMatch(/3 tools/);
  });

  it("switching shape and unticking the refusal changes what is asked for", async () => {
    const calls = mockFetch();
    render(<RealObo />);
    await waitFor(() => expect(screen.getByText(/Gateway OBO/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Gateway OBO/ }));
    fireEvent.click(screen.getByLabelText(/Also try a refused call/));
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/real/obo/run")).toBe(true));
    expect(calls.find((c) => c.path === "/api/real/obo/run").body).toEqual({ shape: "gateway", refusal: false });
  });

  it("opening a frame shows what was sent, the token in full, the decoded claims and the spec note", async () => {
    mockFetch();
    render(<RealObo />);
    await waitFor(() => expect(screen.getByTestId("real-obo-run")).toBeTruthy());
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(screen.getByTestId("frame-2")).toBeTruthy());
    fireEvent.click(screen.getByTestId("frame-2"));
    const detail = await waitFor(() => screen.getByTestId("frame-detail"));
    expect(detail.textContent).toMatch(/actor_token/);
    expect(detail.textContent).toMatch(/not sent/);
    expect(detail.textContent).toMatch(/RFC 8693 §4\.1/);
    expect(detail.textContent).toMatch(/sha256\/8 ffff0000/);
    expect(detail.textContent).toMatch(/agent-client/);
    expect(screen.getByTestId("frame-token").textContent).toBe("access.raw.token");
    expect(detail.textContent).toMatch(/shown in full because this is a demo/);
  });

  it("a frame that carries an inference says it was inferred", async () => {
    mockFetch();
    render(<RealObo />);
    await waitFor(() => expect(screen.getByTestId("real-obo-run")).toBeTruthy());
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(screen.getByTestId("frame-3")).toBeTruthy());
    fireEvent.click(screen.getByTestId("frame-3"));
    expect((await waitFor(() => screen.getByTestId("frame-inferred"))).textContent).toMatch(/Inferred, not reported/);
  });

  it("an unconfigured shape is disabled and the reason is shown", async () => {
    mockFetch({ cfg: { configured: false, reason: "Real is not configured. Set PFO_OBO_ISSUER", shapes: { agent: false, gateway: false } } });
    render(<RealObo />);
    await waitFor(() => expect(screen.getByTestId("real-obo-unconfigured")).toBeTruthy());
    expect(screen.getByTestId("real-obo-run").disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Agent-side/ }).disabled).toBe(true);
  });

  it("a refused run request shows the server's reason", async () => {
    mockFetch({ runStatus: 409 });
    render(<RealObo />);
    await waitFor(() => expect(screen.getByTestId("real-obo-run")).toBeTruthy());
    fireEvent.click(screen.getByTestId("real-obo-run"));
    await waitFor(() => expect(screen.getByTestId("real-obo-error").textContent).toMatch(/already in progress/));
  });
});

describe("Real mode in the app", () => {
  it("shows the real run instead of the mock scenarios and says it is live", async () => {
    mockFetch({ source: "real" });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("real-obo")).toBeTruthy());
    expect(screen.queryByTestId("scenario-picker")).toBeNull();
    expect(screen.getByTestId("sim-banner").textContent).toMatch(/live calls/i);
  });

  it("Mock still shows the scenarios and the simulation banner", async () => {
    mockFetch({ source: "mock" });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("scenario-picker")).toBeTruthy());
    expect(screen.queryByTestId("real-obo")).toBeNull();
    expect(screen.getByTestId("sim-banner").textContent).toMatch(/fully simulated/i);
  });

  it("the banner for Real never claims the run is simulated", () => {
    render(<SimulationBanner source="real" />);
    expect(screen.getByTestId("sim-banner").textContent).not.toMatch(/fully simulated/i);
  });
});
