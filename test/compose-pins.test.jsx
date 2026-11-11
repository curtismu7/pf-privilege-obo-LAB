// Rule 18 + rule 21 pins: loopback-only publish, restart policy, hardening.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const serverSrc = readFileSync(join(root, "server", "src", "index.js"), "utf8");

describe("compose hardening (rule 18 + 21)", () => {
  it("publishes loopback-only, parameterized by HOST_PORT", () => {
    expect(compose).toMatch(/"127\.0\.0\.1:\$\{HOST_PORT:-7812\}:7812"/);
    expect(compose).not.toMatch(/- "7812:7812"/);
    expect(compose).not.toMatch(/"7812:7812"/);
  });

  it("long-running service restarts unless stopped (rule 21)", () => {
    expect(compose).toMatch(/restart: unless-stopped/);
  });

  it("container hardening: read-only, cap-drop, no-new-privileges", () => {
    expect(compose).toMatch(/read_only: true/);
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(compose).toMatch(/no-new-privileges:true/);
  });
});

describe("server bind discipline", () => {
  it("binds 0.0.0.0 only when BIND_ALL=1; host publish stays loopback", () => {
    expect(serverSrc).toMatch(/process\.env\.BIND_ALL === "1" \? "0\.0\.0\.0" : "127\.0\.0\.1"/);
  });

  it("Dockerfile builds the UI and copies data + dist", () => {
    expect(dockerfile).toMatch(/RUN npm run build/);
    expect(dockerfile).toMatch(/COPY data \.\/data/);
    expect(dockerfile).toMatch(/USER node/);
  });
});
