// ETL Phase 3 Slice B — pure canvas helpers (derive starter graph + auto-layout).
import { describe, it, expect } from "vitest";
import { deriveStarterGraph, autoLayout } from "./graphBuild";
import { planFullLoad } from "../connectors/pipeline/planner";
import { inferNodeSchemas } from "../connectors/pipeline/graph";
import { newModel, newEntity, newField, type Model } from "../model/model";

const NOW = "2026-01-01T00:00:00Z";
function model(): Model {
  const m = newModel("sales", NOW, "Physical");
  const c = newEntity("Customer", { x: 0, y: 0 });
  c.fields = [newField("id", "uuid", { primaryKey: true, nullable: false }), newField("email", "string", { nullable: false })];
  const o = newEntity("Order", { x: 0, y: 0 });
  o.fields = [newField("id", "uuid", { primaryKey: true, nullable: false })];
  m.entities = [c, o];
  return m;
}

describe("deriveStarterGraph", () => {
  it("creates a source→target pair per object with stable index-based ids", () => {
    const spec = planFullLoad(model(), ["Customer", "Order"], "postgres", { name: "p" });
    const { nodes, edges } = deriveStarterGraph(spec);
    expect(nodes).toHaveLength(4); // 2 source + 2 target
    expect(nodes.filter((n) => n.kind === "source").map((n) => n.sourceObject).sort()).toEqual(["Customer", "Order"]);
    expect(edges).toHaveLength(2);
    // Deterministic: re-derivation yields identical ids.
    expect(deriveStarterGraph(spec)).toEqual({ nodes, edges });
  });

  it("produces a graph the schema engine can propagate", () => {
    const spec = planFullLoad(model(), ["Customer"], "postgres", { name: "p" });
    const g = deriveStarterGraph(spec);
    spec.nodes = g.nodes;
    spec.edges = g.edges;
    const { schemas, issues } = inferNodeSchemas(spec, model());
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    // target mirrors the source's fields through the identity edge.
    expect(schemas.get("n_tgt_0")!.map((f) => f.name).sort()).toEqual(["email", "id"]);
  });
});

describe("autoLayout", () => {
  it("places nodes left-to-right by topological depth, deterministically", () => {
    const nodes = [
      { id: "s", kind: "source" as const, sourceObject: "Customer" },
      { id: "f", kind: "filter" as const },
      { id: "t", kind: "target" as const },
    ];
    const edges = [
      { id: "e1", from: "s", to: "f" },
      { id: "e2", from: "f", to: "t" },
    ];
    const layout = autoLayout(nodes, edges);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;
    expect(x("s")).toBeLessThan(x("f"));
    expect(x("f")).toBeLessThan(x("t"));
    expect(autoLayout(nodes, edges)).toEqual(layout); // deterministic
  });

  it("is cycle-safe (does not infinite-loop)", () => {
    const nodes = [{ id: "a", kind: "filter" as const }, { id: "b", kind: "filter" as const }];
    const edges = [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "a" }];
    expect(() => autoLayout(nodes, edges)).not.toThrow();
    expect(autoLayout(nodes, edges).nodes).toHaveLength(2);
  });
});
