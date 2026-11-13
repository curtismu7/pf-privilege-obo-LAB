# pf-privilege-obo-LAB

Demo-tier standalone lab: the **PingFederate → Privilege on-behalf-of (OBO) chain**, simulated.
An AI agent acts for a signed-in user; the lab shows how the user's identity, the agent's identity
and Privilege's enforcement fit together on one screen, plus the twelve issues we hit building it
for real.

## What it shows

1. User signs in (PingFederate SSO) — subject token proves the user.
2. RFC 8693 token exchange — OBO token: `sub` = user, `act.sub` = agent, `aud` = the agent app URL.
3. Privilege NHI check — issuer/JWKS, exact audience, required claims (`act.sub`, `client_id`), max lifetime.
4. Grant check — tools per agent app, tiered by token scope.
5. Cedar AI policy — one tool blocked unless the token carries the scope.
6. Pass Agent Token — the token is forwarded unchanged; the backend verifies it itself.

Eight scenarios: happy path (read + admin tiers), Cedar block, `act` emitted as text, wrong
audience, no matching grant, garbage bearer, autonomous shape (no user, no `act`).

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

Mock / Real toggle in the header. **This lab is mock-only**: Real is disabled with a reason
tooltip, `POST /api/mode {"source":"real"}` answers 409. Everything runs in-process against
`.example` hosts; nothing leaves the machine. Raw token bodies stay server-side — runs record
claims and a sha256/8 hash only. Mock tokens are labelled (`mock: true`).

## Safety

- Loopback-only host bind (0.0.0.0 inside the container only because Docker routes via eth0;
  the host publish is pinned to `127.0.0.1`).
- Host allowlist (`LAB_ALLOWED_HOSTS`) + same-origin write guard + JSON-only writes (415).
- Zero real outbound calls. No identifiers from other projects. No secrets.

## Tests

- `test/server.test.js` — 18 node --test tests (chain scenarios, host/origin guards, token hygiene).
- `test/web.test.jsx` + `test/flowsim-logic.test.jsx` — 11 vitest tests (banner, mode toggle,
  theme picker, scenario runs, Reset semantics, scenario-tool precedence).

## Attribution

Documents the setup measured in the parent demo repository's `privilege/PF-OBO-WITH-PINGFEDERATE-SETUP.md`.
All content here is synthetic (`.example` hosts, invented users).

---

## If the Privilege desktop agent shows "unregistered"

The PingOne Privilege **desktop app** (the one serving the local console at
`https://local.procyon.ai:8643`) stays registered with the Ping cloud through a background
agent (`ping-helper`). When that agent's device record is deleted or unapproved on the cloud
side, every Privilege app on this machine loses Real mode: the local console stops serving,
connections time out, and the desktop app shows the agent as **unregistered**.

### How to tell this is what happened

1. **The desktop app says the agent is unregistered** (banner or the agent status panel), or its
   diagnostics print `✖ Found N errors` with `Device … not found`.
2. **The local console is down with it**: `https://local.procyon.ai:8643` does not answer
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
- Network/VPN blips to `privilege.pingone.com` (`lookup … no such host` in the same log) force
  re-registrations and can churn the device identity, making the window for this bigger.

### How to fix it

1. Open the **PingOne Privilege** desktop app and make sure it is running.
2. Sign in to the **cloud console**: `https://console.pingone.com/?env=<your-privilege-env-id>`
   → launch **PingOne Privilege** → open the **Devices** page.
3. Find this machine's device (`DeviceName: mac-…`, type MAC). It is either:
   - **pending approval** — click **Approve** (the agent's certificate request is waiting;
     this is the usual state after a delete), or
   - **missing entirely** — in the desktop app toggle the agent **off and on** (or quit and
     reopen the app) so it mints a fresh certificate request, then approve it in the console.
4. The agent picks up the approval within seconds (watch
   `/Library/Logs/Procyon/procyon-agent.log` for `Device registered with controller`), and the
   local console at `local.procyon.ai:8643` starts serving again. Real mode in this app works
   immediately after — no restart of the app needed.

### If it comes back

The device being deleted repeatedly is a **console-side action** (admin, sync sweep, or a
server-side guard after repeated network drops). Note the times from
`grep "Delete request recieved" /Library/Logs/Procyon/procyon-agent*.log` and raise it with
 whoever administers the Privilege tenant — re-approving treats the symptom; the deletes have
 to stop for it to stay fixed.
