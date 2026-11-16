// "What Privilege did" for the simulated gateway call (POST /api/run). This lab is mock only (Real 409s), so the trace is always
// source 'mock' and every decision is 'checked': runChain() in privilege.js computed each one, in the order it ran them. A check the
// chain never reached (an earlier one refused the call) is 'skipped'. The simulation has no wire, so the request is the tools/call the
// lab is asked to run (tool name only: it models no arguments) and the reply body is only what the simulation itself says (the
// backend's whoami on a 200, the JSON-RPC refusal on a Cedar block); the other refusals are a status with no body.
// The token is never shown, not even the garbage control (run records never hold a raw token): only its length.
import { mockTrace, bearerForDisplay } from "./gatewayTrace.js";

const NOT_REACHED = "not reached: an earlier check refused the call";

export function oboGatewayTrace({ token, tool, config, result }) {
  const hop = (stage) => result.hops.find((h) => h.stage === stage);
  const decide = (stage, id, label, passText) => {
    const h = hop(stage);
    if (!h) return { id, label, outcome: "skipped", evidence: NOT_REACHED };
    return h.ok ? { id, label, outcome: "pass", evidence: passText(h) } : { id, label, outcome: "fail", evidence: h.reason };
  };
  const decisions = [
    decide("nhi", "nhi", "Workload token (federated identity)", () => "issuer, signature, audience, required claims and lifetime all matched"),
    decide("grant", "grant", "Grant", (h) => `rule ${h.rule} matched the token's scope; it allows ${h.tools.length} tools`),
    decide("cedar", "cedar", "AI policy (Cedar)", () => `policy ${config.cedarPolicy.name} did not refuse ${tool}`),
    decide("backend", "backend", "Backend verification (Pass Agent Token)", () => "the backend verified the forwarded token and its audience")
  ];

  let body = null;
  if (result.ok) {
    const p = hop("backend").payload;
    body = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: `whoami: iss=${p.iss}, act.sub=${p.act && p.act.sub}, sub=${p.sub}` }] } };
  } else if (result.http === 400) {
    body = { jsonrpc: "2.0", id: 1, error: { code: -32600, message: hop("cedar").reason } };
  }

  return mockTrace({
    url: `${config.gatewayHost}/${config.agentAppName}/mcp`,
    authorization: bearerForDisplay("<mock token>", () => token),
    rpc: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool } },
    status: result.http,
    body,
    decisions,
    record: result.hops.at(-1).reason
  });
}
