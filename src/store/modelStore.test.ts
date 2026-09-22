import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";

function reset() {
  useModelStore.getState().loadModel(newModel("orders", "2026-01-01T00:00:00Z"));
}

const s = () => useModelStore.getState();

describe("modelStore entities", () => {
  beforeEach(reset);

  it("creates and selects an entity with a valid default name", () => {
    const id = s().createEntity();
    const model = s().model;
    expect(model.entities).toHaveLength(1);
    expect(model.entities[0].name).toBe("NewEntity");
    expect(s().selection).toEqual({ kind: "entity", id });
  });

  it("rejects an invalid rename and keeps the old name (AT-1.2)", () => {
    const id = s().createEntity();
    expect(s().renameEntity(id, "Order ")).not.toBeNull();
    expect(s().renameEntity(id, "1order")).not.toBeNull();
    expect(s().model.entities[0].name).toBe("NewEntity");
    expect(s().renameEntity(id, "Order")).toBeNull();
    expect(s().model.entities[0].name).toBe("Order");
  });

  it("gives new entities unique default names", () => {
    s().createEntity();
    s().createEntity();
    const names = s().model.entities.map((e) => e.name);
    expect(new Set(names).size).toBe(2);
  });
});

describe("modelStore fields", () => {
  beforeEach(reset);

  it("adds a field to an entity", () => {
    const id = s().createEntity();
    const fieldId = s().addField(id);
    expect(fieldId).not.toBeNull();
    expect(s().model.entities[0].fields).toHaveLength(1);
  });

  it("notices a PK type change that reshapes dependent FKs (AT-1.7)", () => {
    const customer = s().createEntity();
    const pk = s().addField(customer)!;
    s().updateField(customer, pk, { type: "uuid", primaryKey: true, nullable: false });
    const order = s().createEntity();
    s().createRelationship({
      cardinality: "one-to-many",
      parentEntity: customer,
      childEntity: order,
      foreignKeyFieldName: "customer_id",
    });
    const before = s().notices.length;
    s().updateField(customer, pk, { type: "bigint" });
    const fk = s().model.entities
      .find((e) => e.id === order)!
      .fields.find((f) => f.name === "customer_id")!;
    expect(fk.type).toBe("bigint");
    expect(s().notices.length).toBe(before + 1);
  });
});

describe("modelStore undo/redo (AT-1.6)", () => {
  beforeEach(reset);

  it("undoes and redoes entity creation", () => {
    s().createEntity();
    expect(s().model.entities).toHaveLength(1);
    s().undo();
    expect(s().model.entities).toHaveLength(0);
    s().redo();
    expect(s().model.entities).toHaveLength(1);
  });

  it("undoes a delete-with-cascade", () => {
    const order = s().createEntity();
    s().addField(order);
    const product = s().createEntity();
    s().createRelationship({
      cardinality: "many-to-many",
      parentEntity: order,
      childEntity: product,
    });
    const countWithJunction = s().model.entities.length; // Order, Product, junction
    expect(countWithJunction).toBe(3);
    s().deleteEntity(product);
    expect(s().model.entities.length).toBe(1); // only Order remains
    s().undo();
    expect(s().model.entities.length).toBe(3);
    s().redo();
    expect(s().model.entities.length).toBe(1);
  });

  it("keeps at least 50 undo steps", () => {
    for (let i = 0; i < 60; i++) s().createEntity();
    for (let i = 0; i < 55; i++) s().undo();
    // 60 creates, 55 undos -> 5 entities left, proving depth >= 50.
    expect(s().model.entities.length).toBe(5);
  });
});
