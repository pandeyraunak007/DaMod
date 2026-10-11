// Phase 2 Slice B — naming preview (pure): changes, collisions, FK mirroring.
import { describe, it, expect } from "vitest";
import { previewNaming, newNamingStandard } from "./naming";
import { newModel, newEntity, newField, type Model } from "./model";
import { createRelationship } from "./operations";

// Customer(CustID pk) 1—N Order(OrderID pk, CustID fk)
function related(): { model: Model; custId: string; orderId: string } {
  let m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const cust = newEntity("Customer", { x: 0, y: 0 });
  cust.fields.push(newField("CustID", "integer", { primaryKey: true, nullable: false }));
  const order = newEntity("Order", { x: 0, y: 0 });
  order.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
  m.entities.push(cust, order);
  m = createRelationship(m, {
    cardinality: "one-to-many",
    parentEntity: cust.id,
    childEntity: order.id,
    foreignKeyFieldName: "CustID",
  }).model;
  return { model: m, custId: cust.id, orderId: m.entities.find((e) => e.name === "Order")!.id };
}

describe("previewNaming", () => {
  it("proposes snake_case renames and no collisions on a clean model", () => {
    const { model } = related();
    const std = newNamingStandard("snake");
    std.rules = [
      { target: "entity", case: "snake_case" },
      { target: "attribute", case: "snake_case" },
    ];
    const p = previewNaming(model, std);
    expect(p.collisions).toHaveLength(0);
    const names = p.changes.map((c) => `${c.from}->${c.to}`).sort();
    expect(names).toContain("Customer->customer");
    expect(names).toContain("OrderID->order_id");
    expect(names).toContain("CustID->cust_id");
  });

  it("mirrors a renamed PK onto its (distinctly named) FK column when the toggle is on", () => {
    const { model } = related();
    // Give the FK column a different name so mirroring has a visible effect.
    const order = model.entities.find((e) => e.name === "Order")!;
    order.fields.find((f) => !f.primaryKey)!.name = "customer_ref";

    const std = newNamingStandard("mirror");
    std.rules = [{ target: "attribute", case: "screaming_snake" }];
    const p = previewNaming(model, std);
    const fk = p.changes.find((c) => c.from === "customer_ref")!;
    // FK column mirrors the parent PK's final name (CUST_ID), not its own rule result.
    expect(fk.to).toBe("CUST_ID");
    expect(fk.mirrored).toBe(true);
  });

  it("does not mirror when the toggle is off", () => {
    const { model } = related();
    const order = model.entities.find((e) => e.name === "Order")!;
    order.fields.find((f) => !f.primaryKey)!.name = "customer_ref";

    const std = newNamingStandard("no-mirror");
    std.mirrorForeignKeys = false;
    std.rules = [{ target: "attribute", case: "screaming_snake" }];
    const p = previewNaming(model, std);
    const fk = p.changes.find((c) => c.from === "customer_ref")!;
    expect(fk.to).toBe("CUSTOMER_REF"); // rule-only, independent of the PK
    expect(fk.mirrored).toBeUndefined();
  });

  it("flags a collision when two columns would map to the same name", () => {
    let m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
    const e = newEntity("T", { x: 0, y: 0 });
    e.fields.push(newField("firstName", "string"));
    e.fields.push(newField("first_name", "string"));
    m.entities.push(e);
    const std = newNamingStandard("snake");
    std.rules = [{ target: "attribute", case: "snake_case" }];
    const p = previewNaming(m, std);
    expect(p.collisions.some((c) => c.name === "first_name")).toBe(true);
    expect(p.collidingIds.length).toBe(2); // both columns marked unsafe
  });
});
