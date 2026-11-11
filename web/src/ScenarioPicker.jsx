import React, { useState } from "react";

export default function ScenarioPicker({ scenarios, active, onSelect }) {
  return (
    <section className="card" data-testid="scenario-picker">
      <h2>Run a scenario</h2>
      <div className="scenario-list">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            className={active && active.id === s.id ? "scenario-btn pressed" : "scenario-btn"}
            aria-pressed={active && active.id === s.id}
            onClick={() => onSelect(s)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active && (
        <p className="hint">
          Expected: <strong>{active.expect}</strong> — tool {active.tool}, scope “{active.scope}”.
        </p>
      )}
    </section>
  );
}
