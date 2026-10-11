// Derive a starter transform DAG from a flat pipeline spec (Phase 3 Slice D). Lives in
// the pipeline layer so both the planner (new pipelines) and the v2 migration (loaded
// pre-v2 pipelines) can seed a graph without depending on the UI layer. Pure.

import type { PipelineSpec, PipelineNode, PipelineEdge } from "./spec";

/** One source→target pair per object. Index-based ids (deterministic, stable across
 *  re-derivation for the same objects). Does not touch filters/joins — a convenience
 *  seed the user then edits on the canvas, not a lossless translation. */
export function deriveStarterGraph(spec: PipelineSpec): { nodes: PipelineNode[]; edges: PipelineEdge[] } {
  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];
  spec.objects.forEach((obj, i) => {
    const srcId = `n_src_${i}`;
    const tgtId = `n_tgt_${i}`;
    nodes.push({ id: srcId, kind: "source", sourceObject: obj.sourceObject, label: obj.sourceObject });
    nodes.push({ id: tgtId, kind: "target", targetObject: obj.targetObject, label: obj.targetObject });
    edges.push({ id: `e_${i}`, from: srcId, to: tgtId });
  });
  return { nodes, edges };
}
