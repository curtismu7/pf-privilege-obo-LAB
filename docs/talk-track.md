# Talk track — PF → Privilege OBO Lab

One-liner: "An AI agent acts for a signed-in person. This lab shows how the person's identity
stays with the person, the agent gets its own auditable identity, and Privilege decides what
the agent may do — and every refusal you'll see here is one we actually hit."

## The walk (about 6 minutes)

1. **Point at the banner.** Everything is simulated in-process; nothing leaves the machine;
   tokens are mock and labelled. (10 seconds — say it, don't dwell.)
2. **Point at the opening card.** The story starts on the AI side: an agent is calling
   `tools/call SearchIndexTool` on an MCP server through the Privilege gateway. Two questions
   decide the call — who is asking, and what is acting for them. Everything else on the page
   is how the call comes to carry both answers.
3. **Pick "OBO happy path" and press Simulate.** Watch the walk: SSO → token exchange →
   NHI → grant → Cedar → backend. Open "Token claims": `sub` is the person, `act.sub` is the
   agent. That one claim pair is the whole story: the MCP call says who the person is AND
   which agent acted.
4. **Pick "Cedar blocks by scope".** Same tool call, now refused. The grant let the tool
   through; the AI policy refused it. HTTP 400, JSON-RPC -32600, the policy name is in the
   reason. This is the difference between "what tools exist" (grant) and "is THIS call
   allowed" (policy).
5. **Pick "act emitted as text \"{}\"".** The honest war story: the token was signed by the
   right PingFederate and the issuer matched, but the mapping produced the text `"{}"` instead
   of an object. Refused. Fix the mapping expression, not the identity.
6. **Pick "Autonomous shape".** sub = agent, no act. Refused by the required claim. The point:
   the OBO shape is what keeps the person in the loop — an agent can't quietly drop them.
7. **Scroll to "Issues we hit".** Don't read all twelve. Say: "every card here cost us real
   time on a real tenant; the fix is on the card." Call out one blocker (POSTed grants deleted
   in seconds) and the Honesty card (what's verified vs staging).
8. **Close on the customer story:** agents keep their identity in the customer's own
   PingFederate; Privilege governs which MCP tools they reach with no Privilege-issued secret;
   disabling the identity or revoking the key switches the agent off without touching the user.

## If asked…

- **"Is the OBO shape live?"** — The autonomous-agent shape is verified end to end on our
  tenant. The OBO claim shape fits the same identity settings per Ping but was in staging as
  of 2026-10-23. The lab says so; don't overclaim.
- **"Why does the backend get the same token?"** — Pass Agent Token forwards it unchanged;
  we proved it with a whoami tool that echoed every claim. Down-scoping needs an exchange in
  front of the gateway.
- **"What about the audience?"** — No wildcards. We use the exact agent-app URL end to end;
  Ping's guidance is the gateway audience, per-MCP is open. It's an Open decision card.
- **"Mock or real?"** — Mock-only here by design: it runs anywhere with zero credentials, and
  nothing it shows is invented — the refusals mirror measured log lines.
