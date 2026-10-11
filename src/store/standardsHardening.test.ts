// Phase 5 hardening — apply invariants that must hold for a governance feature to be
// trustworthy: idempotence, post-apply referential integrity (no new validation errors,
// no duplicate names), undo byte-identical restore, composite-PK FK mirroring, self-ref
// safety, and type-standard convergence.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel, newEntity, newField } from "../model/model";
import { createRelationship } from "../model/operations";
import { serializeModel } from "../persist/serialize";
import { validateWorkspace } from "../validation/rules";

const s = () => useModelStore.getState();
const errorsNow = () => {
  const m = s().model;
  return validateWorkspace({ models: [{ id: m.id, name: m.name, model: m }], links: [], conceptGroups: [] }).filter(
    (i) => i.severity === "error",
  );
};

function seedRelated() {
  let m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const cust = newEntity("Customer", { x: 0, y: 0 });
  cust.fields.push(newField("CustID", "integer", { primaryKey: true, nullable: false }));
  const order = newEntity("Order", { x: 0, y: 0 });
  order.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
  m.entities.push(cust, order);
  m = createRelationship(m, { cardinality: "one-to-many", parentEntity: cust.id, childEntity: order.id, foreignKeyFieldName: "CustID" }).model;
  s().loadModel(m);
}

beforeEach(seedRelated);

describe("apply invariants — naming", () => {
  it("is idempotent: a second apply is a byte-identical no-op", () => {
    const id = s().createNamingStandard();
    s().updateNamingStandard(id, {
      rules: [
        { target: "entity", case: "snake_case", prefix: "t_" },
        { target: "attribute", case: "snake_case" },
      ],
    });
    s().applyNamingStandard(id);
    const after1 = serializeModel(s().model);
    const res2 = s().applyNamingStandard(id);
    expect(res2.applied).toBe(0); // nothing left to change
    expect(serializeModel(s().model)).toBe(after1);
  });

  it("introduces no validation errors and no duplicate names (clean model stays clean)", () => {
    expect(errorsNow()).toHaveLength(0);
    const id = s().createNamingStandard();
    s().updateNamingStandard(id, {
      rules: [
        { target: "entity", case: "screaming_snake" },
        { target: "attribute", case: "screaming_snake" },
      ],
    });
    s().applyNamingStandard(id);
    expect(errorsNow()).toHaveLength(0); // referential integrity + uniqueness intact
  });

  it("undo restores the model byte-identically", () => {
    const id = s().createNamingStandard();
    s().updateNamingStandard(id, { rules: [{ target: "attribute", case: "snake_case" }] });
    const before = serializeModel(s().model);
    s().applyNamingStandard(id);
    expect(serializeModel(s().model)).not.toBe(before);
    s().undo();
    expect(serializeModel(s().model)).toBe(before);
  });

  it("composite PK: both FK columns mirror both parent PK final names", () => {
    // Rebuild with a 2-column PK on the parent.
    let m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
    const p = newEntity("P", { x: 0, y: 0 });
    p.fields.push(newField("k1", "integer", { primaryKey: true, nullable: false }));
    p.fields.push(newField("k2", "integer", { primaryKey: true, nullable: false }));
    const c = newEntity("C", { x: 0, y: 0 });
    c.fields.push(newField("cid", "integer", { primaryKey: true, nullable: false }));
    m.entities.push(p, c);
    m = createRelationship(m, { cardinality: "one-to-many", parentEntity: p.id, childEntity: c.id }).model;
    s().loadModel(m);

    const id = s().createNamingStandard();
    s().updateNamingStandard(id, { rules: [{ target: "attribute", case: "screaming_snake" }] });
    s().applyNamingStandard(id);

    const child = s().model.entities.find((e) => e.name === "C")!;
    const names = child.fields.map((f) => f.name);
    expect(names).toContain("K1");
    expect(names).toContain("K2");
    expect(errorsNow()).toHaveLength(0);
  });

  it("self-referencing relationship: apply does not crash and stays valid", () => {
    let m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
    const e = newEntity("Node", { x: 0, y: 0 });
    e.fields.push(newField("id", "integer", { primaryKey: true, nullable: false }));
    m.entities.push(e);
    m = createRelationship(m, { cardinality: "one-to-many", parentEntity: e.id, childEntity: e.id, foreignKeyFieldName: "parent_id" }).model;
    s().loadModel(m);
    const id = s().createNamingStandard();
    s().updateNamingStandard(id, { rules: [{ target: "attribute", case: "snake_case" }] });
    expect(() => s().applyNamingStandard(id)).not.toThrow();
    expect(errorsNow()).toHaveLength(0);
  });
});

describe("apply invariants — type standard", () => {
  it("converges: a second apply is a byte-identical no-op", () => {
    const e = s().model.entities.find((x) => x.name === "Customer")!;
    const fid = s().addField(e.id)!;
    s().updateField(e.id, fid, { name: "amount", type: "decimal", precision: 12, scale: 2 });
    const id = s().createTypeStandard();
    s().updateTypeStandard(id, { rules: [{ type: "decimal", precision: 18, scale: 4 }] });
    s().applyTypeStandard(id);
    const after1 = serializeModel(s().model);
    const res2 = s().applyTypeStandard(id);
    expect(res2.applied).toBe(0);
    expect(serializeModel(s().model)).toBe(after1);
  });
});
