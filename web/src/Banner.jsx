import React from "react";

// Simulation banner: required first on every page (rule 2).
export default function SimulationBanner({ source }) {
  return (
    <div className="sim-banner" role="note" data-testid="sim-banner">
      <strong>Simulation</strong> — this lab is fully simulated. Mock PingFederate, mock
      Privilege gateway and mock MCP backend run in-process; every token is mock and labelled
      (mode: {source || "mock"}). Nothing leaves this machine. The configuration, refusals and
      log lines mirror what we measured on a real PingFederate-to-Privilege setup.
    </div>
  );
}

export function ModeToggle({ source, onSwitch, info }) {
  const realOk = info && info.realAvailable;
  const title = realOk ? "Switch to Real mode" : info && info.realReason ? info.realReason : "Real mode not configured";
  return (
    <div className="mode-toggle" role="group" aria-label="Mode">
      <button
        type="button"
        aria-pressed={source !== "real"}
        onClick={() => onSwitch("mock")}
        className={source !== "real" ? "mode-btn pressed" : "mode-btn"}
      >
        Mock
      </button>
      <button
        type="button"
        aria-pressed={source === "real"}
        disabled={!realOk}
        title={title}
        onClick={() => onSwitch("real")}
        className={source === "real" ? "mode-btn pressed" : "mode-btn"}
      >
        Real
      </button>
    </div>
  );
}
