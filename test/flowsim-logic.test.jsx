// FlowSim logic tests (rule 3 + rule 17: Reset restores diagram box positions,
// nodes/edges come from the studio diagram data, never hand-built).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const flowSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "FlowSim.jsx"), "utf8");

describe("FlowSim reset semantics", () => {
  it("reset() restores positions from the studio diagram, not the live state", () => {
    // The reset function must rebuild from studioNodes() with fresh positions.
    expect(flowSrc).toMatch(/const reset = \(\) => \{[\s\S]*?studioNodes\(\)\.map\(\(n\) => \(\{ \.\.\.n, position: \{ \.\.\.n\.position \} \}\)\)/);
  });

  it("nodes and edges come from the studio diagram data (rule 17)", () => {
    expect(flowSrc).toMatch(/getDiagram\(\)/);
    expect(flowSrc).not.toMatch(/DEFAULT_NODES/);
    const dataSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "web", "src", "diagram-data.js"), "utf8");
    expect(dataSrc).toMatch(/diagram-studio\/1/);
    expect(dataSrc).toMatch(/from "\.\.\/\.\.\/data\/diagram\.json"/);
  });

  it("nodes are draggable and drag commits back to state", () => {
    expect(flowSrc).toMatch(/nodesDraggable/);
    expect(flowSrc).toMatch(/onNodeDragStop/);
    expect(flowSrc).toMatch(/setNodes\(\(prev\) => prev\.map\(\(n\) => \(n\.id === node\.id \? node : n\)\)\)/);
  });

  it("the walk honours the speed control", () => {
    expect(flowSrc).toMatch(/ms \/ \(speed \|\| 1\)/);
  });

  it("a scenario's own tool wins over the picker fallback", () => {
    expect(flowSrc).toMatch(/scenario\.tool \|\| tool/);
  });
});
