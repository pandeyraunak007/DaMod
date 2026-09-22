import { describe, it, expect } from "vitest";
import {
  logicalToPhysical,
  physicalToLogical,
  canExportDdl,
  exportDisabledReason,
  usesPhysicalTypes,
  usesLogicalTypes,
  isConceptual,
} from "./levels";
import { newModel, newEntity, newField } from "./model";
import { relevelModel, createRelationship } from "./operations";

describe("level predicates (FR-11)", () => {
  it("classifies which levels use which types", () => {
    expect(isConceptual("Conceptual")).toBe(true);
    expect(usesLogicalTypes("Logical")).toBe(true);
    expect(usesLogicalTypes("Physical/Logical")).toBe(true);
    expect(usesPhysicalTypes("Physical")).toBe(true);
    expect(usesPhysicalTypes("Physical/Logical")).toBe(true);
    expect(usesPhysicalTypes("Logical")).toBe(false);
  });

  it("gates DDL export to physical levels (FR-11.8)", () => {
    expect(canExportDdl("Physical")).toBe(true);
    expect(canExportDdl("Physical/Logical")).toBe(true);
    expect(canExportDdl("Logical")).toBe(false);
    expect(canExportDdl("Conceptual")).toBe(false);
    expect(exportDisabledReason("Logical")).toContain("Physical");
    expect(exportDisabledReason("Physical")).toBeNull();
  });
});

describe("type conversions (FR-11.6)", () => {
  it("maps generic to physical, flagging ambiguous ones", () => {
    expect(logicalToPhysical("Decimal")).toMatchObject({ type: "decimal", ambiguous: false });
    expect(logicalToPhysical("Boolean")).toMatchObject({ type: "boolean", ambiguous: false });
    expect(logicalToPhysical("Text").ambiguous).toBe(true);
    expect(logicalToPhysical("Number").ambiguous).toBe(true);
    expect(logicalToPhysical("Identifier").ambiguous).toBe(true);
  });

  it("maps physical down to generic", () => {
    expect(physicalToLogical("uuid")).toBe("Identifier");
    expect(physicalToLogical("bigint")).toBe("Number");
    expect(physicalToLogical("timestamp")).toBe("Timestamp");
    expect(physicalToLogical("text")).toBe("Text");
  });
});

describe("relevelModel (AT-1.12)", () => {
  function logicalModel() {
    const m = newModel("orders", "2026-01-01T00:00:00Z", "Logical");
    const order = newEntity("Order", { x: 0, y: 0 });
    order.fields.push(newField("id", undefined, { logicalType: "Identifier", primaryKey: true }));
    order.fields.push(newField("total", undefined, { logicalType: "Decimal" }));
    m.entities.push(order);
    return m;
  }

  it("raising Logical -> Physical synthesises physical types and flags ambiguous", () => {
    const { model, ambiguous } = relevelModel(logicalModel(), "Physical");
    expect(model.level).toBe("Physical");
    const fields = model.entities[0].fields;
    expect(fields.find((f) => f.name === "total")!.type).toBe("decimal"); // unambiguous
    expect(fields.find((f) => f.name === "id")!.type).toBe("uuid"); // Identifier -> uuid (ambiguous)
    expect(ambiguous.some((a) => a.fieldName === "id")).toBe(true);
  });

  it("lowering Physical -> Logical keeps physical detail (reversible)", () => {
    const raised = relevelModel(logicalModel(), "Physical").model;
    const lowered = relevelModel(raised, "Logical").model;
    // physical type retained, not deleted
    expect(lowered.entities[0].fields.find((f) => f.name === "total")!.type).toBe("decimal");
    expect(lowered.entities[0].fields.find((f) => f.name === "total")!.logicalType).toBe("Decimal");
  });
});

describe("level-aware relationships (FR-11.2/11.3)", () => {
  function twoEntities(level: Parameters<typeof newModel>[2]) {
    const m = newModel("m", "2026-01-01T00:00:00Z", level);
    const parent = newEntity("Customer", { x: 0, y: 0 });
    const child = newEntity("Order", { x: 200, y: 0 });
    if (level === "Logical") {
      parent.fields.push(newField("id", undefined, { logicalType: "Identifier", primaryKey: true }));
    } else if (level !== "Conceptual") {
      parent.fields.push(newField("id", "uuid", { primaryKey: true }));
    }
    m.entities.push(parent, child);
    return { m, parent, child };
  }

  it("Conceptual creates no foreign-key field", () => {
    const { m, parent, child } = twoEntities("Conceptual");
    const { model } = createRelationship(m, {
      cardinality: "one-to-many",
      parentEntity: parent.id,
      childEntity: child.id,
    });
    expect(model.entities.find((e) => e.id === child.id)!.fields).toHaveLength(0);
  });

  it("Logical creates an FK with a generic type", () => {
    const { m, parent, child } = twoEntities("Logical");
    const { model } = createRelationship(m, {
      cardinality: "one-to-many",
      parentEntity: parent.id,
      childEntity: child.id,
      foreignKeyFieldName: "customer_id",
    });
    const fk = model.entities.find((e) => e.id === child.id)!.fields[0];
    expect(fk.logicalType).toBe("Identifier");
    expect(fk.type).toBeUndefined();
  });
});
