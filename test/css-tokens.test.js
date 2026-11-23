// A custom property defined as itself (`--accent: var(--accent);`) is a cycle: CSS treats it as invalid, and because web/app.css
// loads after the vendored family stylesheet it overrides the real value. In the light theme that left the shell bar, the nav
// and the pressed buttons with no background, so white text sat on white. This test fails if any token is defined as itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../web/app.css", import.meta.url), "utf8");

test("app.css defines no custom property as itself", () => {
  const cycles = [...css.matchAll(/(--[\w-]+)\s*:\s*var\(\s*\1\s*[,)]/g)].map((m) => m[1]);
  assert.deepEqual(cycles, [], `these tokens reference themselves, which makes them invalid: ${cycles.join(", ")}`);
});
