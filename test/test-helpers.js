// Shared test-server teardown: close() alone stops listening but leaves the client's
// keep-alive sockets open. With thousands of servers binding and closing per second,
// undici can retry a pooled request onto the next process that binds the same port and
// get answered by the WRONG server (the intermittent 401/404-where-403 flake).
// stop() destroys every connection first, so a stopped server can never answer again.
export const stop = (srv) => {
  try { srv.closeAllConnections(); } catch { /* not an http.Server (no connections) */ }
  return new Promise((resolve) => srv.close(() => resolve()));
};

import { randomBytes } from 'node:crypto';

// Ambient processes on these machines hold listeners with SO_REUSEPORT-style semantics
// (claude-code, Logi Options+ agent, OrbStack). When the OS hands one of their ports to
// listen(0), macOS shares it and delivery between the two listeners is nondeterministic:
// the test's fetch can be answered by the foreign listener (a 404/401 from the wrong
// server — the second flake channel, seen even with closeAllConnections in place).
// startVerified binds, then round-trips a unique marker through the app itself
// (/api/__port-verify echoes it back); a foreign listener cannot. On mismatch or error
// it rebinds on a fresh port, up to `tries`.
export async function startVerified(makeServer, { tries = 5 } = {}) {
  process.env.WI_VERIFY_PORT = '1'; // the verify route answers only when this is set
  for (let attempt = 0; attempt < tries; attempt++) {
    const srv = await makeServer();
    const marker = randomBytes(12).toString('hex');
    const ok = await new Promise((resolve) => {
      const req = fetch(`http://127.0.0.1:${srv.address().port}/api/__port-verify`, { headers: { 'x-wi-port-verify': marker } });
      req.then(async (res) => {
        await res.text();
        resolve(res.headers.get('x-wi-port-verify') === marker);
      }).catch(() => resolve(false));
      // the marker round-trip must answer quickly: a foreign listener that swallows
      // connections would hang; bail out and rebind
      setTimeout(() => resolve(false), 2000).unref?.();
    });
    if (ok) return srv;
    await stop(srv);
  }
  throw new Error('could not find a port no other listener shares (5 verified attempts)');
}
