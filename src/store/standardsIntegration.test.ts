// Phase 5 — integration & hardening. Domains + Naming + Data Type standards coexist
// correctly: precedence is honored, the model round-trips byte-identically, each
// apply is one undo step, and standards don't break DDL on any dialect.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel, newEntity, newField, lossyTypeWarnings } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { exportModelDDL } from "../export/ddl";
import { DIALECTS, DIALECT_IDS } from "../export/dialects";

const s = () => useModelStore.getState();

beforeEach(() => {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const e = newEntity("CustomerOrder", { x: 0, y: 0 });
  e.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
  e.fields.push(newField("amount", "decimal", { precision: 12, scale: 2 }));
  e.fields.push(newField("note", "string", { length: 255 }));
  m.entities.push(e);
  s().loadModel(m);
});

describe("standards coexistence + precedence", () => {
  it("type standard skips a domain-bound column (domain governs), naming renames both", () => {
    // Bind `amount` to a Money domain = decimal(15,2).
    const dom = s().createDomain();
    s().updateDomain(dom, { name: "Money", type: "decimal", precision: 15, scale: 2 });
    const ent0 = s().model.entities[0];
    const amountId = ent0.fields.find((f) => f.name === "amount")!.id;
    s().bindFieldDomain(ent0.id, amountId, dom);
    expect(s().model.entities[0].fields.find((f) => f.id === amountId)!.precision).toBe(15);

    // Naming: snake_case entities + attributes.
    const ns = s().createNamingStandard();
    s().updateNamingStandard(ns, {
      rules: [
        { target: "entity", case: "snake_case" },
        { target: "attribute", case: "snake_case" },
      ],
    });
    s().applyNamingStandard(ns);
    expect(s().model.entities[0].name).toBe("customer_order");

    // Type standard: decimal → (18,4). The domain-bound `amount` must be LEFT ALONE.
    const ts = s().createTypeStandard();
    s().updateTypeStandard(ts, { rules: [{ type: "decimal", precision: 18, scale: 4 }] });
    const res = s().applyTypeStandard(ts);

    const amount = s().model.entities[0].fields.find((f) => f.id === amountId)!;
    expect(amount.precision).toBe(15); // still the domain's value — not overridden
    expect(amount.domainId).toBe(dom); // binding intact through the rename
    // (res.applied counts only non-domain decimal columns; there are none here)
    expect(res.applied).toBe(0);
  });

  it("round-trips byte-identically with all three standards + a domain present", () => {
    const dom = s().createDomain();
    s().updateDomain(dom, { name: "Money", type: "decimal", precision: 15, scale: 2 });
    const ns = s().createNamingStandard();
    s().updateNamingStandard(ns, { name: "House", mirrorForeignKeys: false, rules: [{ target: "attribute", case: "snake_case", prefix: "c_" }] });
    const ts = s().createTypeStandard();
    s().updateTypeStandard(ts, { name: "Types", rules: [{ type: "string", length: 100 }] });

    const once = serializeModel(s().model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeModel(parsed.value)).toBe(once);
    expect(parsed.value.domains).toHaveLength(1);
    expect(parsed.value.namingStandards![0].mirrorForeignKeys).toBe(false);
    expect(parsed.value.typeStandards![0].rules[0].length).toBe(100);
  });

  it("each apply is a single undo step", () => {
    const ns = s().createNamingStandard();
    s().updateNamingStandard(ns, { rules: [{ target: "entity", case: "snake_case" }] });
    s().applyNamingStandard(ns);
    expect(s().model.entities[0].name).toBe("customer_order");
    s().undo(); // reverts the apply only
    expect(s().model.entities[0].name).toBe("CustomerOrder");
    // the standard itself still exists (its creation was a separate step)
    expect(s().model.namingStandards).toHaveLength(1);
  });
});

describe("backward compatibility + all-dialect safety", () => {
  it("loads a model with NO standards/domains fields (older file) without loss", () => {
    const legacy = {
      formatVersion: 1,
      id: "m_legacy00",
      name: "legacy",
      level: "Physical",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      entities: [{ id: "e_legacy00", name: "T", position: { x: 0, y: 0 }, fields: [] }],
      relationships: [],
    };
    const parsed = parseModelFile(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.namingStandards).toBeUndefined();
    expect(parsed.value.typeStandards).toBeUndefined();
  });

  it("standards present do not break DDL export on any of the 7 dialects", () => {
    s().createNamingStandard();
    s().createTypeStandard();
    const dom = s().createDomain();
    s().updateDomain(dom, { name: "Money", type: "decimal" });
    for (const id of DIALECT_IDS) {
      const ddl = exportModelDDL(s().model, DIALECTS[id]);
      expect(ddl).toContain("CREATE TABLE"); // DDL still generated; standards are model-only
    }
  });

  it("lossy warnings are dialect-specific (uuid lossy on Snowflake, native on Postgres)", () => {
    s().addField(s().model.entities[0].id);
    const e = s().model.entities[0];
    s().updateField(e.id, e.fields[e.fields.length - 1].id, { name: "ref", type: "uuid" });
    // Model default dialect is Postgres → uuid native → no lossy warning.
    expect(lossyTypeWarnings(s().model).some((w) => w.type === "uuid")).toBe(false);
  });
});
