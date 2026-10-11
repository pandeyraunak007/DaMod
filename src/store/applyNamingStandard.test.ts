// Phase 2 Slice B — applyNamingStandard: atomic rename, FK mirroring, stable IDs,
// referential integrity preserved, collisions/invalid skipped.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel, newEntity, newField } from "../model/model";
import { createRelationship } from "../model/operations";

const s = () => useModelStore.getState();

function seedRelated() {
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
  s().loadModel(m);
}

beforeEach(seedRelated);

describe("applyNamingStandard", () => {
  it("renames entities + attributes as ONE undo step, preserving IDs and relationships", () => {
    const relIdsBefore = s().model.relationships.map((r) => r.id);
    const custIdBefore = s().model.entities.find((e) => e.name === "Customer")!.id;

    const std = s().createNamingStandard();
    s().updateNamingStandard(std, {
      rules: [
        { target: "entity", case: "snake_case" },
        { target: "attribute", case: "snake_case" },
      ],
    });
    const res = s().applyNamingStandard(std);
    expect(res.collisions).toBe(0);
    expect(res.applied).toBeGreaterThan(0);

    const m = s().model;
    expect(m.entities.map((e) => e.name).sort()).toEqual(["customer", "order"]);
    // IDs unchanged, relationships intact (reference by id).
    expect(m.entities.find((e) => e.name === "customer")!.id).toBe(custIdBefore);
    expect(m.relationships.map((r) => r.id)).toEqual(relIdsBefore);

    // ONE undo reverts the whole apply.
    s().undo();
    expect(s().model.entities.map((e) => e.name).sort()).toEqual(["Customer", "Order"]);
  });

  it("mirrors the FK column onto the renamed PK name (toggle default on)", () => {
    // Rename the FK column so mirroring is observable (differs from its rule result).
    const order0 = s().model.entities.find((e) => e.name === "Order")!;
    const fk0 = order0.fields.find((f) => !f.primaryKey)!;
    s().updateField(order0.id, fk0.id, { name: "customer_ref" });

    const std = s().createNamingStandard();
    s().updateNamingStandard(std, { rules: [{ target: "attribute", case: "screaming_snake" }] });
    s().applyNamingStandard(std);

    const order = s().model.entities.find((e) => e.name === "Order")!;
    // Parent PK CustID -> CUST_ID; the FK mirrors it rather than becoming CUSTOMER_REF.
    expect(order.fields.some((f) => f.name === "CUST_ID")).toBe(true);
    expect(order.fields.some((f) => f.name === "CUSTOMER_REF")).toBe(false);
  });

  it("skips colliding renames (no duplicate names created)", () => {
    // Add a second column that would collide with the first under snake_case.
    const t = s().createEntity();
    s().renameEntity(t, "T");
    const f1 = s().addField(t)!;
    s().updateField(t, f1, { name: "firstName" });
    const f2 = s().addField(t)!;
    s().updateField(t, f2, { name: "first_name" });

    const std = s().createNamingStandard();
    s().updateNamingStandard(std, { rules: [{ target: "attribute", case: "snake_case" }] });
    const res = s().applyNamingStandard(std);

    const tEntity = s().model.entities.find((e) => e.name === "T")!;
    const names = tEntity.fields.map((f) => f.name);
    // firstName was NOT renamed to first_name (would collide); both kept.
    expect(names).toContain("firstName");
    expect(names).toContain("first_name");
    expect(res.skipped).toBeGreaterThan(0);
    expect(res.collisions).toBeGreaterThan(0);
  });
});
