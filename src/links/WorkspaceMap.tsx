import { useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
  type EdgeMouseHandler,
} from "@xyflow/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { Link } from "./links";

// The workspace map (FR-6.3): every model as a node, every pair of models with a
// line labelled by its link count; clicking a line lists that pair's links.
export function WorkspaceMap({ onClose }: { onClose: () => void }) {
  const allModels = useWorkspaceStore((s) => s.allModels);
  const links = useWorkspaceStore((s) => s.links.links);

  const models = allModels();

  const pairs = useMemo(() => {
    const map = new Map<string, { a: string; b: string; links: Link[] }>();
    for (const l of links) {
      if (l.from.model === l.to.model) continue;
      const [a, b] = [l.from.model, l.to.model].sort();
      const key = `${a}|${b}`;
      if (!map.has(key)) map.set(key, { a, b, links: [] });
      map.get(key)!.links.push(l);
    }
    return map;
  }, [links]);

  const nodes: Node[] = useMemo(() => {
    const n = models.length || 1;
    return models.map((m, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return {
        id: m.id,
        position: { x: 300 + 200 * Math.cos(angle), y: 200 + 160 * Math.sin(angle) },
        data: { label: m.name },
        style: { border: "1.5px solid #64748b", borderRadius: 8, padding: 6, fontWeight: 600 },
      };
    });
  }, [models]);

  const edges: Edge[] = useMemo(
    () =>
      [...pairs.entries()].map(([key, p]) => ({
        id: key,
        source: p.a,
        target: p.b,
        label: String(p.links.length),
        labelStyle: { fontWeight: 700 },
        style: { stroke: "#8b5cf6", strokeWidth: 2 },
      })),
    [pairs],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const onEdgeClick: EdgeMouseHandler = (_, edge) => setSelected(edge.id);

  const nameFor = (m: string, e: string) => {
    const mm = models.find((x) => x.id === m);
    const ent = mm?.model.entities.find((en) => en.id === e);
    return `${mm?.name ?? "?"}.${ent?.name ?? "?"}`;
  };

  const selectedPair = selected ? pairs.get(selected) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--map" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Workspace map</h2>
        <div className="map__flow">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onEdgeClick={onEdgeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
        {models.length < 2 && (
          <p className="field__hint">Create a second model to see links between models.</p>
        )}
        {selectedPair && (
          <div className="map__links">
            <strong>
              {models.find((m) => m.id === selectedPair.a)?.name} ↔{" "}
              {models.find((m) => m.id === selectedPair.b)?.name}
            </strong>
            <ul className="whereused">
              {selectedPair.links.map((l) => (
                <li key={l.id} className="whereused__row">
                  <span>
                    {l.type}: {nameFor(l.from.model, l.from.entity)} →{" "}
                    {nameFor(l.to.model, l.to.entity)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="modal__actions">
          <button className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
