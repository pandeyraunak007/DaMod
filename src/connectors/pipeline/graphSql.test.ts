// ETL Phase 3 Slice C — graph-aware SQL generation (pure, design-time, never executed).
import { describe, it, expect } from "vitest";
import { graphSql } from "./graphSql";
import { planFullLoad } from "./planner";
import { newModel, newEntity, newField, type Model, type DbDialect } from "../../model/model";
import type { PipelineSpec, PipelineNode, PipelineEdge } from "./spec";

const NOW = "2026-01-01T00:00:00Z";
function model(dialect?: DbDialect): Model {
  const m = newModel("sales", NOW, "Physical", dialect);
  const c = newEntity("Customer", { x: 0, y: 0 });
  c.fields = [newField("id", "uuid", { primaryKey: true, nullable: false }), newField("email", "string", { nullable: false })];
  const o = newEntity("Order", { x: 0, y: 0 });
  o.fields = [newField("id", "uuid", { primaryKey: true, nullable: false }), newField("total", "decimal", { precision: 12, scale: 2 })];
  m.entities = [c, o];
  return m;
}
function spec(nodes: PipelineNode[], edges: PipelineEdge[], dialect?: DbDialect): { spec: PipelineSpec; model: Model } {
  const m = model(dialect);
  const s = planFullLoad(m, ["Customer"], "postgres", { name: "p" });
  s.nodes = nodes;
  s.edges = edges;
  return { spec: s, model: m };
}

describe("graphSql", () => {
  it("emits a WITH-chain of per-node CTEs ending in the target", () => {
    const { spec: s, model: m } = spec(
      [{ id: "src", kind: "source", sourceObject: "Customer" }, { id: "tgt", kind: "target", targetObject: "dim" }],
      [{ id: "e1", from: "src", to: "tgt" }],
    );
    const { sql, unsupported } = graphSql(s, m);
    expect(unsupported).toHaveLength(0);
    expect(sql).toContain('"src" AS (\n  SELECT * FROM "Customer"\n)');
    expect(sql).toContain('"tgt" AS (\n  SELECT * FROM "src"\n)');
    expect(sql.trim().endsWith('SELECT * FROM "tgt";')).toBe(true);
  });

  it("filter → WHERE, derive → expr column, cast → CAST", () => {
    const { spec: s, model: m } = spec(
      [
        { id: "src", kind: "source", sourceObject: "Customer" },
        { id: "flt", kind: "filter", filters: [{ column: "email", op: "is not null" }] },
        { id: "der", kind: "derive", derive: [{ name: "flag", expression: "1", type: { type: "integer" } }] },
        { id: "cst", kind: "cast", casts: [{ column: "email", type: { type: "text" } }] },
        { id: "tgt", kind: "target" },
      ],
      [
        { id: "e1", from: "src", to: "flt" },
        { id: "e2", from: "flt", to: "der" },
        { id: "e3", from: "der", to: "cst" },
        { id: "e4", from: "cst", to: "tgt" },
      ],
    );
    const { sql } = graphSql(s, m);
    expect(sql).toContain('WHERE "email" IS NOT NULL');
    expect(sql).toContain('SELECT *, 1 AS "flag" FROM "der"'.replace("der", "flt")); // derive reads from flt
    expect(sql).toContain('CAST("email" AS text) AS "email"');
  });

  it("select renders keep + rename as an explicit column list", () => {
    const { spec: s, model: m } = spec(
      [{ id: "src", kind: "source", sourceObject: "Customer" }, { id: "sel", kind: "select", keep: ["email"], renames: [{ from: "email", to: "mail" }] }, { id: "tgt", kind: "target" }],
      [{ id: "e1", from: "src", to: "sel" }, { id: "e2", from: "sel", to: "tgt" }],
    );
    expect(graphSql(s, m).sql).toContain('SELECT "email" AS "mail" FROM "src"');
  });

  it("join composes left/right CTEs with ON", () => {
    const { spec: s, model: m } = spec(
      [
        { id: "a", kind: "source", sourceObject: "Customer" },
        { id: "b", kind: "source", sourceObject: "Order" },
        { id: "j", kind: "join", joinKind: "left", on: [{ leftColumn: "id", rightColumn: "id" }] },
        { id: "t", kind: "target" },
      ],
      [
        { id: "e1", from: "a", to: "j", toPort: "left" },
        { id: "e2", from: "b", to: "j", toPort: "right" },
        { id: "e3", from: "j", to: "t" },
      ],
    );
    expect(graphSql(s, m).sql).toContain('FROM "a" LEFT JOIN "b" ON "a"."id" = "b"."id"');
  });

  it("uses the source dialect for quoting (MySQL backticks)", () => {
    const { spec: s, model: m } = spec(
      [{ id: "src", kind: "source", sourceObject: "Customer" }, { id: "tgt", kind: "target" }],
      [{ id: "e1", from: "src", to: "tgt" }],
      "mysql",
    );
    expect(graphSql(s, m).sql).toContain("`src` AS (\n  SELECT * FROM `Customer`\n)");
  });

  it("aggregate → SELECT group cols + measures with GROUP BY", () => {
    const { spec: s, model: m } = spec(
      [
        { id: "src", kind: "source", sourceObject: "Order" },
        { id: "agg", kind: "aggregate", groupBy: ["id"], aggregates: [{ fn: "sum", column: "total", as: "total_sum" }, { fn: "count", as: "n" }] },
        { id: "tgt", kind: "target" },
      ],
      [{ id: "e1", from: "src", to: "agg" }, { id: "e2", from: "agg", to: "tgt" }],
    );
    const { sql } = graphSql(s, m);
    expect(sql).toContain('SELECT "id", SUM("total") AS "total_sum", COUNT(*) AS "n" FROM "src"\nGROUP BY "id"');
  });

  it("reports a node with no input as unsupported (no SQL for that target)", () => {
    const { spec: s, model: m } = spec(
      [{ id: "flt", kind: "filter" }], // filter with no upstream
      [],
    );
    const { unsupported } = graphSql(s, m);
    expect(unsupported.some((u) => u.includes("missing input"))).toBe(true);
  });
});
