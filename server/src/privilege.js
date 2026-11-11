// Mock Privilege gateway: NHI (federated identity) check, grant check, guardrail hooks.
// Mirrors the measured behaviour in privilege/PF-OBO-WITH-PINGFEDERATE-SETUP.md.

export const DEFAULT_CONFIG = {
  pfIssuer: "https://pf.example.com",
  pfJwksUrl: "https://pf.example.com/pf/JWKS",
  agentClientId: "agent-client-example",
  agentId: "agent-client-example",
  gatewayHost: "https://gateway.example.com",
  agentAppName: "mcp-example",
  audience: "https://gateway.example.com/mcp-example/mcp",
  scope: "mcp",
  requiredClaims: { "act.sub": "agent-client-example", client_id: "agent-client-example" },
  maxTokenLifetimeSec: 7200,
  subject: "*",
  userClaim: "sub",
  endUserBinding: "opaque",
  // Grant: tools allowed per tier. Two rules with RequiredClaims on scope.
  // Most-privileged first: a token matching several rules gets the biggest tool set.
  grantRules: [
    {
      id: "tier-admin",
      tools: ["ListIndexTool", "SearchIndexTool", "CountTool", "ClusterHealthTool", "IndexMappingTool", "GetShardsTool"],
      requiredScope: "mcp admin:example"
    },
    {
      id: "tier-read",
      tools: ["ListIndexTool", "SearchIndexTool", "CountTool"],
      requiredScope: "mcp"
    }
  ],
  cedarPolicy: {
    name: "scope-search-guard",
    state: "Active",
    tool: "SearchIndexTool",
    needsScope: "search:example"
  }
};

const ALL_TOOLS = ["ListIndexTool", "SearchIndexTool", "CountTool", "ClusterHealthTool", "IndexMappingTool", "GetShardsTool", "ExplainTool", "MsearchTool", "GenericApiTool"];

export function stateToScopes(tokenScopes) {
  return String(tokenScopes || "").split(/\s+/).filter(Boolean);
}

// NHI check: issuer, signature, audience, required claims, lifetime.
// Mirrors gateway log reasons: "workload token rejected: <reason>".
export function nhiCheck(token, config, verifyFn) {
  const v = verifyFn(token);
  if (!v.ok) return { ok: false, stage: "nhi", reason: `workload token rejected: ${v.reason}` };
  const p = v.payload;
  if (p.iss !== config.pfIssuer) {
    return { ok: false, stage: "nhi", reason: `workload token rejected: issuer ${p.iss || "(none)"} does not match ${config.pfIssuer}` };
  }
  if (p.aud !== config.audience) {
    return { ok: false, stage: "nhi", reason: `workload token rejected: audience ${p.aud || "(none)"} does not match ${config.audience}` };
  }
  // Required claims, exact match, dotted paths supported.
  for (const [claim, expect] of Object.entries(config.requiredClaims || {})) {
    let actual = p;
    for (const part of claim.split(".")) {
      actual = actual && typeof actual === "object" ? actual[part] : undefined;
    }
    if (actual !== expect) {
      return { ok: false, stage: "nhi", reason: `workload token rejected: required claim "${claim}" does not match` };
    }
  }
  if (typeof p.iat === "number" && typeof p.exp === "number" && p.exp - p.iat > config.maxTokenLifetimeSec) {
    return { ok: false, stage: "nhi", reason: `workload token rejected: lifetime ${p.exp - p.iat}s exceeds max ${config.maxTokenLifetimeSec}s` };
  }
  if (p.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, stage: "nhi", reason: "workload token rejected: token expired" };
  }
  return { ok: true, stage: "nhi", payload: p };
}

// Pick the matching rule with the largest tool set (most privileged tier).
export function grantCheck(payload, config) {
  const scopes = stateToScopes(payload.scope);
  let best = null;
  for (const rule of config.grantRules) {
    const needed = stateToScopes(rule.requiredScope);
    if (needed.every((s) => scopes.includes(s))) {
      if (!best || rule.tools.length > best.tools.length) best = rule;
    }
  }
  if (best) {
    return { ok: true, stage: "grant", rule: best.id, tools: best.tools, allTools: ALL_TOOLS };
  }
  return { ok: false, stage: "grant", reason: `policy denied ${config.agentId} access to ${config.agentAppName} (agent=true)` };
}

// Cedar check: an active AI policy can refuse one tool by token scope.
// Mirrors "aipolicy: denied ... (policies=[...])".
export function cedarCheck(tool, payload, config) {
  const c = config.cedarPolicy;
  if (c.state !== "Active" || tool !== c.tool) return { ok: true, stage: "cedar" };
  const scopes = stateToScopes(payload.scope);
  if (!scopes.includes(c.needsScope)) {
    return {
      ok: false,
      stage: "cedar",
      reason: `action denied by policy: ${c.tool} needs the ${c.needsScope} scope in the agent's token (policies=[${c.name}:1])`
    };
  }
  return { ok: true, stage: "cedar" };
}

// The backend's own verification (Pass Agent Token): the gateway forwards the
// token unchanged, the MCP server verifies it too.
export function backendCheck(token, config, verifyFn) {
  const v = verifyFn(token);
  if (!v.ok) return { ok: false, stage: "backend", reason: `backend rejected: ${v.reason}` };
  if (v.payload.aud !== config.audience) {
    return { ok: false, stage: "backend", reason: "backend rejected: audience mismatch" };
  }
  return { ok: true, stage: "backend", payload: v.payload };
}

// Run the full chain. stepsRequested lets callers stop early for teaching.
// Mode "autonomous" = agent-only token (client credentials shape, no user/act).
export function runChain({ token, tool, config, verifyFn, shape = "obo" }) {
  const hops = [];
  const push = (hop) => { hops.push(hop); return hop; };

  const nhi = push(nhiCheck(token, config, verifyFn));
  if (!nhi.ok) {
    push({ stage: "stopped", ok: false, reason: "gateway refused the token at sign-in: 401 Bearer token required" });
    return { ok: false, hops, http: 401 };
  }

  if (shape === "autonomous") {
    // For teaching: show what the autonomous shape is missing. In practice the
    // NHI required claim on act.sub already refused it above.
  }

  const grant = push(grantCheck(nhi.payload, config));
  if (!grant.ok) {
    push({ stage: "stopped", ok: false, reason: "gateway refused on policy: bare 403 Forbidden (no grant rule matched)" });
    return { ok: false, hops, http: 403 };
  }

  const cedar = push(cedarCheck(tool, nhi.payload, config));
  if (!cedar.ok) {
    push({ stage: "stopped", ok: false, reason: `gateway refused the call: JSON-RPC -32600 ${cedar.reason}` });
    return { ok: false, hops, http: 400 };
  }

  const backend = push(backendCheck(token, config, verifyFn));
  if (!backend.ok) {
    push({ stage: "stopped", ok: false, reason: "call failed at the backend" });
    return { ok: false, hops, http: 502 };
  }

  push({
    stage: "done",
    ok: true,
    reason: `200: ${grant.tools.includes(tool) ? tool : grant.tools.join("/")} served; forwarded token verified by the backend (whoami: iss=${backend.payload.iss}, act.sub=${backend.payload.act && backend.payload.act.sub}, sub=${backend.payload.sub})`
  });
  return { ok: true, hops, http: 200 };
}
