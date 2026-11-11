// Mock PingFederate: mints JWTs (HS256 fixture key) for the OBO chain.
// Everything this issues is mock and labelled; the key is a fixed test fixture.
import { createHmac } from "node:crypto";

const FIXTURE_SECRET = "pf-privilege-obo-lab-fixture-key";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function decodePayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function sign(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", FIXTURE_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verify(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "not a three-part token" };
  const expect = createHmac("sha256", FIXTURE_SECRET).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (parts[2] !== expect) return { ok: false, reason: "bad signature" };
  const payload = decodePayload(token);
  if (!payload) return { ok: false, reason: "undecodable payload" };
  return { ok: true, payload };
}

// The user's subject token: what a real client would hold after SSO sign-in.
export function mintSubjectToken({ user, clientId, issuer }) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    iss: issuer,
    sub: user,
    aud: clientId,
    client_id: clientId,
    scope: "openid profile",
    iat: now,
    exp: now + 300,
    mock: true
  });
}

// The OBO token: PF token exchange output. sub = user, act.sub = agent.
export function mintOboToken({ user, agent, clientId, audience, scope, issuer, actIsText = false, withAct = true }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    sub: user,
    aud: audience,
    client_id: clientId,
    scope,
    iat: now,
    exp: now + 300,
    mock: true
  };
  if (withAct) payload.act = actIsText ? "{}" : { sub: agent };
  return sign(payload);
}
