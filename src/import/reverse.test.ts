import { describe, it, expect } from "vitest";
import { parseDdl, mapSqlType } from "./reverse";
import { exportModelDDL } from "../export/ddl";
import { DIALECTS } from "../export/dialects";
import { newModel, newEntity, newField } from "../model/model";

const NOW = "2026-01-01T00:00:00Z";

describe("mapSqlType", () => {
  it("maps common Postgres types back to the fixed set", () => {
    expect(mapSqlType("varchar(120)").spec).toEqual({ type: "string", length: 120 });
    expect(mapSqlType("text").spec).toEqual({ type: "text" });
    expect(mapSqlType("numeric(12,2)").spec).toEqual({ type: "decimal", precision: 12, scale: 2 });
    expect(mapSqlType("bigint").spec).toEqual({ type: "bigint" });
    expect(mapSqlType("integer").spec).toEqual({ type: "integer" });
    expect(mapSqlType("boolean").spec).toEqual({ type: "boolean" });
    expect(mapSqlType("timestamp with time zone").spec).toEqual({ type: "timestamp" });
    expect(mapSqlType("uuid").spec).toEqual({ type: "uuid" });
    expect(mapSqlType("jsonb").spec).toEqual({ type: "json" });
  });

  it("maps dialect variants and warns on unknowns", () => {
    expect(mapSqlType("NUMBER(38,0)").spec).toEqual({ type: "decimal", precision: 38, scale: 0 });
    expect(mapSqlType("VARIANT").spec).toEqual({ type: "json" });
    expect(mapSqlType("STRING").spec).toEqual({ type: "text" });
    const geo = mapSqlType("geography");
    expect(geo.spec.type).toBe("text");
    expect(geo.warning).toBeTruthy();
  });
});

describe("parseDdl", () => {
  it("parses tables, columns, keys and a foreign key", () => {
    const sql = `
      CREATE TABLE "Customer" (
        "id" uuid NOT NULL,
        "email" varchar(320) NOT NULL UNIQUE,
        PRIMARY KEY ("id")
      );
      CREATE TABLE "Order" (
        "id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "total" numeric(12,2) DEFAULT 0,
        PRIMARY KEY ("id"),
        FOREIGN KEY ("customer_id") REFERENCES "Customer" ("id")
      );
    `;
    const { model, warnings } = parseDdl(sql, "shop", NOW);
    expect(warnings).toEqual([]);
    expect(model.level).toBe("Physical");
    expect(model.entities.map((e) => e.name).sort()).toEqual(["Customer", "Order"]);

    const customer = model.entities.find((e) => e.name === "Customer")!;
    const email = customer.fields.find((f) => f.name === "email")!;
    expect(email.type).toBe("string");
    expect(email.length).toBe(320);
    expect(email.nullable).toBe(false);
    expect(email.unique).toBe(true);
    expect(customer.fields.find((f) => f.name === "id")!.primaryKey).toBe(true);

    const order = model.entities.find((e) => e.name === "Order")!;
    expect(order.fields.find((f) => f.name === "total")!.default).toBe("0");

    expect(model.relationships).toHaveLength(1);
    const rel = model.relationships[0];
    expect(rel.cardinality).toBe("one-to-many");
    expect(rel.parentEntity).toBe(customer.id);
    expect(rel.childEntity).toBe(order.id);
    const fkField = order.fields.find((f) => f.id === rel.foreignKeyFields[0])!;
    expect(fkField.name).toBe("customer_id");
  });

  it("handles ALTER TABLE ADD FOREIGN KEY and inline REFERENCES", () => {
    const sql = `
      CREATE TABLE a (id integer PRIMARY KEY);
      CREATE TABLE b (id integer PRIMARY KEY, a_id integer REFERENCES a(id));
      CREATE TABLE c (id integer PRIMARY KEY, a_id integer);
      ALTER TABLE c ADD CONSTRAINT c_a_fk FOREIGN KEY (a_id) REFERENCES a (id);
    `;
    const { model } = parseDdl(sql, "g", NOW);
    expect(model.relationships).toHaveLength(2);
    const a = model.entities.find((e) => e.name === "a")!;
    expect(model.relationships.every((r) => r.parentEntity === a.id)).toBe(true);
  });

  it("detects a one-to-one when the FK is the child's whole primary key (subtype)", () => {
    const sql = `
      CREATE TABLE person (id uuid PRIMARY KEY);
      CREATE TABLE employee (id uuid PRIMARY KEY, FOREIGN KEY (id) REFERENCES person (id));
    `;
    const { model } = parseDdl(sql, "hr", NOW);
    expect(model.relationships[0].cardinality).toBe("one-to-one");
    expect(model.relationships[0].identifying).toBe(true);
  });

  it("warns about a foreign key to an unknown table", () => {
    const sql = `CREATE TABLE t (id integer, other_id integer REFERENCES missing(id));`;
    const { model, warnings } = parseDdl(sql, "x", NOW);
    expect(model.relationships).toHaveLength(0);
    expect(warnings.some((w) => /unknown table/.test(w))).toBe(true);
  });

  it("ignores comments and non-table statements", () => {
    const sql = `
      -- a comment with ; a semicolon and 'quote
      /* block ; comment */
      CREATE SCHEMA app;
      CREATE TABLE t (id integer PRIMARY KEY, name varchar(50) DEFAULT 'a;b');
      CREATE INDEX idx ON t (name);
    `;
    const { model } = parseDdl(sql, "c", NOW);
    expect(model.entities).toHaveLength(1);
    expect(model.entities[0].fields.find((f) => f.name === "name")!.default).toBe("'a;b'");
  });

  it("round-trips a model exported to Postgres DDL", () => {
    // Build a small model, export it, re-import it, and compare the structure.
    const model = newModel("orders", NOW, "Physical");
    const customer = newEntity("Customer", { x: 0, y: 0 });
    customer.fields = [
      newField("id", "uuid", { primaryKey: true, nullable: false }),
      newField("email", "string", { length: 200, nullable: false, unique: true }),
    ];
    const order = newEntity("Order", { x: 0, y: 0 });
    const custFk = newField("customer_id", "uuid", { nullable: false });
    order.fields = [
      newField("id", "uuid", { primaryKey: true, nullable: false }),
      custFk,
      newField("total", "decimal", { precision: 12, scale: 2 }),
    ];
    model.entities = [customer, order];
    model.relationships = [
      {
        id: "r_test0001",
        cardinality: "one-to-many",
        parentEntity: customer.id,
        childEntity: order.id,
        parentOptional: false,
        childOptional: true,
        foreignKeyFields: [custFk.id],
      },
    ];

    const sql = exportModelDDL(model, DIALECTS.postgres);
    const { model: back, warnings } = parseDdl(sql, "orders", NOW);
    expect(warnings).toEqual([]);
    expect(back.entities.map((e) => e.name).sort()).toEqual(["Customer", "Order"]);
    const o = back.entities.find((e) => e.name === "Order")!;
    expect(o.fields.map((f) => f.name).sort()).toEqual(["customer_id", "id", "total"]);
    expect(o.fields.find((f) => f.name === "total")!.scale).toBe(2);
    expect(back.relationships).toHaveLength(1);
    expect(back.relationships[0].parentEntity).toBe(
      back.entities.find((e) => e.name === "Customer")!.id,
    );
  });
});
