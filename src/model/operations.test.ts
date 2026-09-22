import { describe, it, expect } from "vitest";
import {
  type Model,
  newModel,
  newEntity,
  newField,
  findEntity,
  findField,
} from "./model";
import {
  createRelationship,
  deleteEntity,
  reconcileForeignKeyTypes,
  suggestForeignKeyName,
  suggestJunctionName,
} from "./operations";

function sampleModel(): Model {
  const model = newModel("orders", "2026-01-01T00:00:00Z");
  const customer = newEntity("Customer", { x: 0, y: 0 });
  customer.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  const order = newEntity("Order", { x: 300, y: 0 });
  order.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  order.fields.push(newField("placed_at", "timestamp", { nullable: false }));
  const product = newEntity("Product", { x: 600, y: 0 });
  product.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  model.entities.push(customer, order, product);
  return model;
}

const ids = (m: Model) => ({
  customer: m.entities.find((e) => e.name === "Customer")!.id,
  order: m.entities.find((e) => e.name === "Order")!.id,
  product: m.entities.find((e) => e.name === "Product")!.id,
});

describe("suggest helpers", () => {
  it("names foreign keys and junctions", () => {
    const pk = newField("id", "uuid", { primaryKey: true });
    expect(suggestForeignKeyName("Customer", pk)).toBe("customer_id");
    expect(suggestJunctionName("Order", "Product")).toBe("OrderProduct");
  });
});

describe("createRelationship one-to-many (AT-1.3)", () => {
  it("creates the FK field on the child with the parent PK type", () => {
    const base = sampleModel();
    const { customer, order } = ids(base);
    const { model, createdFieldIds } = createRelationship(base, {
      cardinality: "one-to-many",
      parentEntity: customer,
      childEntity: order,
      foreignKeyFieldName: "customer_id",
    });
    const orderEntity = findEntity(model, order)!;
    const fk = orderEntity.fields.find((f) => f.name === "customer_id")!;
    expect(fk).toBeDefined();
    expect(fk.type).toBe("uuid");
    expect(fk.primaryKey).toBe(false);
    expect(createdFieldIds).toContain(fk.id);
    // does not mutate the input model
    expect(findEntity(base, order)!.fields.some((f) => f.name === "customer_id")).toBe(false);
  });

  it("marks a one-to-one FK unique", () => {
    const base = sampleModel();
    const { customer, order } = ids(base);
    const { model } = createRelationship(base, {
      cardinality: "one-to-one",
      parentEntity: customer,
      childEntity: order,
    });
    const fk = findEntity(model, order)!.fields.find((f) => f.name === "customer_id")!;
    expect(fk.unique).toBe(true);
  });
});

describe("createRelationship many-to-many (AT-1.4)", () => {
  it("materialises a junction entity with both keys", () => {
    const base = sampleModel();
    const { order, product } = ids(base);
    const { model, junctionEntityId } = createRelationship(base, {
      cardinality: "many-to-many",
      parentEntity: order,
      childEntity: product,
    });
    const junction = findEntity(model, junctionEntityId!)!;
    expect(junction.name).toBe("OrderProduct");
    expect(junction.junction).toBe(true);
    const names = junction.fields.map((f) => f.name).sort();
    expect(names).toEqual(["order_id", "product_id"]);
    expect(junction.fields.every((f) => f.primaryKey && !f.nullable)).toBe(true);
  });
});

describe("reconcileForeignKeyTypes (FR-3.7 / AT-1.7)", () => {
  it("propagates a PK type change to dependent foreign keys", () => {
    const base = sampleModel();
    const { customer, order } = ids(base);
    const { model } = createRelationship(base, {
      cardinality: "one-to-many",
      parentEntity: customer,
      childEntity: order,
      foreignKeyFieldName: "customer_id",
    });
    // Change Customer.id to bigint.
    const custId = findField(findEntity(model, customer)!, findEntity(model, customer)!.fields[0].id)!;
    custId.type = "bigint";
    const changes = reconcileForeignKeyTypes(model);
    const fk = findEntity(model, order)!.fields.find((f) => f.name === "customer_id")!;
    expect(fk.type).toBe("bigint");
    expect(changes).toHaveLength(1);
    expect(changes[0].to).toBe("bigint");
  });

  it("propagates to a junction's keys", () => {
    const base = sampleModel();
    const { order, product } = ids(base);
    const { model, junctionEntityId } = createRelationship(base, {
      cardinality: "many-to-many",
      parentEntity: order,
      childEntity: product,
    });
    findEntity(model, order)!.fields.find((f) => f.name === "id")!.type = "bigint";
    reconcileForeignKeyTypes(model);
    const junction = findEntity(model, junctionEntityId!)!;
    expect(junction.fields.find((f) => f.name === "order_id")!.type).toBe("bigint");
    expect(junction.fields.find((f) => f.name === "product_id")!.type).toBe("uuid");
  });
});

describe("deleteEntity cascade (FR-2.7 / AT-1.6)", () => {
  it("removes touching relationships and junction entities", () => {
    const base = sampleModel();
    const { order, product } = ids(base);
    const created = createRelationship(base, {
      cardinality: "many-to-many",
      parentEntity: order,
      childEntity: product,
    });
    const { model, removedEntityIds, removedRelationshipIds } = deleteEntity(
      created.model,
      product,
    );
    expect(model.entities.find((e) => e.id === product)).toBeUndefined();
    expect(model.entities.find((e) => e.id === created.junctionEntityId)).toBeUndefined();
    expect(removedEntityIds).toContain(created.junctionEntityId);
    expect(removedRelationshipIds).toContain(created.relationshipId);
    // Order survives.
    expect(model.entities.find((e) => e.id === order)).toBeDefined();
  });
});
