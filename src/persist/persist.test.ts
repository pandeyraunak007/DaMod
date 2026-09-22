import { describe, it, expect } from "vitest";
import { newModel, newEntity, newField } from "../model/model";
import { createRelationship } from "../model/operations";
import { serializeModel } from "./serialize";
import { parseModelFile, CURRENT_FORMAT_VERSION } from "./schema";
import { modelFileName, isModelFile, modelNameFromFile } from "./filenames";

function sampleModel() {
  let model = newModel("orders", "2026-01-01T00:00:00Z");
  const customer = newEntity("Customer", { x: 0, y: 0 });
  customer.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  const order = newEntity("Order", { x: 300, y: 0 });
  order.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  order.fields.push(
    newField("total", "decimal", { precision: 12, scale: 2, nullable: false, description: "incl tax" }),
  );
  const product = newEntity("Product", { x: 600, y: 0 });
  product.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  model.entities.push(customer, order, product);
  // 1:M Customer -> Order and M:N Order <-> Product (creates a junction).
  model = createRelationship(model, {
    cardinality: "one-to-many",
    parentEntity: customer.id,
    childEntity: order.id,
    foreignKeyFieldName: "customer_id",
  }).model;
  model = createRelationship(model, {
    cardinality: "many-to-many",
    parentEntity: order.id,
    childEntity: product.id,
  }).model;
  return model;
}

describe("serializeModel", () => {
  it("is deterministic (same model -> identical bytes)", () => {
    const model = sampleModel();
    expect(serializeModel(model)).toBe(serializeModel(model));
  });

  it("round-trips through parse without drift (FR-5.5/5.6)", () => {
    const model = sampleModel();
    const once = serializeModel(model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const twice = serializeModel(parsed.value);
    expect(twice).toBe(once);
  });

  it("omits empty optionals and the derived junction flag", () => {
    const model = sampleModel();
    const text = serializeModel(model);
    expect(text).not.toContain('"junction"');
    // No null *values* (optional keys are omitted, not written as null).
    expect(text).not.toMatch(/:\s*null\b/);
    // A non-PK field omits primaryKey rather than writing false.
    const obj = JSON.parse(text);
    const orderFk = obj.entities
      .find((e: { name: string }) => e.name === "Order")
      .fields.find((f: { name: string }) => f.name === "customer_id");
    expect("primaryKey" in orderFk).toBe(false);
    expect(orderFk.nullable).toBe(false);
  });

  it("ends with a trailing newline", () => {
    expect(serializeModel(sampleModel()).endsWith("}\n")).toBe(true);
  });

  it("re-derives the junction flag on parse", () => {
    const parsed = parseModelFile(serializeModel(sampleModel()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const junction = parsed.value.entities.find((e) => e.name === "OrderProduct");
    expect(junction?.junction).toBe(true);
  });
});

describe("parseModelFile validation (FR-5.6/5.7)", () => {
  it("reports invalid JSON with a message (AT-2.5)", () => {
    const broken = serializeModel(sampleModel()).replace("{", "");
    const r = parseModelFile(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("json");
  });

  it("refuses a newer format version", () => {
    const obj = JSON.parse(serializeModel(sampleModel()));
    obj.formatVersion = CURRENT_FORMAT_VERSION + 1;
    const r = parseModelFile(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("newer");
  });

  it("reports a schema error with a path", () => {
    const obj = JSON.parse(serializeModel(sampleModel()));
    delete obj.entities[0].position;
    const r = parseModelFile(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("position");
  });

  it("accepts a hand-edited scale change (AT-2.4)", () => {
    const obj = JSON.parse(serializeModel(sampleModel()));
    const order = obj.entities.find((e: { name: string }) => e.name === "Order");
    const total = order.fields.find((f: { name: string }) => f.name === "total");
    total.scale = 3;
    const r = parseModelFile(JSON.stringify(obj));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = r.value.entities
        .find((e) => e.name === "Order")!
        .fields.find((f) => f.name === "total")!;
      expect(t.scale).toBe(3);
    }
  });
});

describe("filenames (FR-1.4)", () => {
  it("derives and reverses model file names", () => {
    expect(modelFileName("orders")).toBe("orders.model.json");
    expect(isModelFile("orders.model.json")).toBe(true);
    expect(isModelFile("workspace.json")).toBe(false);
    expect(modelNameFromFile("orders.model.json")).toBe("orders");
  });
});
