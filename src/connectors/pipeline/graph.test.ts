// ETL Phase 3 Slice A — transform-DAG schema propagation + validation (pure).
import { describe, it, expect } from "vitest";
import { inferNodeSchemas, validateGraph } from "./graph";
import { planFullLoad } from "./planner";
import { serializePipeline, parsePipeline, type PipelineSpec, type PipelineNode, type PipelineEdge } from "./spec";
import { newModel, newEntity, newField, type Model } from "../../model/model";

const NOW = "2026-01-01T00:00:00Z";
function model(): Model {
  const m = newModel("sales", NOW, "Physical");
  const c = newEntity("Customer", { x: 0, y: 0 });
  c.fields = [newField("id", "uuid", { primaryKey: true, nullable: false }), newField("email", "string", { length: 320, nullable: false })];
  const o = newEntity("Order", { x: 0, y: 0 });
  o.fields = [newField("id", "uuid", { primaryKey: true, nullable: false }), newField("total", "decimal", { precision: 12, scale: 2 })];
  m.entities = [c, o];
  return m;
}

function specWith(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineSpec {
  const s = planFullLoad(model(), ["Customer"], "postgres", { name: "p" });
  s.nodes = nodes;
  s.edges = edges;
  return s;
}

describe("schema propagation along a linear chain", () => {
  it("source → filter → select(keep+rename) → derive → cast → target", () => {
    const nodes: PipelineNode[] = [
      { id: "n_src", kind: "source", sourceObject: "Customer" },
      { id: "n_flt", kind: "filter", filters: [{ column: "email", op: "is not null" }] },
      { id: "n_sel", kind: "select", keep: ["email"], renames: [{ from: "email", to: "mail" }] },
      { id: "n_der", kind: "derive", derive: [{ name: "flag", expression: "1", type: { type: "integer" } }] },
      { id: "n_cst", kind: "cast", casts: [{ column: "mail", type: { type: "text" } }] },
      { id: "n_tgt", kind: "target", targetObject: "dim" },
    ];
    const edges: PipelineEdge[] = [
      { id: "e1", from: "n_src", to: "n_flt" },
      { id: "e2", from: "n_flt", to: "n_sel" },
      { id: "e3", from: "n_sel", to: "n_der" },
      { id: "e4", from: "n_der", to: "n_cst" },
      { id: "e5", from: "n_cst", to: "n_tgt" },
    ];
    const { schemas, issues } = inferNodeSchemas(specWith(nodes, edges), model());
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    const target = schemas.get("n_tgt")!;
    expect(target.map((f) => f.name)).toEqual(["mail", "flag"]);
    expect(target.find((f) => f.name === "mail")!.type!.type).toBe("text");
    expect(target.find((f) => f.name === "flag")!.type!.type).toBe("integer");
  });
});

describe("join merges both inputs", () => {
  it("left + right fields flow through, duplicate column warned", () => {
    const nodes: PipelineNode[] = [
      { id: "n_a", kind: "source", sourceObject: "Customer" },
      { id: "n_b", kind: "source", sourceObject: "Order" },
      { id: "n_j", kind: "join", joinKind: "inner", on: [{ leftColumn: "id", rightColumn: "id" }] },
      { id: "n_t", kind: "target" },
    ];
    const edges: PipelineEdge[] = [
      { id: "e1", from: "n_a", to: "n_j", toPort: "left" },
      { id: "e2", from: "n_b", to: "n_j", toPort: "right" },
      { id: "e3", from: "n_j", to: "n_t" },
    ];
    const { schemas, issues } = inferNodeSchemas(specWith(nodes, edges), model());
    const join = schemas.get("n_j")!;
    expect(join.map((f) => f.name).sort()).toEqual(["email", "id", "id", "total"].sort());
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("duplicate column"))).toBe(true);
  });
});

describe("validation", () => {
  const chain = (extra: Partial<PipelineNode>): ReturnType<typeof validateGraph> =>
    validateGraph(
      specWith(
        [{ id: "n_src", kind: "source", sourceObject: "Customer" }, { id: "n_x", kind: "filter", ...extra } as PipelineNode],
        [{ id: "e1", from: "n_src", to: "n_x" }],
      ),
      model(),
    );

  it("flags a filter on an unknown column", () => {
    expect(chain({ kind: "filter", filters: [{ column: "nope", op: "=", value: "1" }] }).some((i) => i.message.includes("unknown column"))).toBe(true);
  });
  it("flags an unknown source object", () => {
    const issues = validateGraph(specWith([{ id: "n_src", kind: "source", sourceObject: "Ghost" }], []), model());
    expect(issues.some((i) => i.message.includes("not in model"))).toBe(true);
  });
  it("flags a dangling edge", () => {
    const issues = validateGraph(specWith([{ id: "n_src", kind: "source", sourceObject: "Customer" }], [{ id: "e1", from: "n_src", to: "missing" }]), model());
    expect(issues.some((i) => i.message.includes("unknown node"))).toBe(true);
  });
  it("detects a cycle", () => {
    const issues = validateGraph(
      specWith(
        [{ id: "a", kind: "filter" }, { id: "b", kind: "filter" }],
        [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "a" }],
      ),
      model(),
    );
    expect(issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });
  it("flags a derive duplicate column", () => {
    const issues = validateGraph(
      specWith(
        [{ id: "n_src", kind: "source", sourceObject: "Customer" }, { id: "n_d", kind: "derive", derive: [{ name: "email", expression: "x", type: { type: "text" } }] }],
        [{ id: "e1", from: "n_src", to: "n_d" }],
      ),
      model(),
    );
    expect(issues.some((i) => i.message.includes("duplicates an existing column"))).toBe(true);
  });
});

describe("aggregate node (G-AGG)", () => {
  it("outputs group-by columns + one typed column per measure", () => {
    const nodes: PipelineNode[] = [
      { id: "s", kind: "source", sourceObject: "Order" },
      { id: "a", kind: "aggregate", groupBy: ["id"], aggregates: [{ fn: "sum", column: "total", as: "total_sum" }, { fn: "count", as: "n" }] },
      { id: "t", kind: "target" },
    ];
    const edges: PipelineEdge[] = [{ id: "e1", from: "s", to: "a" }, { id: "e2", from: "a", to: "t" }];
    const { schemas, issues } = inferNodeSchemas(specWith(nodes, edges), model());
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    const agg = schemas.get("a")!;
    expect(agg.map((f) => f.name)).toEqual(["id", "total_sum", "n"]);
    expect(agg.find((f) => f.name === "total_sum")!.type!.type).toBe("decimal");
    expect(agg.find((f) => f.name === "n")!.type!.type).toBe("bigint");
  });

  it("flags unknown group-by / measure columns and a missing output name", () => {
    const nodes: PipelineNode[] = [
      { id: "s", kind: "source", sourceObject: "Order" },
      { id: "a", kind: "aggregate", groupBy: ["nope"], aggregates: [{ fn: "sum", column: "ghost", as: "" }] },
    ];
    const edges: PipelineEdge[] = [{ id: "e1", from: "s", to: "a" }];
    const issues = validateGraph(specWith(nodes, edges), model());
    expect(issues.some((i) => i.message.includes("Group-by column"))).toBe(true);
    expect(issues.some((i) => i.message.includes("unknown column"))).toBe(true);
    expect(issues.some((i) => i.message.includes("needs a name"))).toBe(true);
  });
});

describe("node/edge serialization round-trip", () => {
  it("serializes nodes+edges deterministically (sorted by id) and round-trips", () => {
    const nodes: PipelineNode[] = [
      { id: "n_b", kind: "filter", filters: [{ column: "email", op: "is not null" }] },
      { id: "n_a", kind: "source", sourceObject: "Customer" },
    ];
    const edges: PipelineEdge[] = [{ id: "e1", from: "n_a", to: "n_b" }];
    const spec = specWith(nodes, edges);
    const once = serializePipeline(spec);
    expect(once.indexOf('"n_a"')).toBeLessThan(once.indexOf('"n_b"')); // nodes sorted by id
    const parsed = parsePipeline(JSON.parse(once));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializePipeline(parsed.value)).toBe(once);
      expect(parsed.value.nodes).toHaveLength(2);
      expect(parsed.value.edges).toHaveLength(1);
    }
  });
});
