import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { validateWorkspace } from "../validation/rules";

function reset() {
  useModelStore.getState().loadModel(newModel("sales", "2026-01-01T00:00:00Z"));
}
const s = () => useModelStore.getState();

describe("SCD-2 scaffolding", () => {
  beforeEach(reset);

  it("adds a surrogate key and the SCD-2 temporal columns", () => {
    const dim = s().createEntity();
    s().renameEntity(dim, "Customer");
    const nk = s().addField(dim)!;
    s().updateField(dim, nk, { name: "customer_id", type: "uuid", primaryKey: true, nullable: false });

    s().applyScd2(dim);
    const e = s().model.entities.find((x) => x.id === dim)!;
    const names = e.fields.map((f) => f.name);
    expect(names).toContain("Customer_key");
    expect(names).toContain("valid_from");
    expect(names).toContain("valid_to");
    expect(names).toContain("is_current");
    expect(names).toContain("version");

    // Surrogate is the sole PK; the natural key is demoted to a business key.
    const sur = e.fields.find((f) => f.name === "Customer_key")!;
    expect(sur.primaryKey).toBe(true);
    expect(sur.type).toBe("bigint");
    expect(e.fields.filter((f) => f.primaryKey)).toHaveLength(1);
    expect(e.fields.find((f) => f.name === "customer_id")!.primaryKey).toBe(false);
    // Defaults the stereotype to dimension.
    expect(e.stereotype).toBe("dimension");
  });

  it("is idempotent (no duplicate columns on a second run)", () => {
    const dim = s().createEntity();
    s().renameEntity(dim, "Product");
    s().applyScd2(dim);
    const after1 = s().model.entities.find((x) => x.id === dim)!.fields.length;
    s().applyScd2(dim);
    const after2 = s().model.entities.find((x) => x.id === dim)!.fields.length;
    expect(after2).toBe(after1);
    expect(
      s().model.entities.find((x) => x.id === dim)!.fields.filter((f) => f.name === "Product_key"),
    ).toHaveLength(1);
  });

  it("realigns a dependent fact foreign key to the new surrogate type", () => {
    const dim = s().createEntity();
    s().renameEntity(dim, "Customer");
    const nk = s().addField(dim)!;
    s().updateField(dim, nk, { name: "customer_id", type: "uuid", primaryKey: true, nullable: false });
    const fact = s().createEntity();
    s().renameEntity(fact, "Sale");
    s().createRelationship({
      cardinality: "one-to-many",
      parentEntity: dim,
      childEntity: fact,
      foreignKeyFieldName: "customer_fk",
    });
    // Before: the FK copied the uuid natural key.
    const fkBefore = s().model.entities.find((e) => e.id === fact)!.fields.find((f) => f.name === "customer_fk")!;
    expect(fkBefore.type).toBe("uuid");

    s().applyScd2(dim);
    const fkAfter = s().model.entities.find((e) => e.id === fact)!.fields.find((f) => f.name === "customer_fk")!;
    expect(fkAfter.type).toBe("bigint");
  });

  it("undoes as a single step", () => {
    const dim = s().createEntity();
    const before = s().model.entities.find((x) => x.id === dim)!.fields.length;
    s().applyScd2(dim);
    expect(s().model.entities.find((x) => x.id === dim)!.fields.length).toBeGreaterThan(before);
    s().undo();
    expect(s().model.entities.find((x) => x.id === dim)!.fields.length).toBe(before);
  });
});

describe("fact column roles", () => {
  beforeEach(reset);

  it("round-trips a measure/degenerate role", () => {
    const fact = s().createEntity();
    const m = s().addField(fact)!;
    s().updateField(fact, m, { name: "amount", type: "decimal", role: "measure" });
    const d = s().addField(fact)!;
    s().updateField(fact, d, { name: "order_no", type: "integer", role: "degenerate" });

    const text = serializeModel(s().model);
    const parsed = parseModelFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const e = parsed.value.entities[0];
    expect(e.fields.find((f) => f.name === "amount")!.role).toBe("measure");
    expect(e.fields.find((f) => f.name === "order_no")!.role).toBe("degenerate");
    expect(serializeModel(parsed.value)).toBe(text);
  });

  it("warns when a measure is marked on a non-numeric field", () => {
    const fact = s().createEntity();
    s().renameEntity(fact, "Sale");
    const f = s().addField(fact)!;
    s().updateField(fact, f, { name: "label", type: "text", role: "measure" });
    const model = s().model;
    const issues = validateWorkspace({
      models: [{ id: model.id, name: model.name, model }],
      links: [],
      conceptGroups: [],
    });
    expect(issues.some((i) => i.rule === "measureRoleFit")).toBe(true);
  });

  it("does not warn for a numeric measure", () => {
    const fact = s().createEntity();
    const f = s().addField(fact)!;
    s().updateField(fact, f, { name: "qty", type: "integer", role: "measure" });
    const model = s().model;
    const issues = validateWorkspace({
      models: [{ id: model.id, name: model.name, model }],
      links: [],
      conceptGroups: [],
    });
    expect(issues.some((i) => i.rule === "measureRoleFit")).toBe(false);
  });
});
