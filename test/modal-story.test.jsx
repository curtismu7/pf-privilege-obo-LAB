// The Real-or-mock modal stays off while Story mode is on (spec criterion 5). Its own file: Story leaves lazy-loaded state behind.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import App from "../web/src/App.jsx";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.DOMMatrixReadOnly = class { constructor() {} };
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); localStorage.removeItem("pfo.story.view"); });

const j = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
function stubFetch() {
  global.fetch = (path) => {
    if (path === "/api/catalog") return j({ steps: [], scenarios: [{ id: "happy-read", label: "Happy", tool: "T", scope: "mcp", expect: "allow" }], issues: [], does: [], cant: [] });
    if (path === "/api/info") return j({ source: "mock", realAvailable: false });
    return j({}, 404);
  };
}

describe("modal and Story", () => {
  it("Story chosen at load: no modal", async () => {
    stubFetch();
    localStorage.setItem("pfo.story.view", "story");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("scenario-picker")).toBeTruthy());
    expect(screen.queryByTestId("mode-modal")).toBeNull();
  });

  it("Demo (the default): the modal is there", async () => {
    stubFetch();
    render(<App />);
    expect(await screen.findByTestId("mode-modal")).toBeTruthy();
  });
});
