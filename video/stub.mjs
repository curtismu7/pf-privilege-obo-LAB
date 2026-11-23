#!/usr/bin/env node
// A stand-in for PingFederate and the two Privilege doors, for the SAMPLE video only (loopback, no tenant, nothing leaves the machine).
// It answers the calls the lab's Real mode makes: pi.flow sign-in, the authorization-code token request, the RFC 8693 exchange (the token
// it mints carries `sub` = the sample user and `act` = the agent client, as the live exchange does), the agent-side door (tools/list), the
// gateway door (tools/list and a `whoami` that reports the claims the backend saw) and the 401 for a made-up token. Tokens are unsigned
// (alg none): they are labelled samples. Usage: node video/stub.mjs [port]   (default 6990)
import http from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.argv[2] || process.env.STUB_PORT || 6990);
const BASE = `http://127.0.0.1:${PORT}`;
export const SAMPLE = { user: "sample-user", password: "sample-password-not-real", signin: "sample-signin-client", agent: "sample-agent-client", agentSecret: "sample-agent-secret", signinSecret: "sample-signin-secret", gateway: "sample-gateway-client" };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.sample-signature`;
const basic = (id, s) => `Basic ${Buffer.from(`${id}:${s}`).toString("base64")}`;
const minted = new Set();
let challenge = null;

const reply = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let t = ""; req.on("data", (c) => { t += c; }); req.on("end", () => resolve(t)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const body = await readBody(req);
  if (url.pathname === "/as/authorization.oauth2") { challenge = url.searchParams.get("code_challenge"); return reply(res, 200, { id: "sample-flow-1", status: "USERNAME_PASSWORD_REQUIRED" }, { "set-cookie": "ST=1; Path=/" }); }
  if (url.pathname === "/pf-ws/authn/flows/sample-flow-1") {
    if (req.headers["x-xsrf-header"] !== "PingFederate") return reply(res, 400, { code: "INVALID_REQUEST" });
    const b = JSON.parse(body || "{}");
    if (b.password !== SAMPLE.password) return reply(res, 400, { code: "VALIDATION_ERROR" });
    return reply(res, 200, { status: "COMPLETED", authorizeResponse: { code: "sample-code-1" } });
  }
  if (url.pathname === "/as/token.oauth2") {
    const p = new URLSearchParams(body);
    const now = Math.floor(Date.now() / 1000);
    if (p.get("grant_type") === "authorization_code") {
      if (req.headers.authorization && req.headers.authorization !== basic(SAMPLE.signin, SAMPLE.signinSecret)) return reply(res, 401, { error: "invalid_client" });
      if (createHash("sha256").update(p.get("code_verifier") || "").digest("base64url") !== challenge) return reply(res, 400, { error: "invalid_grant" });
      return reply(res, 200, { id_token: jwt({ iss: BASE, sub: SAMPLE.user, aud: SAMPLE.signin, iat: now, exp: now + 300 }) });
    }
    if (req.headers.authorization !== basic(SAMPLE.agent, SAMPLE.agentSecret)) return reply(res, 401, { error: "invalid_client" });
    const target = p.get("audience") || p.get("resource");
    const t = jwt({ iss: BASE, sub: SAMPLE.user, aud: target, client_id: SAMPLE.agent, act: { sub: SAMPLE.agent }, scope: p.get("scope"), iat: now, exp: now + 3600 });
    minted.add(t);
    return reply(res, 200, { access_token: t, token_type: "Bearer", expires_in: 3600 });
  }
  if (url.pathname === "/agent/mcp" || url.pathname === "/gw/mcp") {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer /, "");
    if (!minted.has(bearer)) return reply(res, 401, { error: "unauthorized", error_description: "Bearer token required" }, { "www-authenticate": `Bearer realm="sample", resource_metadata="${BASE}/.well-known/oauth-protected-resource${url.pathname}"` });
    const rpc = JSON.parse(body || "{}");
    if (rpc.method === "tools/list") return reply(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { tools: url.pathname === "/agent/mcp" ? [{ name: "ListIndexTool" }, { name: "SearchIndexTool" }, { name: "CountTool" }] : [{ name: "whoami" }] } });
    if (rpc.method === "tools/call") {
      const seen = { verifiedBy: "sample-backend", issuer: BASE, subject: SAMPLE.user, audience: "sample-backend.example", clientId: SAMPLE.agent, scope: "mcp whoami:read", actor: { sub: SAMPLE.gateway, act: { sub: SAMPLE.agent } } };
      return reply(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(seen) }] } });
    }
  }
  return reply(res, 404, {});
}).listen(PORT, "127.0.0.1", () => console.log(`sample stand-in on ${BASE}`));
