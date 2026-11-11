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

export async function postJson(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}
