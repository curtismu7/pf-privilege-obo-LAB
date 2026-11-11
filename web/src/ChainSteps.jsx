import React from "react";

export default function ChainSteps({ steps }) {
  return (
    <section className="card" data-testid="chain-steps">
      <h2>What happens, step by step</h2>
      <ol className="steps-list">
        {(steps || []).map((s) => (
          <li key={s.id}>
            <strong>{s.title}</strong> <span className={`lane lane-${s.lane}`}>{s.lane}</span>
            <p>{s.what}</p>
            <p className="claim">
              <code>{s.claim}</code>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
