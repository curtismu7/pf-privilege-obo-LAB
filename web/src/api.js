import React, { useEffect, useState } from "react";

export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(String(e.message || e)));
    return () => {
      live = false;
    };
  }, deps);
  return { data, error };
}

// The run record for the latest run in the current mode (rule 27). 204 = no run yet in this mode.
export async function getRunObservability() {
  const r = await fetch("/api/run-observability", { cache: "no-store" });
  const body = r.status === 204 ? null : await r.json().catch(() => ({ error: "unreadable", message: `The run record could not be read (HTTP ${r.status}).` }));
  return { status: r.status, body };
}

export async function postJson(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}
