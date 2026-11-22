# pf-privilege-obo-LAB

Tier: Demo

Demo-tier standalone lab: the **PingFederate → Privilege on-behalf-of (OBO) chain**, simulated in Mock and live in Real.
An AI agent acts for a signed-in user; the lab shows how the user's identity, the agent's identity
and Privilege's enforcement fit together on one screen, plus the twelve issues we hit building it
for real.

## What it shows

1. User signs in (PingFederate SSO) — subject token proves the user.
2. RFC 8693 token exchange — OBO token: `sub` = user, `act.sub` = agent, `aud` = the agent app URL.
3. Privilege NHI check — issuer/JWKS, exact audience, required claims (`act.sub`, `client_id`), max lifetime.
4. Grant check — tools per agent app, tiered by token scope.
5. Cedar AI policy — one tool blocked unless the token carries the scope, and unless `act.sub` is the approved agent (the claims form is validated on the real console, simulated here).
6. Pass Agent Token — the token is forwarded unchanged; the backend verifies it itself.

Nine scenarios: happy path (read + admin tiers), Cedar block by scope, Cedar block by `act.sub` (a second trusted agent), `act` emitted as text, wrong
audience, no matching grant, garbage bearer, autonomous shape (no user, no `act`).

Under each run the page shows **What Privilege did** (the family's shared trace panel): the request
the agent sent to the simulated gateway, the reply, and the four checks in between (workload token,
grant, Cedar, backend), each marked `checked` because the lab's own simulated gateway computed it
and `skipped` when an earlier check refused the call. No token is shown, only its length.

The Issues panel is the customer story: what Privilege does here, what it can't (yet), and every
trap that cost us time — with the fix for each.

## Run

```bash
npm ci
npm test          # server (node --test) + web (vitest) + repo checks
npm run doctor    # spins a throwaway server on 17812 and proves the mock chain
npm run build     # vite build -> dist/
npm start         # http://localhost:7812
```

Docker (OrbStack only, never Docker Desktop):

```bash
docker compose up --build -d     # publishes 127.0.0.1:7812 only
```

## Modes (rule 19)

Mock / Real toggle in the header.

- **Mock** (default): the simulated chain above. Everything runs in-process against `.example` hosts; nothing leaves the
  machine. Mock tokens are labelled (`mock: true`).
- **Real**: one live on-behalf-of run against your own tenant, shown as numbered frames (open one for what was sent,
  what came back, the decoded token and the spec notes). It is available only when this lab's own `.env` is filled in
  (copy `.env.example`); otherwise Real is disabled with a reason and `POST /api/mode {"source":"real"}` answers 409.
  - **Agent-side (Pass Agent Token):** sign in as a person (PingFederate pi.flow), the agent makes the RFC 8693 exchange,
    the token goes to the Privilege door, which lists tools. Optionally a made-up token is refused.
  - **Gateway OBO (Auth Mode OBO):** the same, then the gateway makes its own exchange for the backend, and a tool on the
    backend reports the claims it received (subject, audience, the nested `act` chain).
  - Real reaches only the hosts named in the settings (the PingFederate issuer and the door hosts; the netguard allows exactly those, and Mock takes them away again).
    Tokens are shown in full (this is a demo; the family shows tokens raw) next to their decoded claims. Client secrets
    and the person's password are write-only: never returned, shown or logged. What Privilege checked is not reported as if the gateway said it: a real gateway returns no
    per-check detail, so the door frame says accepted or refused and labels the checks inferred.
  - Docker: `docker compose up --build -d` reads `.env` through compose's `env_file` (optional; needs Compose 2.24 or later). Compose treats `$` and ` #` in values specially, so single-quote a password or secret that contains them. The publish stays `127.0.0.1` only.
- The video build lives in `video/` (script first, then a sample, then the live take).

## What each layer logged for this run (rule 27)

Under the run the page shows `RunObservability`, the family's shared panel (vendored byte for byte from AI-DEMO-Standalone `shared/run-observability`:
`web/src/run-observability/`, the core `server/src/runObservability.js`, the log readers `server/src/runObservabilityReaders.js` and
`scripts/run-observability-checkPin.mjs`, pinned by `run-observability.sha256`; `test/run-observability.test.js` calls `checkPin`). It lists, for the
latest run in the current mode, what each of six layers (person, agent, Authorize, Privilege, agent gateway, resource server) left behind, in time
order, each row with an origin: `simulated` (Mock: the lab's own mock computed it), `response` (Real: a reply the lab received, never presented as a
log line), `logged` (Real: a line read from the product's own log) or `not-logged` (no line was found; the product may not log this event).

- **The lab's own decisions** are written to stdout, one line each: `[time] INFO: pf-privilege-obo-lab decision layer=… check=… actor=… result=passed|stopped|unclear mode=…`.
  No token, ever. The lines use none of the words the family's matchers read, so a lab line can never become a `logged` row on the wrong layer.
- **Mock** rows: the sign-in and exchange the mock issuer did, the workload-identity check (gateway layer), the grant and AI policy (Privilege layer) and the backend,
  each only if `runChain` reached it. An earlier refusal leaves the later layers `not-logged`.
- **Real** rows: one `response` row per frame the run received (PingFederate's sign-in and exchange replies, the door's status, the backend's report), plus any `logged` row the
  Elasticsearch reader finds. Without `RUN_OBS_ES_URL` and `RUN_OBS_ES_READ_APIKEY` the log layers say `unreachable` and what to set; the lab keeps working.
- **What is `not-logged` today**: the person's sign-in (PingFederate's `audit.log` is not shipped to stdout), Authorize (this lab does not call it), and a gateway refusal
  (no refusal line is confirmed in any gateway log yet). A missing line is never turned into a row.
- **Where the logs live and stream** (the panel's collapsible block says the same): this lab's stdout, then the collector to `demo-logs-<service>`; PingFederate container stdout
  to `ping-logs-pingfederate`; the Privilege gateway's `cyonproxy.log` (local) or the SIEM index `ping-siem-events-v2` and the console Activity Logs (hosted); the backend MCP server's stdout.
- **Settings** (both empty by default, in `.env.example` and passed through `docker-compose.yml`): `RUN_OBS_ES_URL` (a loopback Elasticsearch origin; inside the container loopback is the
  container, so use a forwarder in the lab's network namespace) and `RUN_OBS_ES_READ_APIKEY` (a read-only key; never returned, logged or put in an error). The compose file does **not** mount the
  Docker socket; the Docker reader (`RUN_OBS_DOCKER=1`) is for a throwaway ad-hoc override only. The reader's call goes through the netguard, which lets loopback through and nothing else.

## Safety

- Loopback-only host bind (0.0.0.0 inside the container only because Docker routes via eth0;
  the host publish is pinned to `127.0.0.1`).
- Host allowlist (`LAB_ALLOWED_HOSTS`) + same-origin write guard + JSON-only writes (415).
- Mock: zero real outbound calls. Real: only the hosts named in your own `.env`. No identifiers from other projects in the repo. No secrets.

## Tests

- `test/server.test.js` — 18 node --test tests (chain scenarios, host/origin guards, token hygiene).
- `test/gateway-trace.test.js` + `test/gateway-trace-panel.test.jsx` (and the vendored
  `web/src/gateway-trace/gateway-trace.test.jsx`) — the vendored files' sha256 pin, the trace of
  every scenario through `assertTrace`, no token in a trace, and the panel in the page.
- `test/web.test.jsx` + `test/flowsim-logic.test.jsx` — 11 vitest tests (banner, mode toggle,
  theme picker, scenario runs, Reset semantics, scenario-tool precedence).

## Attribution

Documents the setup measured in the parent demo repository's `privilege/PF-OBO-WITH-PINGFEDERATE-SETUP.md`.
All content here is synthetic (`.example` hosts, invented users).

---

## If the Privilege desktop agent shows "unregistered"

The PingOne Privilege **desktop app** (the one serving the local console at
local port 8643) stays registered with the Ping cloud through a background
agent (`ping-helper`). When that agent's device record is deleted or unapproved on the cloud
side, every Privilege app on this machine loses Real mode: the local console stops serving,
connections time out, and the desktop app shows the agent as **unregistered**.

### How to tell this is what happened

1. **The desktop app says the agent is unregistered** (banner or the agent status panel), or its
   diagnostics print `✖ Found N errors` with `Device … not found`.
2. **The local console is down with it**: the local console on port 8643 does not answer
   (connection refused / timeout) even though the PingOne Privilege app is running.
3. **The agent log loops on one error.** Check `/Library/Logs/Procyon/procyon-agent.log`:

   ```
   Error getting the device: HTTP error: 500 Internal Server Error
   Body: { "error": "Device <base64-id> not found", "code": 2, ... }
   ```

   repeated every ~2 seconds. That single line is the tell: the agent is asking the cloud
   about a device record the cloud no longer has. (A one-off is harmless — it is the endless
   repetition that means unregistered.)

### Why it happens

- The cloud side **deletes or disables the device record** (an admin action in the console, a
  tenant sync, or a guard tripping after network churn). The agent cannot re-create it by
  itself: it re-registers only on an enable/disable cycle, and re-registration **waits for a
  human to approve the new device** in the console.
- Network/VPN blips to the Privilege cloud service host (`lookup … no such host` in the same log) force
  re-registrations and can churn the device identity, making the window for this bigger.

### How to fix it

1. Open the **PingOne Privilege** desktop app and make sure it is running.
2. Sign in to the **cloud console** (the PingOne cloud console, with `?env=<your-privilege-env-id>` for your Privilege environment)
   → launch **PingOne Privilege** → open the **Devices** page.
3. Find this machine's device (`DeviceName: mac-…`, type MAC). It is either:
   - **pending approval** — click **Approve** (the agent's certificate request is waiting;
     this is the usual state after a delete), or
   - **missing entirely** — in the desktop app toggle the agent **off and on** (or quit and
     reopen the app) so it mints a fresh certificate request, then approve it in the console.
4. The agent picks up the approval within seconds (watch
   `/Library/Logs/Procyon/procyon-agent.log` for `Device registered with controller`), and the
   local console on port 8643 starts serving again. Real mode in this app works
   immediately after — no restart of the app needed.

### If it comes back

The device being deleted repeatedly is a **console-side action** (admin, sync sweep, or a
server-side guard after repeated network drops). Note the times from
`grep "Delete request recieved" /Library/Logs/Procyon/procyon-agent*.log` and raise it with
 whoever administers the Privilege tenant — re-approving treats the symptom; the deletes have
 to stop for it to stay fixed.


---

## Real mode: through the PingOne Privilege gateway

Real mode here is one live call through the PingOne Privilege gateway (the origin in
`PFO_GW_URL`) with an agent access key from the shared settings
file (`~/Development/.env`, or the file `STANDALONE_ENV` names).

**Privilege objects this lab uses:** the Agentic App `aggregate-limited` — the gateway's
MCP aggregate with a tool filter — at client path `/aggregate-limited/mcp`, called with the
agent access key `PFO_GW_KEY_LAB_AGENT` (write-only, never shown). **What runs in Real:** the
**Privilege gateway check** (`POST /api/gateway-check`): one live `tools/list` through the
Agentic App,
then one `tools/call` probe of a tool no policy grants, so you see the gateway's own refusal
shape. Settings keys: `PFO_GW_URL`, `PFO_GW_APPS`, `PFO_GW_KEY_<NAME>`.
