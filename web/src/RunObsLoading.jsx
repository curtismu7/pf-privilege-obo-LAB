import React from "react";

// Rule 27: while a run's record is being read the page says so. It never shows the previous run's record in the meantime (the shared panel has no
// loading state of its own, so this stands in for it, with the same heading and classes).
export default function RunObsLoading() {
  return (
    <section className="ro" data-testid="ro-loading" role="status" aria-label="What each layer logged for this run">
      <h2>What each layer logged for this run</h2>
      <p className="ro-muted">Collecting this run&apos;s logs…</p>
    </section>
  );
}
