# pf-privilege-obo-LAB

Demo-tier standalone: simulated PingFederate → Privilege OBO chain (flow sim + measured-issues panel).

- Run: `npm ci && npm start` (port 7812) or `docker compose up --build -d`
- Test: `npm test` (node --test + vitest + repo checks), `npm run doctor`
- Rules that bite: mock-only (Real 409s), loopback-only publish, no raw tokens in run records
  (claims + sha256/8 only), vendored `web/standalone-ui.css` must match the family canonical
  (`npm run test:repo` checks it), scenario data lives in `server/src/scenarios.js`.
