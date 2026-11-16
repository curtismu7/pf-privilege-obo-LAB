// The vendored shared/verify-mark files (VerifyMark.jsx, VerifyMark.css) match their pin files byte for byte, and the pins are the canonical ones.
// They come from AI-DEMO-Standalone shared/verify-mark: change them there, re-pin, re-vendor; never edit them here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "components");
const CANONICAL = {
  "VerifyMark.jsx": "81c2532041c5a65aaf762e55c56e889df09dfde5811fc5cc788897ca8712c130",
  "VerifyMark.css": "4774585cd47c3affc739d3d99fa6843d62f607d8d3e69b4438de756ac3d49dc5"
};

test("vendored verify-mark matches VerifyMark.sha256 and VerifyMark.css.sha256, and the canonical hashes", () => {
  for (const [file, pinFile] of [["VerifyMark.jsx", "VerifyMark.sha256"], ["VerifyMark.css", "VerifyMark.css.sha256"]]) {
    const [hash, name] = readFileSync(join(dir, pinFile), "utf8").trim().split(/\s+/);
    assert.equal(name, file, pinFile);
    const actual = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
    assert.equal(actual, hash, `${file} differs from ${pinFile} (hand-edited, or re-vendored without re-pinning)`);
    assert.equal(actual, CANONICAL[file], `${file} is not the canonical shared/verify-mark copy`);
  }
});
