// Phase 3 Slice A — type-standard store CRUD, apply (one undo, FK realign), round-trip.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel, newEntity, newField } from "../model/model";
import { createRelationship } from "../model/operations";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";

const s = () => useModelStore.getState();

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
});

describe("type standard store ops", () => {
  it("creates, updates rules, deletes — undoable — and round-trips", () => {
    const id = s().createTypeStandard();
    expect(s().model.typeStandards).toHaveLength(1);
    s().updateTypeStandard(id, {
      name: "House",
      rules: [{ type: "decimal", precision: 15, scale: 2 }],
    });
    const once = serializeModel(s().model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeModel(parsed.value)).toBe(once);
    expect(parsed.value.typeStandards![0].rules[0].precision).toBe(15);

    s().undo(); // revert the update
    expect(s().model.typeStandards![0].name).toBe("New type standard");
    s().deleteTypeStandard(id);
    expect(s().model.typeStandards ?? []).toHaveLength(0);
  });

  it("applyTypeStandard normalises params as one undo step and realigns FK types", () => {
    // Parent PK amount decimal(12,2); child FK mirrors it.
    let m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
    const p = newEntity("P", { x: 0, y: 0 });
    p.fields.push(newField("amount", "decimal", { primaryKey: true, nullable: false, precision: 12, scale: 2 }));
    const c = newEntity("C", { x: 0, y: 0 });
    c.fields.push(newField("cid", "integer", { primaryKey: true, nullable: false }));
    m.entities.push(p, c);
    m = createRelationship(m, { cardinality: "one-to-many", parentEntity: p.id, childEntity: c.id, foreignKeyFieldName: "amount" }).model;
    s().loadModel(m);

    const id = s().createTypeStandard();
    s().updateTypeStandard(id, { rules: [{ type: "decimal", precision: 18, scale: 4 }] });
    const res = s().applyTypeStandard(id);
    expect(res.applied).toBeGreaterThan(0);

    const parent = s().model.entities.find((e) => e.name === "P")!;
    expect(parent.fields[0].precision).toBe(18);
    expect(parent.fields[0].scale).toBe(4);
    // FK column realigned to the parent PK's new precision/scale.
    const child = s().model.entities.find((e) => e.name === "C")!;
    const fk = child.fields.find((f) => f.name === "amount")!;
    expect(fk.precision).toBe(18);
    expect(fk.scale).toBe(4);

    s().undo(); // one step reverts the whole normalisation
    expect(s().model.entities.find((e) => e.name === "P")!.fields[0].precision).toBe(12);
  });
});
