// {{token}} templating for the story data (rule 10 + rule 12).
// customer.config.json (optional, git-ignored) overrides brand and the cast.
// Every person and host is synthetic: only .example hosts, no real company or tenant.
import fs from "node:fs";

const TOKEN = /\{\{(\w+)\}\}/g;

// Three vertical packs (rule 10). A test fails on any token a pack does not define.
export const VERTICALS = {
  finance: {
    castBrand: "Fabrikam Bank",
    castUser: "priya.nair",
    castAgent: "fabrikam-payments-agent",
    castBackend: "payments-mcp.fabrikam.example"
  },
  healthcare: {
    castBrand: "Contoso Health",
    castUser: "grace.liu",
    castAgent: "contoso-records-agent",
    castBackend: "records-mcp.contoso.example"
  },
  retail: {
    castBrand: "Northwind Retail",
    castUser: "olu.adeyemi",
    castAgent: "northwind-inventory-agent",
    castBackend: "inventory-mcp.northwind.example"
  }
};

export const DEFAULT_VERTICAL = "finance";

let config = null;
function loadConfig() {
  if (config) return config;
  config = {};
  try {
    const raw = fs.readFileSync(new URL("../../customer.config.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw);
    for (const key of ["brand", "user", "agent", "backend"]) {
      if (typeof parsed[key] === "string" && parsed[key].length <= 60) config[`cast${key[0].toUpperCase()}${key.slice(1)}`] = parsed[key];
    }
  } catch {
    // optional file
  }
  return config;
}

// Fill {{tokens}} from a vertical pack + customer overrides.
export function fillTokens(text, vertical = DEFAULT_VERTICAL) {
  const pack = VERTICALS[vertical] || VERTICALS[DEFAULT_VERTICAL];
  const tokens = { ...pack, ...loadConfig() };
  return String(text || "").replace(TOKEN, (m, name) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : m
  );
}

export function tokensFor(vertical = DEFAULT_VERTICAL) {
  return { ...VERTICALS[vertical], ...loadConfig() };
}

// Test helper: every {{token}} used in the scenario data is defined.
export function undefinedTokens(texts, vertical = DEFAULT_VERTICAL) {
  const tokens = tokensFor(vertical);
  const used = new Set();
  for (const t of texts) {
    for (const m of String(t || "").matchAll(TOKEN)) used.add(m[1]);
  }
  return [...used].filter((n) => !Object.prototype.hasOwnProperty.call(tokens, n));
}
