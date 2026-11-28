import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import React from "react";
import App from "../web/src/App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same GET /api/shelf call the shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.DOMMatrixReadOnly = class { constructor() {} };
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(() => cleanup());

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function stubFetch(shelf) {
  const res = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  global.fetch = (path) => {
    if (path === "/api/shelf") return shelf === null ? Promise.reject(new Error("no shelf")) : res(shelf);
    if (path === "/api/catalog") return res({ steps: [], scenarios: [], issues: [], does: [], cant: [] });
    if (path === "/api/info") return res({ source: "mock", realAvailable: false, realReason: "no real" });
    return res({}, 404);
  };
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark inside the top menu, and no other lab's", async () => {
    stubFetch({ shelfUrl: "http://shelf.example", demos: [
      { id: "other-lab", verification: mark("in-progress", "In progress") },
      { id: "pf-privilege-obo-lab", verification: mark("verified", "Verified", { note: "Every scenario run on the mock" }) }
    ] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scenario run on the mock"));
  });

  it("shows nothing without a mark, when /api/shelf returns only {shelfUrl}, or when the shelf is unreachable", async () => {
    for (const shelf of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "pf-privilege-obo-lab", verification: null }] }, null]) {
      stubFetch(shelf);
      const { unmount } = render(<App />);
      await screen.findByTestId("top-menu");
      await waitFor(() => expect(screen.getByTestId("mode-modal")).toBeTruthy());
      await new Promise((r) => setTimeout(r, 30));
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
