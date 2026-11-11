import React, { useMemo, useState, useEffect } from "react";
import ReactFlow, { Background, Controls, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import { postJson } from "./api.js";
import { getDiagram } from "./diagram-data.js";

// Studio diagram data (rule 17): nodes/edges come from data/diagram.json
// (diagram-studio/1 schema) - never hand-built here.
const studio = getDiagram();

// Map studio groups to lane accents.
const GROUP_COLOR = {
  user: "var(--lane-browser, #2a78d6)",
  gw: "var(--lane-mcp, #1baf7a)",
  p1: "var(--lane-idp, #eda100)",
  pf: "var(--lane-agent, #eb6834)",
  backend: "var(--lane-mcp, #1baf7a)",
  privilege: "var(--lane-privilege, #13805a)",
  tools: "var(--lane-mcp, #1baf7a)"
};

function studioNodes() {
  return studio.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: {
      label: [n.label, ...(n.sub || [])].join("\n"),
      lane: n.group
    },
    style: {
      width: 200,
      borderTop: `3px solid ${GROUP_COLOR[n.group] || "var(--control-border, #888)"}`
    }
  }));
}

function studioEdges() {
  return (studio.edges || []).map((e, i) => ({
    id: e.id || `se${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    animated: true
  }));
}

// Which diagram node each chain hop lands on (for walk colouring).
const HOP_INDEX_TO_EDGE = { 0: 2, 1: 3, 2: 4, 3: 5 };

export default function FlowSim({ catalog, activeScenario, onScenarioDone, speed }) {
  const [nodes, setNodes] = useState(() => studioNodes());
  const [edges, setEdges] = useState(() => studioEdges());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [walkIndex, setWalkIndex] = useState(-1);
  const [tool, setTool] = useState("SearchIndexTool");

  useEffect(() => {
    if (!activeScenario) return;
    run(activeScenario);
  }, [activeScenario]);

  const reset = () => {
    setNodes(studioNodes().map((n) => ({ ...n, position: { ...n.position } })));
    setEdges(studioEdges().map((e) => ({ ...e, animated: true, style: undefined, labelStyle: undefined, markerEnd: undefined })));
    setResult(null);
    setWalkIndex(-1);
  };

  const colorEdge = (index, ok) => {
    setEdges((prev) =>
      prev.map((e, i) =>
        i === index
          ? {
              ...e,
              animated: false,
              style: { stroke: ok ? "var(--accent, #b3261e)" : "#d02020", strokeWidth: 3 },
              markerEnd: { type: MarkerType.ArrowClosed, color: ok ? "var(--accent, #b3261e)" : "#d02020" }
            }
          : e
      )
    );
  };

  const run = async (scenario) => {
    setRunning(true);
    setResult(null);
    reset();
    setEdges((prev) => prev.map((e) => ({ ...e, animated: true })));
    // Walk the SSO -> exchange -> run chain with the chosen scenario.
    const delay = (ms) => new Promise((r) => setTimeout(r, ms / (speed || 1)));
    await delay(500);
    colorEdge(0, true); // SSO
    await delay(500);
    // The user comes from the vertical cast (server-side fill uses the pack default).
    const ex = await postJson("/api/exchange", { user: catalog && catalog.cast ? catalog.cast.castUser : "priya.nair" });
    colorEdge(1, ex.status === 200);
    await delay(500);

    // The scenario's own tool wins; the picker is the fallback for custom runs.
    const effectiveTool = scenario.tool || tool;
    if (scenario.tool && scenario.tool !== tool) setTool(scenario.tool);
    const runRes = await postJson("/api/run", {
      scenario: scenario.id,
      subjectToken: ex.body && ex.body.token,
      tool: effectiveTool
    });
    const hops = (runRes.body && runRes.body.hops) || [];
    // Walk edges 2..5 in step with the server hops; the first server hop (nhi)
    // lands on edge 2 (agent -> nhi).
    for (let h = 0; h < hops.length && h < 4; h++) {
      const hop = hops[h];
      setWalkIndex(h);
      colorEdge(2 + h, hop.ok);
      await delay(600);
      if (!hop.ok) break;
    }
    setResult(runRes.body);
    setRunning(false);
    if (onScenarioDone) onScenarioDone(runRes.body);
  };

  const onNodesChange = () => {}; // positions update internally via ReactFlow

  return (
    <section className="card" data-testid="flow-sim">
      <h2>{studio.title}</h2>
      <p className="hint">{studio.lede}</p>
      <div className="flow-controls">
        <label htmlFor="tool-select">Tool: </label>
        <select id="tool-select" value={tool} onChange={(e) => setTool(e.target.value)}>
          {["ListIndexTool", "SearchIndexTool", "ClusterHealthTool", "CountTool"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button type="button" className="btn-primary" disabled={running || !activeScenario} onClick={() => activeScenario && run(activeScenario)}>
          Simulate
        </button>
        <button type="button" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="hint">Speed comes from the header control; Reset restores box positions.</span>
      </div>
      <div className="flow-canvas" style={{ height: 520 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_, node) => setNodes((prev) => prev.map((n) => (n.id === node.id ? node : n)))}
          nodesDraggable
          nodesConnectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {result && (
        <div className={`run-result ${result.ok ? "ok" : "refused"}`} data-testid="run-result">
          <strong>{result.ok ? "ALLOWED" : "REFUSED"}</strong> (HTTP {result.http}) —{" "}
          {result.hops.map((h, i) => (
            <span key={i} className={h.ok ? "hop-ok" : "hop-bad"}>
              {h.stage}
              {i < result.hops.length - 1 ? " → " : ""}
            </span>
          ))}
          <p className="run-reason">{result.hops.at(-1).reason}</p>
          {result.token && result.token.claims && (
            <details>
              <summary>Token claims (mock, labelled)</summary>
              <pre>{JSON.stringify(result.token.claims, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
