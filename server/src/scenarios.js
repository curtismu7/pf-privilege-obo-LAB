// The scenario catalog: what the app demonstrates and the issues it teaches.
// Data-driven so the UI renders whatever is here (rule: stories are data).
//
// THE STORY (AI-first): it opens on the AGENT's side of the glass - an AI agent
// tries to call an MCP tool. Everything before hop 3 is what had to happen so
// that one MCP call can say WHO the person is and WHICH agent is acting.

export const OPENING = {
  headline: "An AI agent tries to call an MCP tool.",
  sub: "It should be refused - and then allowed, provably on behalf of the person who asked. That is the whole demo.",
  call: {
    method: "tools/call",
    tool: "SearchIndexTool",
    args: '{ "index": "payments-2026", "query": "declines by merchant" }',
    jsonrpc: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"SearchIndexTool","arguments":{"index":"payments-2026","query":"declines by merchant"}}}'
  }
};

export const CHAIN_STEPS = [
  {
    id: "call",
    title: "0. The agent calls the MCP tool",
    lane: "backend",
    what: "Start at the end: the AI agent sends tools/call to the MCP server through the Privilege gateway. Two questions decide everything: who is asking (the person), and what is acting for them (the agent). The next five steps are how the call comes to carry both answers.",
    claim: "the call must prove: person + acting agent"
  },
  {
    id: "sso",
    title: "1. The person signs in (PingFederate SSO)",
    lane: "pf",
    what: "The person who asked for the search signs in through PingFederate. The client gets a subject token that proves who the user is - and nothing else. The agent never sees or holds this token.",
    claim: "sub = the user"
  },
  {
    id: "exchange",
    title: "2. Token exchange (RFC 8693)",
    lane: "pf",
    what: "The agent's client exchanges the subject token at PingFederate. PF mints an OBO access token: the user stays in sub, the agent lands in act.sub. This is the only credential the agent holds.",
    claim: "sub = user, act.sub = agent, aud = the agent app URL"
  },
  {
    id: "nhi",
    title: "3. Privilege NHI check",
    lane: "privilege",
    what: "The gateway verifies the token against the Non-Human Identity: signature via the PF JWKS, exact issuer, exact audience, required claims (act.sub, client_id), max lifetime. Anything off is 401 - including a token that proves only the agent and drops the person.",
    claim: "the only credential the agent holds is this PF token"
  },
  {
    id: "grant",
    title: "4. Grant check (tools per agent app)",
    lane: "privilege",
    what: "The agent key's grant lists which tools the agent may reach on this agent app. The token's scope can pick a tier: read tools or admin tools. No matching rule is a bare 403.",
    claim: "scope tiers: same agent, different tools per token scope"
  },
  {
    id: "cedar",
    title: "5. AI policy (Cedar) on the MCP call",
    lane: "privilege",
    what: "Back to the tool call from step 0: an Active Cedar policy can refuse THIS tool unless the token carries a scope. Cedar reads token scopes today; other claims are coming in a later release.",
    claim: "SearchIndexTool needs search:example - or the call dies with JSON-RPC -32600"
  },
  {
    id: "backend",
    title: "6. Pass Agent Token to the MCP server",
    lane: "backend",
    what: "The gateway forwards the verified token UNCHANGED to the MCP backend - the tool call from step 0 finally goes through, and the MCP server can itself see who asked and which agent acted (its own whoami sees every claim). The gateway cannot down-scope it.",
    claim: "what the MCP server got = what the agent sent"
  }
];

export const ISSUES = [
  {
    id: "act-object",
    severity: "blocker",
    title: "act must be an object, not the text \"{}\"",
    what: "PF's access token mapping for act is an expression. If it emits the string \"{}\" instead of an object, the gateway logs required claim \"act.sub\" does not match and the client gets 401.",
    fix: "In the token manager mapping, map act from the expression #{\"sub\": \"<agent-id>\"} - an object."
  },
  {
    id: "resource-param",
    severity: "blocker",
    title: "Every token request must send resource=<agent app URL>",
    what: "Without resource, a scoped request can be served by the DEFAULT token manager. We got a token with the wrong audience and no sub/act, and the gateway answered 401 token_not_found.",
    fix: "Add -d resource=<agent app URL> to every token request; set the ATM's audience claim and Resource URI to the same URL."
  },
  {
    id: "audience",
    severity: "decision",
    title: "Audience: exact agent app URL vs the gateway",
    what: "No wildcard audiences. An exact-match agent app URL is proven to work on our tenant. Ping's guidance: the audience must include the gateway; per-MCP audiences are open; an allow-list is possible on request.",
    fix: "Use the agent app URL end to end (PF ATM + NHI + backend accepted audiences) until Ping confirms the production shape."
  },
  {
    id: "grant-post",
    severity: "blocker",
    title: "Never POST a new grant policy through the API",
    what: "Every API-created grant was deleted by the gateway within 11-80 seconds (RDP terminate: policy deleted). Editing the key's own console-made grant works.",
    fix: "Create the grant in the console (Agent Registry -> tool access) or PUT the existing pacpolicys object."
  },
  {
    id: "sync-button",
    severity: "warn",
    title: "Do not press Sync after saving the grant",
    what: "Sync did not populate the tools list and may reconcile policies away.",
    fix: "Save the grant and leave it; tool discovery happens on the first accepted agent call (gateway v1.261024+)."
  },
  {
    id: "entry-path",
    severity: "blocker",
    title: "The agent app's MCP Server URL must end in exactly /mcp",
    what: "A URL saved as .../mc made the gateway split the path off as the entry path: 404 and gateway log outside entry path \"/mc\".",
    fix: "Edit the agent app so the MCP Server URL ends in /mcp."
  },
  {
    id: "scope-grant",
    severity: "blocker",
    title: "Issuance criteria see the ORIGINAL grant's scope, not the exchange's",
    what: "A client can request an exchange scope its grant never had and PF still mints the token with it. The real caps: the client's scope allowlist at grant time, and the Privilege side (RequiredClaims / Cedar) at redemption.",
    fix: "Say \"the grant is capped by policy and anything else dies at redemption\" - never \"the exchange can't exceed the grant\"."
  },
  {
    id: "down-scope",
    severity: "limit",
    title: "The gateway cannot down-scope the forwarded token",
    what: "Pass Agent Token forwards the same token with every scope in it. The backend gets what the agent sent - proven with a whoami tool.",
    fix: "Put a token exchange in FRONT of the gateway if the backend must see fewer scopes."
  },
  {
    id: "cedar-claims",
    severity: "limit",
    title: "Cedar reads token scopes only (today)",
    what: "context.token.claims (act.sub, client_id) is coming in a later release. Today: claim checks live in the NHI required claims and the grant's RequiredClaims, exact match only.",
    fix: "Use RequiredClaims on grant rules for claim-based tiers now."
  },
  {
    id: "candidate-state",
    severity: "warn",
    title: "An API-created AI policy is a Candidate until set Active",
    what: "State \"\" compiles and logs but never enforces: the gateway logs candidate policy would have returned deny.",
    fix: "Click Enforce in the console, or PUT the policy with \"State\": \"Active\"."
  },
  {
    id: "obo-staging",
    severity: "honesty",
    title: "The OBO claim shape itself is not yet proven end to end",
    what: "The autonomous-agent shape (PF client-credentials token) is fully verified. The OBO shape (sub = user, act.sub = agent) fits the same NHI settings per Ping, but Privilege's OBO support was in staging as of 2026-10-23. Run one exchange with a real subject token and read the claims before a customer demo.",
    fix: "Verify by content: decode the token, check iss/sub/aud/act.sub/scope against the NHI, then one tools/list."
  },
  {
    id: "empty-200",
    severity: "warn",
    title: "200 with an empty body is a stale gateway node, not auth",
    what: "One gateway node kept auth registrations but never got frontend routes: authenticated calls returned 200 with an empty body and Domain ... not found in the log.",
    fix: "Restart that gateway pod; a no-op PUT does not fix it."
  }
];

export const WHAT_PRIVILEGE_DOES = [
  "Trusts PingFederate as the agent's issuer: signature via PF JWKS, exact iss, exact aud, lifetime - anything else is 401",
  "Accepts only this agent: required claims act.sub and client_id must match exactly",
  "Holds no secret for the agent: the PF token is the only credential",
  "Decides which tools, per agent app, and tiers them by token scope",
  "Blocks one tool by scope with an Active Cedar policy",
  "Passes the token through unchanged - the backend verifies it too",
  "Discovers the tools from the first accepted agent call",
  "Switches the agent off: disable the identity or revoke the key"
];

export const WHAT_PRIVILEGE_CANT = [
  "Exchange tokens: the OBO token must come from PingFederate",
  "Down-scope the token it forwards",
  "Run Cedar on other token claims yet (scopes only today)",
  "Wildcard audiences",
  "Keep API-POSTed grants alive (they are deleted within seconds)"
];

export const SCENARIOS = [
  { id: "happy-read", label: "OBO happy path (read tier)", tool: "ListIndexTool", scope: "mcp", expect: "allow" },
  { id: "happy-admin", label: "OBO admin tier (more tools)", tool: "ClusterHealthTool", scope: "mcp admin:example", expect: "allow" },
  { id: "cedar-block", label: "Cedar blocks by scope", tool: "SearchIndexTool", scope: "mcp", expect: "block-cedar" },
  { id: "act-text", label: "act emitted as text \"{}\"", tool: "SearchIndexTool", scope: "mcp", expect: "reject-act" },
  { id: "wrong-audience", label: "Wrong audience (default ATM served it)", tool: "SearchIndexTool", scope: "mcp", expect: "reject-audience" },
  { id: "no-grant", label: "No grant rule matched", tool: "SearchIndexTool", scope: "billing:other", expect: "reject-grant" },
  { id: "garbage", label: "Garbage bearer", tool: "SearchIndexTool", scope: "mcp", expect: "reject-signature" },
  { id: "autonomous", label: "Autonomous shape (no user, no act)", tool: "SearchIndexTool", scope: "mcp", expect: "reject-autonomous" }
];
