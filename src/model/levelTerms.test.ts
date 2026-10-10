import { describe, it, expect, beforeEach } from "vitest";
import {
  levelTerms,
  showsPhysicalObjects,
  showsKeys,
  type ModelLevel,
} from "./levels";
import { useModelStore } from "../store/modelStore";
import { newModel } from "./model";

describe("levelTerms — erwin-style terminology per level", () => {
  it("Logical uses Entity / Attribute", () => {
    expect(levelTerms("Logical")).toMatchObject({ entityPlural: "Entities", fieldPlural: "Attributes" });
  });

  it("Physical uses Table / Column", () => {
    expect(levelTerms("Physical")).toMatchObject({ entity: "Table", fieldPlural: "Columns" });
  });

  it("Physical/Logical uses Table / Column", () => {
    expect(levelTerms("Physical/Logical")).toMatchObject({ entity: "Table", field: "Column" });
  });

  it("Conceptual uses Business Entity / Attribute", () => {
    expect(levelTerms("Conceptual")).toMatchObject({ entityPlural: "Business Entities", field: "Attribute" });
  });

  // The reported bug: switching Logical <-> Physical must flip the terminology.
  it("flips Entity/Attribute <-> Table/Column across the Logical/Physical boundary", () => {
    const logical = levelTerms("Logical");
    const physical = levelTerms("Physical");
    expect(logical.entityPlural).toBe("Entities");
    expect(physical.entityPlural).toBe("Tables");
    expect(logical.fieldPlural).toBe("Attributes");
    expect(physical.fieldPlural).toBe("Columns");
    // Reverting gives the logical terms back (no stale labels).
    expect(levelTerms("Logical")).toEqual(logical);
  });
});

describe("level-aware visibility", () => {
  it("shows physical-only objects only where there is a physical implementation", () => {
    expect(showsPhysicalObjects("Conceptual")).toBe(false);
    expect(showsPhysicalObjects("Logical")).toBe(false);
    expect(showsPhysicalObjects("Physical/Logical")).toBe(true);
    expect(showsPhysicalObjects("Physical")).toBe(true);
  });

  it("hides key markers only at Conceptual", () => {
    expect(showsKeys("Conceptual")).toBe(false);
    expect(showsKeys("Logical")).toBe(true);
    expect(showsKeys("Physical")).toBe(true);
  });
});

describe("data integrity: switching level is presentation-only for identity", () => {
  const s = () => useModelStore.getState();

  beforeEach(() => {
    useModelStore.getState().loadModel(newModel("sales", "2026-01-01T00:00:00Z", "Logical"));
  });

  it("preserves entity/field/relationship IDs and counts across repeated level switches", () => {
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

    const snapshot = () => {
      const m = s().model;
      return {
        entityIds: m.entities.map((e) => e.id).sort(),
        fieldIds: m.entities.flatMap((e) => e.fields.map((f) => f.id)).sort(),
        relIds: m.relationships.map((r) => r.id).sort(),
        entityCount: m.entities.length,
        relCount: m.relationships.length,
      };
    };
    const before = snapshot();

    const cycle: ModelLevel[] = ["Physical", "Logical", "Physical/Logical", "Conceptual", "Logical", "Physical"];
    for (const lvl of cycle) s().setModelLevel(lvl);

    const after = snapshot();
    expect(after.entityIds).toEqual(before.entityIds); // no new/lost entities
    expect(after.fieldIds).toEqual(before.fieldIds); // no duplicated/dropped fields
    expect(after.relIds).toEqual(before.relIds); // relationships not regenerated
    expect(after.entityCount).toBe(before.entityCount);
    expect(after.relCount).toBe(before.relCount);
  });
});
