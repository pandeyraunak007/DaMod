import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge, type Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PipelineSpec } from "../connectors/pipeline/spec";
import { autoLayout } from "./graphBuild";
import { moveNode, connectNodes, removeGraphNode, removeGraphEdge } from "./graphEdit";

const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);

// The ETL Designer's visual pipeline canvas (Phase 3 Slice B). A SEPARATE React-Flow
// instance (own provider) from the modeling canvas — it reads only the pipeline spec's
// node/edge DAG, never the model store. Edits (drag/connect/delete) produce a new spec
// via the pure graphEdit ops and are handed up through onChange for persistence.
export function PipelineCanvas({
  spec,
  selectedId,
  onSelect,
  onChange,
  onError,
}: {
  spec: PipelineSpec;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: PipelineSpec) => void;
  onError: (msg: string) => void;
}) {
  const graphNodes = spec.nodes ?? [];
  const graphEdges = spec.edges ?? [];
  const layout = spec.layout && spec.layout.nodes.length ? spec.layout : autoLayout(graphNodes, graphEdges);
  const posById = new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  const nodes: Node[] = graphNodes.map((n) => ({
    id: n.id,
    position: posById.get(n.id) ?? { x: 0, y: 0 },
    data: { label: n.label ? `${n.kind}: ${n.label}` : n.kind },
    selected: n.id === selectedId,
    className: `etl-node etl-node--${n.kind}`,
  }));
  const edges: Edge[] = graphEdges.map((e) => ({ id: e.id, source: e.from, target: e.to }));

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target) return;
    // Assign a join's left/right port by current incoming count (first→left, second→right).
    const target = graphNodes.find((n) => n.id === c.target);
    let toPort: "left" | "right" | undefined;
    if (target?.kind === "join") {
      toPort = graphEdges.filter((e) => e.to === c.target).length === 0 ? "left" : "right";
    }
    const r = connectNodes(spec, { id: uid("ed_"), from: c.source, to: c.target, toPort });
    if (r.error) onError(r.error);
    else onChange(r.spec);
  };

  return (
    <ReactFlowProvider>
      <div style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable
          nodesConnectable
          elementsSelectable
          deleteKeyCode={["Delete", "Backspace"]}
          onNodeClick={(_, n) => onSelect(n.id)}
          onPaneClick={() => onSelect(null)}
          onConnect={onConnect}
          onNodeDragStop={(_, n) => onChange(moveNode(spec, n.id, Math.round(n.position.x), Math.round(n.position.y)))}
          onNodesDelete={(deleted) => onChange(deleted.reduce((s, n) => removeGraphNode(s, n.id), spec))}
          onEdgesDelete={(deleted) => onChange(deleted.reduce((s, e) => removeGraphEdge(s, e.id), spec))}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
