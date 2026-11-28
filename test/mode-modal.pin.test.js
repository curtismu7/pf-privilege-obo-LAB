// The vendored shared/mode-modal files (ModeModal.jsx, mode-modal.css) match mode-modal.sha256 byte for byte.
// They come from AI-DEMO-Standalone shared/mode-modal: change them there, re-pin, re-vendor; never edit them here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "mode-modal");

test("vendored mode-modal matches mode-modal.sha256 byte for byte, and the pin lists exactly the two shared files", () => {
  const pins = readFileSync(join(dir, "mode-modal.sha256"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
  assert.deepEqual(pins.map(([, f]) => f).sort(), ["ModeModal.jsx", "mode-modal.css"]);
  for (const [hash, file] of pins) assert.equal(createHash("sha256").update(readFileSync(join(dir, file))).digest("hex"), hash, `${file} differs from its pin`);
});
