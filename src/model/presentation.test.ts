import { describe, it, expect } from "vitest";
import { displayName, displayNameParts } from "./presentation";
import { newModel, newEntity, newField } from "./model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { exportModelDDL } from "../export/ddl";
import { DIALECTS } from "../export/dialects";

const customer = { name: "dim_customer", logicalName: "Customer" };
const plain = { name: "Orders" }; // no logical name

describe("displayName — logical vs physical per level", () => {
  it("uses the business name at Conceptual/Logical", () => {
    expect(displayName(customer, "Conceptual")).toBe("Customer");
    expect(displayName(customer, "Logical")).toBe("Customer");
  });

  it("uses the physical name at Physical", () => {
    expect(displayName(customer, "Physical")).toBe("dim_customer");
  });

  it("shows physical primary with the logical name as secondary at Physical/Logical", () => {
    expect(displayNameParts(customer, "Physical/Logical")).toEqual({ primary: "dim_customer", secondary: "Customer" });
  });

  it("falls back to the physical name when there is no logical name", () => {
    expect(displayName(plain, "Logical")).toBe("Orders");
    expect(displayNameParts(plain, "Physical/Logical").secondary).toBeUndefined();
  });

  it("does not show a redundant secondary when both names are equal", () => {
    expect(displayNameParts({ name: "x", logicalName: "x" }, "Physical/Logical").secondary).toBeUndefined();
  });
});

describe("dual names: persistence and export", () => {
  it("round-trips entity and field logicalName deterministically", () => {
    const m = newModel("orders", "2026-01-01T00:00:00Z", "Physical");
    const e = newEntity("dim_customer", { x: 0, y: 0 }, { logicalName: "Customer" });
    e.fields = [newField("customer_key", "bigint", { logicalName: "Customer ID", primaryKey: true, nullable: false })];
    m.entities = [e];

    const text = serializeModel(m);
    const parsed = parseModelFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entities[0].logicalName).toBe("Customer");
    expect(parsed.value.entities[0].fields[0].logicalName).toBe("Customer ID");
    expect(serializeModel(parsed.value)).toBe(text); // deterministic
  });

  it("DDL export uses the PHYSICAL name, never the logical name", () => {
    const m = newModel("orders", "2026-01-01T00:00:00Z", "Physical");
    const e = newEntity("dim_customer", { x: 0, y: 0 }, { logicalName: "Customer" });
    e.fields = [newField("customer_key", "bigint", { logicalName: "Customer ID", primaryKey: true, nullable: false })];
    m.entities = [e];
    const ddl = exportModelDDL(m, DIALECTS.postgres);
    expect(ddl).toContain('CREATE TABLE "dim_customer"');
    expect(ddl).toContain('"customer_key"');
    expect(ddl).not.toContain("Customer ID");
    expect(ddl).not.toMatch(/CREATE TABLE "Customer"/);
  });
});
