// ETL Phase 3 Slice B2a — pure graph-edit ops: add/remove/update node, connect (with
// self-loop/dup/cycle/unknown guards), remove edge, move node → layout.
import { describe, it, expect } from "vitest";
import { addGraphNode, removeGraphNode, updateGraphNode, connectNodes, connectError, removeGraphEdge, moveNode } from "./graphEdit";
import { planFullLoad } from "../connectors/pipeline/planner";
import { newModel, newEntity, newField, type Model } from "../model/model";
import type { PipelineSpec } from "../connectors/pipeline/spec";

const NOW = "2026-01-01T00:00:00Z";
function base(): PipelineSpec {
  const m: Model = newModel("sales", NOW, "Physical");
  const c = newEntity("Customer", { x: 0, y: 0 });
  c.fields = [newField("id", "uuid", { primaryKey: true, nullable: false })];
  m.entities = [c];
  const spec = planFullLoad(m, ["Customer"], "postgres", { name: "p" });
  spec.nodes = [
    { id: "s", kind: "source", sourceObject: "Customer" },
    { id: "t", kind: "target", targetObject: "dim" },
  ];
  spec.edges = [{ id: "e1", from: "s", to: "t" }];
  return spec;
}

describe("node ops", () => {
  it("adds, updates and removes nodes (remove cascades edges + layout)", () => {
    let spec = addGraphNode(base(), { id: "f", kind: "filter" });
    expect(spec.nodes!.map((n) => n.id)).toContain("f");

    spec = updateGraphNode(spec, "f", { filters: [{ column: "id", op: "is not null" }] });
    expect(spec.nodes!.find((n) => n.id === "f")!.filters).toHaveLength(1);

    spec = moveNode(spec, "s", 10, 20);
    expect(spec.layout!.nodes.find((n) => n.id === "s")).toEqual({ id: "s", x: 10, y: 20 });

    spec = removeGraphNode(spec, "s");
    expect(spec.nodes!.some((n) => n.id === "s")).toBe(false);
    expect(spec.edges!.some((e) => e.from === "s" || e.to === "s")).toBe(false); // incident edge gone
    expect(spec.layout!.nodes.some((n) => n.id === "s")).toBe(false); // layout entry gone
  });
});

describe("connect validation", () => {
  it("adds a valid edge", () => {
    const spec = addGraphNode(base(), { id: "f", kind: "filter" });
    const r = connectNodes(spec, { id: "e2", from: "s", to: "f" });
    expect(r.error).toBeNull();
    expect(r.spec.edges!.some((e) => e.id === "e2")).toBe(true);
  });
  it("rejects self-loops, duplicates, unknown nodes, and cycles", () => {
    const spec = base();
    expect(connectError(spec, { id: "x", from: "s", to: "s" })).toContain("itself");
    expect(connectError(spec, { id: "x", from: "s", to: "t" })).toContain("already exists");
    expect(connectError(spec, { id: "x", from: "s", to: "ghost" })).toContain("unknown node");
    // s→t exists; t→s would cycle.
    expect(connectError(spec, { id: "x", from: "t", to: "s" })).toContain("cycle");
  });
  it("connectNodes leaves the spec unchanged on error", () => {
    const spec = base();
    const r = connectNodes(spec, { id: "x", from: "t", to: "s" });
    expect(r.error).toContain("cycle");
    expect(r.spec).toBe(spec);
  });
});

describe("edge removal", () => {
  it("removes an edge by id", () => {
    const spec = removeGraphEdge(base(), "e1");
    expect(spec.edges).toHaveLength(0);
  });
});
