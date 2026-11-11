import React, { useState } from "react";

// Opening card: the story starts on the AI side - an agent tries to call an
// MCP tool. Everything else on the page explains how that one call proves
// who asked and which agent acted.
export default function OpeningCard({ opening }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!opening) return null;
  return (
    <section className="card opening-card" data-testid="opening-card">
      <h2>{opening.headline}</h2>
      <p className="opening-sub">{opening.sub}</p>
      <div className="mcp-call" aria-label="The agent's MCP tool call">
        <div className="mcp-call-row">
          <span className="chip chip-agent">AI agent</span>
          <span className="mcp-arrow">→</span>
          <span className="chip chip-gw">Privilege gateway</span>
          <span className="mcp-arrow">→</span>
          <span className="chip chip-mcp">MCP server</span>
        </div>
        <pre className="mcp-request">
          {showRaw ? opening.call.jsonrpc : `tools/call  ${opening.call.tool}\n${opening.call.args}`}
        </pre>
        <div className="mcp-call-footer">
          <button type="button" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Show summary" : "Show raw JSON-RPC"}
          </button>
          <span className="hint">
            Two questions decide this call: <strong>who is asking</strong> (the person) and{" "}
            <strong>what is acting for them</strong> (the agent). The chain below is how the call carries both.
          </span>
        </div>
      </div>
    </section>
  );
}
