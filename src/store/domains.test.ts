import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";

function reset() {
  useModelStore.getState().loadModel(newModel("orders", "2026-01-01T00:00:00Z"));
}

const s = () => useModelStore.getState();

/** Add an entity with one field and return their ids. */
function entityWithField() {
  const entityId = s().createEntity();
  const fieldId = s().addField(entityId)!;
  return { entityId, fieldId };
}

describe("domains", () => {
  beforeEach(reset);

  it("creates a domain with a unique default name and selects it", () => {
    const id = s().createDomain();
    expect(s().model.domains).toHaveLength(1);
    expect(s().model.domains![0].name).toBe("NewDomain");
    expect(s().selection).toEqual({ kind: "domain", id });
    s().createDomain();
    const names = s().model.domains!.map((d) => d.name);
    expect(new Set(names).size).toBe(2);
  });

  it("binding a field to a domain copies the domain's type", () => {
    const { entityId, fieldId } = entityWithField();
    const domainId = s().createDomain();
    s().updateDomain(domainId, { type: "decimal", precision: 12, scale: 2 });
    s().bindFieldDomain(entityId, fieldId, domainId);
    const field = s().model.entities[0].fields[0];
    expect(field.domainId).toBe(domainId);
    expect(field.type).toBe("decimal");
    expect(field.precision).toBe(12);
    expect(field.scale).toBe(2);
  });

  it("editing a domain propagates its type to every bound field", () => {
    const { entityId, fieldId } = entityWithField();
    const domainId = s().createDomain();
    s().bindFieldDomain(entityId, fieldId, domainId);
    s().updateDomain(domainId, { type: "bigint" });
    expect(s().model.entities[0].fields[0].type).toBe("bigint");
    // Length params from a prior type are dropped when switching to a param-less type.
    expect(s().model.entities[0].fields[0].length).toBeUndefined();
  });

  it("deleting a domain unbinds its fields but keeps their resolved type", () => {
    const { entityId, fieldId } = entityWithField();
    const domainId = s().createDomain();
    s().updateDomain(domainId, { type: "uuid" });
    s().bindFieldDomain(entityId, fieldId, domainId);
    s().deleteDomain(domainId);
    const field = s().model.entities[0].fields[0];
    expect(field.domainId).toBeUndefined();
    expect(field.type).toBe("uuid");
    expect(s().model.domains ?? []).toHaveLength(0);
  });

  it("a manual type edit detaches the field from its domain", () => {
    const { entityId, fieldId } = entityWithField();
    const domainId = s().createDomain();
    s().bindFieldDomain(entityId, fieldId, domainId);
    s().updateField(entityId, fieldId, { type: "integer" });
    const field = s().model.entities[0].fields[0];
    expect(field.domainId).toBeUndefined();
    expect(field.type).toBe("integer");
  });

  it("propagates through a bound PK to dependent foreign keys and notices it", () => {
    const customer = s().createEntity();
    const pk = s().addField(customer)!;
    const domainId = s().createDomain();
    s().updateDomain(domainId, { type: "uuid" });
    s().updateField(customer, pk, { primaryKey: true, nullable: false });
    s().bindFieldDomain(customer, pk, domainId);
    const order = s().createEntity();
    s().createRelationship({
      cardinality: "one-to-many",
      parentEntity: customer,
      childEntity: order,
      foreignKeyFieldName: "customer_id",
    });
    const before = s().notices.length;
    s().updateDomain(domainId, { type: "bigint" });
    const fk = s().model.entities
      .find((e) => e.id === order)!
      .fields.find((f) => f.name === "customer_id")!;
    expect(fk.type).toBe("bigint");
    expect(s().notices.length).toBe(before + 1);
  });

  it("survives a serialize/parse round-trip", () => {
    const { entityId, fieldId } = entityWithField();
    const domainId = s().createDomain();
    s().updateDomain(domainId, {
      name: "money",
      type: "decimal",
      precision: 14,
      scale: 4,
      description: "currency amount",
    });
    s().bindFieldDomain(entityId, fieldId, domainId);
    const text = serializeModel(s().model);
    const parsed = parseModelFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.domains).toHaveLength(1);
    expect(parsed.value.domains![0].name).toBe("money");
    expect(parsed.value.domains![0].precision).toBe(14);
    expect(parsed.value.entities[0].fields[0].domainId).toBe(domainId);
    // Byte-identical determinism (FR-5.5/FR-8.6 spirit).
    expect(serializeModel(parsed.value)).toBe(text);
  });

  it("undoes and redoes a domain edit", () => {
    const domainId = s().createDomain();
    s().updateDomain(domainId, { type: "uuid" });
    expect(s().model.domains![0].type).toBe("uuid");
    s().undo();
    expect(s().model.domains![0].type).toBe("string");
    s().redo();
    expect(s().model.domains![0].type).toBe("uuid");
  });
});
