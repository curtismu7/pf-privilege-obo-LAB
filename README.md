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
