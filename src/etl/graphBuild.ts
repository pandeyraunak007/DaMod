// Pure helpers for the ETL Designer canvas (Phase 3 Slice B). No DOM, no React.
//  - deriveStarterGraph (re-exported from the pipeline layer): a first node/edge DAG
//    from a flat spec, so an existing pipeline has something to show/edit.
//  - autoLayout: deterministic left-to-right positions by topological depth, used
//    when a spec carries no persisted layout.

import type { PipelineNode, PipelineEdge, PipelineLayout } from "../connectors/pipeline/spec";

export { deriveStarterGraph } from "../connectors/pipeline/graphDerive";

const COL_W = 240;
const ROW_H = 120;

/** Deterministic left-to-right layout: x by topological depth, y by order within a
 *  depth band. Cycle-safe (unresolved nodes fall into depth 0). */
export function autoLayout(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineLayout {
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) if (incoming.has(e.to)) incoming.get(e.to)!.push(e.from);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const ins = incoming.get(id) ?? [];
    const d = ins.length ? Math.max(...ins.map(depthOf)) + 1 : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) depthOf(n.id);

  const perDepth = new Map<number, number>();
  const layoutNodes = nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const row = perDepth.get(d) ?? 0;
    perDepth.set(d, row + 1);
    return { id: n.id, x: d * COL_W, y: row * ROW_H };
  });
  return { nodes: layoutNodes };
}
