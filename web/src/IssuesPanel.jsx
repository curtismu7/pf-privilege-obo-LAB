import React from "react";

const SEVERITY_LABEL = {
  blocker: "Blocked us",
  decision: "Open decision",
  warn: "Trap",
  limit: "Product limit",
  honesty: "Honesty note"
};

export default function IssuesPanel({ issues, does, cant }) {
  return (
    <section className="card" data-testid="issues-panel">
      <h2>What this does for Privilege customers</h2>
      <div className="does-cant">
        <div>
          <h3>What Privilege does here</h3>
          <ul>
            {(does || []).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>What Privilege can't (yet)</h3>
          <ul>
            {(cant || []).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      <h2>Issues we hit, and what each costs</h2>
      <p className="hint">Every item below was measured on a real PingFederate-to-Privilege setup, unless it says otherwise on the card.</p>
      <div className="issue-grid">
        {(issues || []).map((issue) => (
          <article key={issue.id} className={`issue-card severity-${issue.severity}`}>
            <header>
              <span className={`chip chip-${issue.severity}`}>{SEVERITY_LABEL[issue.severity] || issue.severity}</span>
              <h3>{issue.title}</h3>
            </header>
            <p>{issue.what}</p>
            <p className="fix">
              <strong>Fix:</strong> {issue.fix}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
