import { describe, it, expect } from "vitest";
import { newModel, newEntity, newField } from "../model/model";
import type { SemanticDoc } from "../semantic/semantic";
import { deriveKey } from "../semantic/semantic";
import { Resolver, metricSql, exportSemanticYaml } from "./semanticExport";

function fixture() {
  const orders = newModel("orders", "t", "Physical");
  const orderLine = newEntity("OrderLine", { x: 0, y: 0 });
  const amount = newField("amount", "decimal", { precision: 12, scale: 2 });
  orderLine.fields.push(newField("id", "uuid", { primaryKey: true }), amount);
  const order = newEntity("Order", { x: 0, y: 0 });
  const status = newField("status", "text");
  order.fields.push(newField("id", "uuid", { primaryKey: true }), status);
  orders.entities.push(orderLine, order);

  const models = [{ id: orders.id, name: orders.name, model: orders }];
  const semantic: SemanticDoc = {
    formatVersion: 1,
    terms: [],
    dimensions: [
      {
        id: "d_1",
        name: "Order date",
        time: true,
        field: { model: orders.id, entity: order.id, field: order.fields[0].id },
      },
    ],
    metrics: [
      {
        id: "k_rev",
        name: "Revenue",
        key: deriveKey("Revenue"),
        aggregate: "sum",
        field: { model: orders.id, entity: orderLine.id, field: amount.id },
        grain: { model: orders.id, entity: orderLine.id },
        filters: [{ field: { model: orders.id, entity: order.id, field: status.id }, op: "=", value: "paid" }],
      },
      { id: "k_aov", name: "AOV", key: "aov", derived: { left: "k_rev", op: "/", right: "k_lc" } },
    ],
  };
  return { models, semantic, orders };
}

describe("metricSql (FR-9.2, AT-4.3)", () => {
  it("builds a SELECT snippet with the filter", () => {
    const { models, semantic } = fixture();
    const r = new Resolver(models, []);
    const sql = metricSql(semantic.metrics[0], r, semantic);
    expect(sql).toBe("SELECT sum(amount) FROM OrderLine WHERE status = 'paid'");
  });

  it("renders derived metrics from their parent keys", () => {
    const { models, semantic } = fixture();
    const r = new Resolver(models, []);
    expect(metricSql(semantic.metrics[1], r, semantic)).toBe("revenue / ?");
  });
});

describe("exportSemanticYaml (FR-9.1/9.3, AT-4.9)", () => {
  it("writes readable paths, no IDs, with SQL snippets", () => {
    const { models, semantic } = fixture();
    const yaml = exportSemanticYaml(semantic, models, []);
    expect(yaml).toContain("orders.OrderLine.amount");
    expect(yaml).toContain("sql:");
    expect(yaml).not.toContain("k_rev"); // no IDs
    expect(yaml).not.toContain("m_"); // no model IDs
  });

  it("is deterministic", () => {
    const { models, semantic } = fixture();
    expect(exportSemanticYaml(semantic, models, [])).toBe(exportSemanticYaml(semantic, models, []));
  });
});
