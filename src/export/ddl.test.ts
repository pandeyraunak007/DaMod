import { describe, it, expect } from "vitest";
import { newModel, newEntity, newField, type Model } from "../model/model";
import { createRelationship } from "../model/operations";
import { exportModelDDL, exportWorkspaceDDL } from "./ddl";
import { DIALECTS } from "./dialects";

function ordersModel(): Model {
  let m = newModel("orders", "t", "Physical");
  const customer = newEntity("Customer", { x: 0, y: 0 });
  customer.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  const order = newEntity("Order", { x: 0, y: 0 });
  order.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  order.fields.push(newField("placed_at", "timestamp", { nullable: false }));
  order.fields.push(
    newField("total", "decimal", { precision: 12, scale: 2, nullable: false, description: "incl tax" }),
  );
  order.description = "One customer purchase";
  const product = newEntity("Product", { x: 0, y: 0 });
  product.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  m.entities.push(customer, order, product);
  m = createRelationship(m, {
    cardinality: "one-to-many",
    parentEntity: customer.id,
    childEntity: order.id,
    foreignKeyFieldName: "customer_id",
  }).model;
  m = createRelationship(m, {
    cardinality: "many-to-many",
    parentEntity: order.id,
    childEntity: product.id,
  }).model;
  return m;
}

describe("Postgres DDL (AT-4.6)", () => {
  const sql = exportModelDDL(ordersModel(), DIALECTS.postgres);

  it("quotes identifiers so reserved words like Order are safe", () => {
    expect(sql).toContain('CREATE TABLE "Order"');
    expect(sql).toContain('CREATE TABLE "Customer"');
    expect(sql).toContain('CREATE TABLE "OrderProduct"');
  });

  it("uses the spec type mapping", () => {
    expect(sql).toContain("timestamp with time zone");
    expect(sql).toContain("numeric(12,2)");
    expect(sql).toContain("uuid");
  });

  it("emits primary and foreign keys", () => {
    expect(sql).toContain('PRIMARY KEY ("id")');
    expect(sql).toMatch(/FOREIGN KEY \("customer_id"\) REFERENCES "Customer" \("id"\)/);
    expect(sql).toContain('PRIMARY KEY ("order_id", "product_id")');
  });

  it("orders referenced tables before referencing ones (FR-8.3)", () => {
    expect(sql.indexOf('CREATE TABLE "Customer"')).toBeLessThan(sql.indexOf('CREATE TABLE "Order"'));
    expect(sql.indexOf('CREATE TABLE "Order"')).toBeLessThan(sql.indexOf('CREATE TABLE "OrderProduct"'));
  });

  it("emits comments (FR-8.4)", () => {
    expect(sql).toContain('COMMENT ON TABLE "Order" IS \'One customer purchase\'');
    expect(sql).toContain('COMMENT ON COLUMN "Order"."total" IS \'incl tax\'');
  });

  it("is byte-identical across runs (FR-8.6)", () => {
    expect(exportModelDDL(ordersModel(), DIALECTS.postgres)).toBe(sql);
  });
});

describe("Snowflake + Databricks type mapping", () => {
  it("maps Snowflake types", () => {
    const sql = exportModelDDL(ordersModel(), DIALECTS.snowflake);
    expect(sql).toContain("TIMESTAMP_TZ");
    expect(sql).toContain("NUMBER(12,2)");
    expect(sql).toContain("VARCHAR(36)"); // uuid
  });

  it("maps Databricks types and uses backticks", () => {
    const sql = exportModelDDL(ordersModel(), DIALECTS.databricks);
    expect(sql).toContain("`Order`");
    expect(sql).toContain("TIMESTAMP");
    expect(sql).toContain("DECIMAL(12,2)");
    expect(sql).toContain("STRING"); // uuid -> STRING
    // Databricks uses inline column comments
    expect(sql).toContain("COMMENT 'incl tax'");
  });
});

describe("Workspace DDL (AT-4.7)", () => {
  it("emits a schema per model", () => {
    const m = ordersModel();
    const sql = exportWorkspaceDDL([{ id: m.id, name: m.name, model: m }], [], DIALECTS.postgres);
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "orders"');
    expect(sql).toContain('CREATE TABLE "orders"."Order"');
  });
});

describe("other database objects (views, indexes, sequences, raw)", () => {
  function withObjects() {
    const m = ordersModel();
    const order = m.entities.find((e) => e.name === "Order")!;
    m.sequences = [{ id: "q_1", name: "order_seq", start: 1, increment: 1 }];
    m.indexes = [
      { id: "x_1", name: "idx_order_total", entity: order.id, fields: [order.fields[2].id], unique: false },
    ];
    m.views = [
      { id: "v_1", name: "paid_orders", definition: "SELECT * FROM \"Order\"", position: { x: 0, y: 0 } },
    ];
    m.rawObjects = [
      { id: "o_1", name: "load_stage", dialect: "snowflake", kind: "stage", sql: "CREATE STAGE load_stage;" },
    ];
    return m;
  }

  it("Postgres emits sequence, index and view; snowflake-only raw omitted", () => {
    const sql = exportModelDDL(withObjects(), DIALECTS.postgres);
    expect(sql).toContain('CREATE SEQUENCE "order_seq" START WITH 1 INCREMENT BY 1;');
    expect(sql).toContain('CREATE INDEX "idx_order_total" ON "Order"');
    expect(sql).toContain('CREATE OR REPLACE VIEW "paid_orders" AS');
    expect(sql).not.toContain("CREATE STAGE"); // raw object is snowflake-only
  });

  it("Snowflake maps index to clustering and includes its raw object", () => {
    const sql = exportModelDDL(withObjects(), DIALECTS.snowflake);
    expect(sql).toContain("CLUSTER BY");
    expect(sql).toContain("CREATE STAGE load_stage;");
  });

  it("Databricks notes sequences/indexes instead of creating them", () => {
    const sql = exportModelDDL(withObjects(), DIALECTS.databricks);
    expect(sql).toContain("no CREATE SEQUENCE");
    expect(sql).toContain("ZORDER BY");
  });
});

describe("referential integrity in DDL (ERwin RI)", () => {
  it("emits ON DELETE / ON UPDATE for Postgres", () => {
    const m = ordersModel();
    const rel = m.relationships.find((r) => r.cardinality === "one-to-many")!;
    rel.onDelete = "cascade";
    rel.onUpdate = "restrict";
    const sql = exportModelDDL(m, DIALECTS.postgres);
    expect(sql).toContain("ON DELETE CASCADE ON UPDATE RESTRICT");
  });
});
