// Phase 3 Slice A — Data Type Standards engine. Pure param-compliance + lossy
// surfacing; no model is mutated by the checkers.
import { describe, it, expect } from "vitest";
import { checkTypes, lossyTypeWarnings, newTypeStandard } from "./typeStandards";
import { newModel, newEntity, newField, type Model } from "./model";

function model(dialect?: Parameters<typeof newModel>[3]): Model {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical", dialect);
  const e = newEntity("T", { x: 0, y: 0 });
  e.fields.push(newField("code", "string", { length: 255 }));
  e.fields.push(newField("amount", "decimal", { precision: 12, scale: 2 }));
  e.fields.push(newField("ref", "uuid"));
  m.entities.push(e);
  return m;
}

describe("checkTypes", () => {
  it("flags params that deviate from the standard, with proposed values, no mutation", () => {
    const m = model();
    const before = JSON.stringify(m);
    const std = newTypeStandard("house types");
    std.rules = [
      { type: "string", length: 100 },
      { type: "decimal", precision: 15, scale: 2 },
    ];
    const v = checkTypes(m, std);

    const code = v.find((x) => x.fieldName === "code")!;
    expect(code.reasons).toEqual(["length"]);
    expect(code.proposed.length).toBe(100);

    const amount = v.find((x) => x.fieldName === "amount")!;
    expect(amount.reasons).toEqual(["precision"]); // scale already 2
    expect(amount.proposed.precision).toBe(15);
    expect(amount.proposed.scale).toBe(2);

    expect(JSON.stringify(m)).toBe(before);
  });

  it("skips domain-bound columns (the domain governs the type)", () => {
    const m = model();
    m.domains = [{ id: "n_x", name: "Code", type: "string", length: 255 }];
    m.entities[0].fields[0].domainId = "n_x"; // bind "code"
    const std = newTypeStandard("s");
    std.rules = [{ type: "string", length: 100 }];
    expect(checkTypes(m, std).some((x) => x.fieldName === "code")).toBe(false);
  });

  it("returns nothing when there is no rule for a type, or params already conform", () => {
    const m = model();
    const std = newTypeStandard("s");
    std.rules = [{ type: "decimal", precision: 12, scale: 2 }]; // already conforms
    expect(checkTypes(m, std)).toHaveLength(0);
  });
});

describe("lossyTypeWarnings", () => {
  it("flags lossy canonical→dialect mappings for the model's dialect", () => {
    const sf = lossyTypeWarnings(model("snowflake"));
    expect(sf.some((w) => w.fieldName === "ref" && w.type === "uuid")).toBe(true);
  });
  it("is empty when the dialect has native support (Postgres uuid)", () => {
    expect(lossyTypeWarnings(model("postgres"))).toHaveLength(0);
  });
});
