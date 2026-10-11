// Phase 1 (ETL) — source-extraction SQL generation. Pure, deterministic, design-time
// text (never executed): SELECT/transform/JOIN/WHERE per target object, in the SOURCE
// model's dialect. Covers the MVP transform set (rename/cast/expression) + filters/joins.
import { describe, it, expect } from "vitest";
import { planFullLoad, pipelineSql } from "./planner";
import { newModel, newEntity, newField, type Model } from "../../model/model";
import type { DbDialect } from "../../model/model";

const NOW = "2026-01-01T00:00:00Z";

function sourceModel(dialect?: DbDialect): Model {
  const m = newModel("sales", NOW, "Physical", dialect);
  const customer = newEntity("Customer", { x: 0, y: 0 });
  customer.fields = [
    newField("id", "uuid", { primaryKey: true, nullable: false }),
    newField("email", "string", { length: 320, nullable: false }),
  ];
  const order = newEntity("Order", { x: 0, y: 0 });
  order.fields = [
    newField("id", "uuid", { primaryKey: true, nullable: false }),
    newField("total", "decimal", { precision: 12, scale: 2 }),
  ];
  m.entities = [customer, order];
  return m;
}

describe("pipelineSql", () => {
  it("generates a SELECT … AS … FROM for a full-load object (Postgres quoting by default)", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Customer"], "snowflake", { name: "load_customers" });
    const { sql, unsupported } = pipelineSql(spec, m);
    expect(sql).toContain('SELECT');
    expect(sql).toContain('"Customer"."email" AS "email"');
    expect(sql).toContain('FROM "Customer"');
    expect(sql.trim().endsWith(";")).toBe(true);
    expect(unsupported).toHaveLength(0);
  });

  it("renders a transform expression verbatim as `<transform> AS target` (rename/cast/expr)", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Customer"], "postgres", { name: "p" });
    const emailCol = spec.objects[0].columns.find((c) => c.target === "email")!;
    emailCol.transform = 'LOWER("Customer"."email")';
    emailCol.target = "email_lc";
    const { sql } = pipelineSql(spec, m);
    expect(sql).toContain('LOWER("Customer"."email") AS "email_lc"');
  });

  it("emits WHERE with correct literals (string quoted, number bare, IS NULL, IN raw)", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Order"], "postgres", { name: "p" });
    spec.objects[0].filters = [
      { column: "total", op: ">", value: "100" },
      { column: "id", op: "is not null" },
      { column: "id", op: "in", value: "'a','b'" },
    ];
    const { sql } = pipelineSql(spec, m);
    expect(sql).toContain('WHERE "Order"."total" > 100');
    expect(sql).toContain('"Order"."id" IS NOT NULL');
    expect(sql).toContain(`"Order"."id" IN ('a','b')`);
  });

  it("escapes string filter values", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Customer"], "postgres", { name: "p" });
    spec.objects[0].filters = [{ column: "email", op: "=", value: "o'brien@x.com" }];
    const { sql } = pipelineSql(spec, m);
    expect(sql).toContain(`"Customer"."email" = 'o''brien@x.com'`);
  });

  it("attaches a JOIN when its left object is this object's source", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Customer"], "postgres", { name: "p" });
    spec.joins = [{ leftObject: "Customer", leftColumn: "id", rightObject: "Order", rightColumn: "id", kind: "left" }];
    const { sql } = pipelineSql(spec, m);
    expect(sql).toContain('LEFT JOIN "Order" ON "Customer"."id" = "Order"."id"');
  });

  it("emits NULL AS target for an unmapped column and reports it in `unsupported`", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Customer"], "postgres", { name: "p" });
    spec.objects[0].columns.push({ source: "", target: "loaded_at", targetType: { type: "timestamp" }, required: false });
    const { sql, unsupported } = pipelineSql(spec, m);
    expect(sql).toContain('NULL AS "loaded_at"');
    expect(unsupported.some((u) => u.includes("loaded_at"))).toBe(true);
  });

  it("quotes in the SOURCE model's dialect (MySQL backticks, not the target platform)", () => {
    const m = sourceModel("mysql");
    const spec = planFullLoad(m, ["Customer"], "postgres", { name: "p" }); // target = postgres
    const { sql } = pipelineSql(spec, m);
    expect(sql).toContain("`Customer`.`email` AS `email`");
    expect(sql).not.toContain('"Customer"');
  });

  it("is deterministic for the same spec", () => {
    const m = sourceModel();
    const spec = planFullLoad(m, ["Customer", "Order"], "postgres", { name: "p" });
    expect(pipelineSql(spec, m).sql).toBe(pipelineSql(spec, m).sql);
  });
});
