#!/usr/bin/env node
// Reset: clear runs by starting the server briefly and calling the API,
// or, if a server is already running on PORT, reset it in place.
const PORT = Number(process.env.PORT || 7812);
const base = `http://127.0.0.1:${PORT}`;
try {
  const r = await fetch(`${base}/api/reset`, { method: "POST" });
  if (r.ok) {
    console.log(`reset: cleared runs on ${base}`);
    process.exit(0);
  }
} catch {}
console.log(`reset: no running server on ${base}; nothing to clear`);
process.exit(0);
