import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PipelineSpec } from "../connectors/pipeline/spec";
import { autoLayout } from "./graphBuild";

// The ETL Designer's visual pipeline canvas (Phase 3 Slice B). A SEPARATE React-Flow
// instance (own provider) from the modeling canvas — it reads only the pipeline spec's
// node/edge DAG, never the model store, so it can't destabilize modeling. Read-only in
// this slice (select/pan/zoom/fit); node add/connect/configure arrive in Slice B2.
export function PipelineCanvas({
  spec,
  selectedId,
  onSelect,
}: {
  spec: PipelineSpec;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
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

  return (
    <ReactFlowProvider>
      <div style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={undefined}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, n) => onSelect(n.id)}
          onPaneClick={() => onSelect(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
