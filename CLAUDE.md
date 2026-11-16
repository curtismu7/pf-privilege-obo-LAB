# pf-privilege-obo-LAB

Demo-tier standalone: simulated PingFederate → Privilege OBO chain (flow sim + measured-issues panel).

- Run: `npm ci && npm start` (port 7812) or `docker compose up --build -d`
- Test: `npm test` (node --test + vitest + repo checks), `npm run doctor`
- Rules that bite: mock-only (Real 409s), loopback-only publish, no raw tokens in run records
  (claims + sha256/8 only), vendored `web/standalone-ui.css` must match the family canonical
  (`npm run test:repo` checks it), scenario data lives in `server/src/scenarios.js`.
- What Privilege did (Rule 25 panel): `POST /api/run` attaches `trace` (built by `server/src/oboTrace.js` from the hops `runChain` computed) and `FlowSim.jsx` renders `<GatewayTrace>` under the run result. The files are vendored byte-for-byte from AI-DEMO-Standalone `shared/gateway-trace` and pinned by `web/src/gateway-trace/gateway-trace.sha256` (`test/gateway-trace.test.js`): `web/src/gateway-trace/*` and `server/src/gatewayTrace.js` (NOT `trace.js`). Never hand-edit them; re-vendor with cp, then re-pin. Honesty rule: this lab is mock only, so its decisions are `checked` only because `runChain` computed them (a check an earlier refusal never reached is `skipped`); a real gateway reports no per-check detail, so if Real is ever added its decisions may only be `inferred` or `observed`. No token (not even the garbage control) goes in a trace, only its length.
