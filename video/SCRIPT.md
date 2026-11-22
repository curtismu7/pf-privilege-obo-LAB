# Script: on behalf of a person, two ways (the agent exchanges, or the gateway does)

Written first, before any recording (video standard: every video has a script built from the specs and docs actually read, not from memory). `captions.md` carries the on-screen wording and must say what this script says. If a source changes, change the script, then the captions, then retake. Draft 2, 2026-11-22: draft 1 was fact-checked by an independent reader and the corrections are applied (see "Review status"); a second pass is still due once the captions exist.

- **Placeholders:** this repo is public, so the PingFederate client ids and the demo user are written as `<agent-client>`, `<gateway-client>`, `<sign-in-client>` and `<demo-user>`. The real values live only in the lab's `.env` and in the local take.
- **Format:** silent screen capture with numbered captions and full-screen slides, light theme, about 9 minutes. **No slide is held longer than 10 seconds** (owner rule, 2026-11-22). The A2A script wrote this as "at most about 75 words", but 75 words at the family's 4 words a second is about 19 seconds, not 10; this script holds the 10 seconds and caps each slide at **about 40 words**. (Note for the owner: VIDEO-BEST-PRACTICES.md says both numbers; the 40-word reading is the one that keeps the 10-second rule.) Opens and closes with a slide. Two cuts of the same take script: `PROFILE=monitor` and `PROFILE=laptop`, each full screen.
- **Audience:** a colleague who knows what an AI agent is and has met OAuth tokens, but has not read RFC 8693 or seen Privilege's OBO.
- **One idea:** when an agent acts for a person, the token keeps the person as the subject and names the agent beside them. Privilege **records the person and pins the agent** (the identity accepts any subject, so the person is recorded, not pinned; the agent is pinned by the required `act.sub` and `client_id`, SETUP §5). Who does the exchange is a choice: the agent does it and Privilege checks the result (Part 1), or the gateway does it for the backend (Part 2).
- **Part 1, agent-side (Pass Agent Token):** the app's **Agent-side OBO** run on the lab's Real mode. Sign in as the person, exchange, call the door, one refusal.
- **Part 2, gateway OBO (Auth Mode OBO, app `testobo`):** the same person and the same agent. The gateway makes a second exchange and the backend reports what it received.
- **Real, not mock:** every call in the take is live. The Mock mode of the lab is used only for the SAMPLE (labelled), never for the take.

## Sources (read for this script, 2026-11-22)

| Tag | Source | What the script takes from it |
|---|---|---|
| **RFC8693** | OAuth 2.0 Token Exchange, RFC 8693, <https://www.rfc-editor.org/rfc/rfc8693> (fetched and read 2026-11-22) | §1.1 delegation (A keeps its own identity and acts for B; "A is an agent for B") versus impersonation (A is indistinguishable from B); §2.1 request parameters: `subject_token` and `subject_token_type` REQUIRED, `actor_token` OPTIONAL, `resource` an absolute URI naming the target, `audience` a logical name for the target, both OPTIONAL, `scope` OPTIONAL; §4.1 the `act` claim is a JSON object naming the current actor, nested `act` claims are prior actors, and a token consumer **MUST** only consider top-level claims and the current actor for access control (prior actors are informational) |
| **RFC7519** | JSON Web Token, RFC 7519 §4.1.3, <https://www.rfc-editor.org/rfc/rfc7519#section-4.1.3> | **When `aud` is present** (its use is optional), a principal that processes the token **MUST** identify itself with a value in it, and the JWT **MUST** be rejected otherwise; how audience values are read is application specific. "Exact audience, no wildcard" is **not** in the RFC: it is the identity's configuration (SETUP §5) |
| **RFC6750** | Bearer Token Usage, RFC 6750 §2.1, §3, §3.1 | The token goes in `Authorization: Bearer`; an error response carries a challenge; the defined codes include `invalid_token` (401) and `insufficient_scope` (403), both **SHOULD** |
| **RFC9110** | HTTP Semantics, RFC 9110 §15.5.2 (read; it obsoletes RFC 7235) | A 401 means the request lacks valid credentials for the target; the server **MUST** send a `WWW-Authenticate` challenge |
| **RFC9728** | OAuth 2.0 Protected Resource Metadata, RFC 9728 §5.1, <https://www.rfc-editor.org/rfc/rfc9728#section-5.1> (read 2026-11-22) | Defines the `resource_metadata` parameter of the `WWW-Authenticate` header: the URL of the protected resource's metadata. The gateway's 401 carries it (L4, L7) |
| **SETUP** | the parent demo repository's `privilege/PF-OBO-WITH-PINGFEDERATE-SETUP.md` (the repo's measured guide, verified 2026-11-13, sections 4 to 9.1) | The agent-side chain and what each field must be; `act` must be an object; exact audience; the ATM must sign with a published key; the grant's scope tiers gate the tools. Tags there: **[verified]** is ours, **[ping]** is Ping engineers' statement |
| **PROV** | the parent demo repository's `scripts/pingfederate/provision-pf-obo-privilege.js` (header comment) | The PingFederate side of both shapes: client `<agent-client>`, the policy that maps `sub` to the user and `act` to a JSON object, client `<gateway-client>` for the gateway's own exchange, the `testobo` door and backend audience |
| **CONSOLE** | The Privilege local console API, read-only, 2026-11-22 (nothing changed by the read) | App `testobo`: MCP app, **Auth Mode `obo`**, backend `mcp-resource-server`, OBO block: token URL on the PingFederate host, client `<gateway-client>`, auth method `client_secret_basic`, a resource URI, scope `mcp opensearch:read whoami:read`. The client secret is write-only and never shown |
| **LIVE** | The probes run 2026-11-22 (below) and the rehearsal before the take | Every number and claim shown in a scene |
| **LAB** | This repo's README and code | The page, the numbered frames, the decoded-token pop-out |

**Gaps (looked for, not found; the video must not claim them):** no Ping documentation page for the Privilege OBO Auth Mode was read for this script, so every statement about it is the console's own fields plus what we measured, never "Ping says". The 2026-10-23 engineer statements about OBO in staging (in the parent repository's `PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md`) are out of date and are not used. No glossary sentence for "federated identity" or "custodian" from Ping; none is quoted.

## What was measured live on 2026-11-22 (the facts the scenes rely on)

| # | Measurement | Result |
|---|---|---|
| L1 | Sign in as the user with pi.flow on client `<sign-in-client>` (code, then token endpoint) | ID token, `sub` = the user, 300 s |
| L2 | Agent-side exchange: client `<agent-client>`, `subject_token` = that ID token (type `id_token`), `audience` = the `pftoken` door, `scope` = `mcp opensearch:read` | 200. Token: `sub` = the user, `act` = `{"sub":"<agent-client>"}`, `aud` = the door URL, `client_id` = `<agent-client>`, lifetime 3600 s. The request carries **no** `actor_token`: PingFederate writes `act` from its own mapping |
| L3 | `tools/list` on `pftoken` with that token, twice | 200 both times, 3 tools (`ListIndexTool`, `SearchIndexTool`, `CountTool`). The first call was not refused |
| L4 | `tools/list` on `pftoken` with `Bearer not-a-valid-token` | 401 with a `WWW-Authenticate: Bearer realm=…, resource_metadata=…` challenge and a JSON body `error: unauthorized`, `Bearer token required` (not `invalid_token`) |
| L5 | Gateway-shape exchange for the `testobo` door: same client, `resource` = the `testobo` door URL, `scope` = `mcp whoami:read` | 200 with `resource=`. Door token: `sub` = the user, `act` = `{"sub":"<agent-client>"}`, `aud` = the `testobo` door URL, `client_id` = `<agent-client>`, scope `mcp whoami:read`, 3600 s. The same request with `audience=` was refused by PingFederate ("audience value is invalid"). `pftoken` was the other way round (`audience=` works, and its door URL went in `audience`). The video shows each exactly as sent and says only that PingFederate accepted `resource` for this door and `audience` for the other; it does **not** contrast "URI versus logical name" (Part 1 already sends a URL as `audience`) |
| L6 | `tools/call whoami` on `testobo` with that token | 200. The backend reports `verifiedBy: mcp-resource-server`, `sub` = the user, `aud` = `mcp-resource-server.ping.demo` (the backend's own audience, not the door), `client_id` = `<agent-client>`, `act` = `{"sub":"<gateway-client>","act":{"sub":"<agent-client>"}}`, scope `mcp whoami:read` |
| L7 | `tools/list` on `testobo` with a garbage bearer | 401 with the same kind of challenge (`resource_metadata` for the `testobo` door) |
| L8 | The same call before the fix | 502 "backend token exchange failed"; gateway log: `obo exchange refused (status 401, error "invalid_client")`. Cause: the app's OBO client secret was empty. Fixed by the owner-approved write on 2026-11-22. **Not shown in the video** (it is a setup story, not the feature) |

Not yet measured (the scene is cut or marked VERIFY until the rehearsal measures it): the scope-tier refusal (**VERIFY**: a token with only `scope=mcp` is accepted, then refused with 403; documented 2026-11-13, not re-run today); the `pftoken-rs` passthrough `whoami` on the agent-side shape (**VERIFY**, documented 2026-11-13); an `act`-as-text refusal (it cannot be produced against live PingFederate without breaking its mapping, so it is **not** a live scene).

## The two shapes, side by side (the contrast slide)

| | Part 1: agent-side | Part 2: gateway OBO |
|---|---|---|
| Who makes the exchange | The agent, at PingFederate | The agent does the first one; the gateway does a second one for the backend |
| Token the door receives | `sub` = person, `act.sub` = agent, `aud` = the door | the same kind of token, `aud` = the `testobo` door |
| Token the backend receives | The same token, passed through unchanged (Pass Agent Token; documented 2026-11-13, **VERIFY**) | A new token: `aud` = the backend, `act` = the gateway's client with the agent nested |
| Current actor **at the backend** (RFC 8693 §4.1) | the agent | the gateway's client; the agent is a prior actor |

The last row is the honest point of Part 2: RFC 8693 §4.1 says a token consumer considers the top-level claims and the current actor, and treats prior actors as informational. So an RFC-following backend sees the gateway as the actor and the agent in the history trail. The video says "per the RFC"; it does **not** claim `mcp-resource-server` makes any decision on `act` (L6 shows it only reports the claims), and the backend token's top-level `client_id` is still the agent's. At the door (not the backend) the agent is the current actor in both shapes.

## Checks before recording (a script is only true if the run is)

1. Lab `.env` has `PFO_USER_NAME` and `PFO_USER_PASSWORD`; the header toggle is on **Real** and the page says LIVE; the take refuses to run otherwise.
2. Re-probe L1 to L7 within the hour before the take (tokens are minted live; the gateway takes about 4 minutes to pick up any console change).
3. Console state read the same day: `testobo` Auth Mode `obo`; `pftoken` grant not expired ("Ends in N days"); keys the `testobo` agent key and the `pftoken` key enabled.
4. No token and no secret on screen: the page shows claims and a hash only; the signature is never shown.
5. Scan the stills of each cut for the PingFederate and gateway hostnames (see "On screen").

## Scenes

Slides are full screen and unnumbered; caption bubbles are numbered. Exact wording lives in `captions.md`.

| # | On screen | What the viewer reads (gist) | Source |
|---|---|---|---|
| Open | Slide (about 30 words) | Who is asking, and what is acting for them? One token can say both. Two ways to get it: the agent trades for it, or the gateway does. | RFC8693 §1.1 (delegation); framing is narration |
| Slide | RFC slide (about 40 words) | **RFC 8693**: send the token endpoint a token that proves the person; get back a new token. It may name the actor in an `act` claim. `resource` and `audience` say where it will be used. A receiver whose name is not in `aud` must reject it. | RFC8693 §2.1, §4.1; RFC7519 §4.1.3 (when `aud` is present) |
| **Part 1** | | | |
| 1 | Lab, Real, Agent-side tab | The person signs in. The page shows who: the ID token's `sub` and its short life. | L1 |
| 2 | Exchange frame, request pop-out | The agent trades the person's ID token for an access token. The parameters, as sent: grant type, subject token type, `audience`, `scope`. No actor token is sent. | L2; RFC8693 §2.1 |
| 3 | Token pop-out (decoded) | `sub` is the person. `act.sub` is the agent. `aud` is the door. One hour. Signature never shown. Also said once: PingFederate writes `act` from its own mapping; the request sent no actor token (the RFC's `actor_token` is a different, optional route). | L2; RFC8693 §2.1, §4.1; PROV |
| 4 | Door call frame, reply | The agent calls the MCP door with that token. 200, three tools. The identity is **configured** to check issuer, audience, the required `act.sub` and the lifetime; the lab shows this as inferred from the accepted call, not as a per-check log. | L3; SETUP §5 to §7 (a real gateway reports no per-check detail) |
| 5 | Same call, tools list | Three read tools came back: this key's grant gives this token's scope tier those three. | L3; SETUP §7, §9.1 item 4 |
| 6 | "Try a refused call" | The same call with a made-up token. | L4 |
| 7 | Refused frame pop-out | 401 with a `WWW-Authenticate` challenge, as HTTP requires. The challenge includes `resource_metadata`, the URL of the door's metadata. | L4; RFC9110 §15.5.2; RFC9728 §5.1 |
| 8 | Scope-tier refusal (**VERIFY**) | A real token that asks for less (`mcp` only): accepted, then refused on the grant with a bare 403 (SETUP §8). Cut if the rehearsal does not show it. | SETUP §8, §9.1 item 4 (not RFC 6750 §3.1: the live reply is not a coded `insufficient_scope`) |
| Slide | Contrast slide (about 40 words) | Same chain so far. One question left: who makes the exchange? Next, the gateway makes a second one. | table above (trimmed to a gist) |
| **Part 2** | | | |
| 9 | Lab, Real, Gateway OBO tab; console read-out slide (about 30 words) | The app `testobo` is set to Auth Mode OBO. The gateway is configured with its own client, the token URL and a resource, not a user's password. The secret is never shown. | CONSOLE |
| 10 | Exchange frame (agent) | The agent exchanges for a token aimed at the `testobo` door. This request uses `resource`; the earlier one used `audience`. PingFederate accepted each for its own door. | L5; RFC8693 §2.1 |
| 11 | Door call frame | The agent calls `testobo` with it. The gateway checks it and makes **its own** exchange for the backend. | L6; CONSOLE |
| 12 | `whoami` result pop-out | The backend verified the token itself and reports it: `sub` the person, `aud` the backend, and `act` the gateway's client with the agent nested inside. | L6; RFC8693 §4.1 |
| 13 | Highlight on `act` | Current actor versus history: per RFC 8693 §4.1 a consumer looks at the current actor, and the earlier ones are the trail. Here the current actor is the gateway's client and the agent is in the trail. | RFC8693 §4.1; L6 |
| 14 | "Try a refused call" on `testobo` | A made-up token again. | L7 |
| 15 | Refused frame | 401, same kind of challenge for this door. | L7; RFC9110 §15.5.2; RFC9728 §5.1 |
| Slide | Contrast slide (about 40 words) | The two shapes side by side. | table above (trimmed) |
| Close | Slide (about 30 words) | The person stays the subject and the actor is named. Privilege records the person and pins the agent. Who exchanges is a choice. | all |

## On screen: what is masked and what is not

- The token is never displayed; the lab shows decoded claims and a sha256/8 hash. Client secrets and the user's password never appear.
- **Not masked, owner's call before sharing outside the company:** the PingFederate host (the token's `iss` and the token URL) and the gateway host (the door URLs). The console read-out slide is built from the read-only API values and kept local; it is not committed (`video/assets/` and `video/out/` are gitignored).
- The user shown is `<demo-user>` (the account in the vault, not `demouser`). **Decision for the owner:** keep it on screen as is, or supply the `demouser` password so the take shows a friendlier name.

## Not in this video (on purpose)

- How the PingFederate side is built (access token manager, signing key, mapping): the setup guide covers it; it is configuration, not the idea.
- The empty-secret failure and its fix (L8).
- Down-scoping: the gateway cannot down-scope the forwarded token in the agent-side shape (SETUP §8, "not supported" in §9); the video does not promise it.
- Anything about OBO timelines or releases.
- An `act`-as-text refusal and a wrong-audience refusal: neither can be produced live without breaking the shared configuration. The lab's Mock tab shows both; the video points there in the close.

## Review status

- [x] Independent fact check of draft 1 (a second reader, 2026-11-22): the RFC citations held (8693 §1.1, §2.1, §4.1; 6750 §2.1, §3, §3.1; 9110 §15.5.2; 9110 obsoletes 7235). Corrections applied in this draft: "Privilege checks both" became "records the person and pins the agent" (Subject is `*`); "the backend decides on the current actor" became "an RFC-following consumer"; the URI-versus-name framing for `resource`/`audience` was dropped; `resource_metadata` now cites RFC 9728 §5.1 (read); the scope-tier 403 no longer cites RFC 6750 §3.1; "nothing behind the door was reached" and "not all nine" were removed (no source); scene 4 says "configured to check"; scene 9 says "configured with", not "never"; "when `aud` is present" added to the RFC 7519 row; the contrast row says "at the backend"; the slide cap was restated as about 40 words. Residual gaps the reviewer listed and this draft keeps open: the Part 2 per-check gateway log (none exists), the scope-tier refusal and the passthrough (VERIFY).
- [ ] Second pass on draft 2 plus the captions once `captions.md` exists: re-fetch each cited RFC section again and try to refute every caption.
- [ ] Lenses before the SAMPLE: spec accuracy, truth against the live system (L1 to L7 re-run), audience and pacing (words per slide), code review of the lab changes, sensitive-data scan (hostnames, ids, tokens).
- [ ] SAMPLE reviewed by the owner before the live take.
