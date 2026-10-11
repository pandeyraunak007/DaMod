// Pure graph-edit operations for the ETL Designer canvas (Phase 3 Slice B2). Each
// returns a NEW PipelineSpec (the caller persists via upsertPipeline). No DOM, no React.
// Node/edge ids are supplied by the caller (UI mints them) so these stay deterministic
// and unit-testable. Edge connection is validated: no self-loop, no duplicate, no cycle.

import type { PipelineSpec, PipelineNode, PipelineEdge } from "../connectors/pipeline/spec";

function nodes(spec: PipelineSpec): PipelineNode[] {
  return spec.nodes ?? [];
}
function edges(spec: PipelineSpec): PipelineEdge[] {
  return spec.edges ?? [];
}

/** Append a node (caller provides a unique id). */
export function addGraphNode(spec: PipelineSpec, node: PipelineNode): PipelineSpec {
  return { ...spec, nodes: [...nodes(spec), node] };
}

/** Remove a node and every incident edge + its layout entry. */
export function removeGraphNode(spec: PipelineSpec, nodeId: string): PipelineSpec {
  return {
    ...spec,
    nodes: nodes(spec).filter((n) => n.id !== nodeId),
    edges: edges(spec).filter((e) => e.from !== nodeId && e.to !== nodeId),
    ...(spec.layout ? { layout: { nodes: spec.layout.nodes.filter((n) => n.id !== nodeId) } } : {}),
  };
}

/** Patch a node's config (id/kind preserved unless explicitly overridden). */
export function updateGraphNode(spec: PipelineSpec, nodeId: string, patch: Partial<PipelineNode>): PipelineSpec {
  return { ...spec, nodes: nodes(spec).map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) };
}

/** True when `to` can already reach `from` (so adding from→to would create a cycle). */
function reaches(es: PipelineEdge[], from: string, to: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of es) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of adj.get(cur) ?? []) stack.push(nxt);
  }
  return false;
}

/** Validate a prospective connection; returns an error message or null. */
export function connectError(spec: PipelineSpec, edge: PipelineEdge): string | null {
  if (edge.from === edge.to) return "A node cannot connect to itself";
  const ids = new Set(nodes(spec).map((n) => n.id));
  if (!ids.has(edge.from) || !ids.has(edge.to)) return "Connection references an unknown node";
  if (edges(spec).some((e) => e.from === edge.from && e.to === edge.to && e.toPort === edge.toPort)) return "That connection already exists";
  if (reaches(edges(spec), edge.to, edge.from)) return "Connection would create a cycle";
  return null;
}

/** Add an edge if valid; otherwise return the unchanged spec plus an error. */
export function connectNodes(spec: PipelineSpec, edge: PipelineEdge): { spec: PipelineSpec; error: string | null } {
  const error = connectError(spec, edge);
  if (error) return { spec, error };
  return { spec: { ...spec, edges: [...edges(spec), edge] }, error: null };
}

/** Remove an edge by id. */
export function removeGraphEdge(spec: PipelineSpec, edgeId: string): PipelineSpec {
  return { ...spec, edges: edges(spec).filter((e) => e.id !== edgeId) };
}

/** Set a node's canvas position (updates or inserts its layout entry). */
export function moveNode(spec: PipelineSpec, nodeId: string, x: number, y: number): PipelineSpec {
  const existing = spec.layout?.nodes ?? [];
  const without = existing.filter((n) => n.id !== nodeId);
  return { ...spec, layout: { nodes: [...without, { id: nodeId, x, y }] } };
}
