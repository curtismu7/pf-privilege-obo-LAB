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

// The run record of one run in the current mode (rule 27); without a run id, the newest finished run of this mode. 204 = no such run (the record is
// null: the page shows its empty state). Anything that is not a run record, in any status, is { error, message } for the page's alert: a body that is
// not JSON, valid JSON that is not an object, an object with no rows, or an error answer without a reason.
// fresh: the deliberate Re-read (the collector ships lines late), which asks the server to rebuild the record instead of serving the one it kept for a few seconds.
export async function getRunObservability(runId, { fresh = false } = {}) {
  const query = [runId ? `runId=${encodeURIComponent(runId)}` : "", fresh ? "fresh=1" : ""].filter(Boolean).join("&");
  const r = await fetch(`/api/run-observability${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => null);
  const isObject = body !== null && typeof body === "object" && !Array.isArray(body);
  if (r.status === 200 && isObject && Array.isArray(body.rows)) return body;
  return {
    error: (isObject && typeof body.error === "string" && body.error) || (r.status === 200 ? "bad_answer" : `http_${r.status}`),
    message: (isObject && typeof body.message === "string" && body.message) || (r.status === 200 ? "The lab answered something that is not a run record." : `The run record could not be read (HTTP ${r.status}).`),
  };
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
