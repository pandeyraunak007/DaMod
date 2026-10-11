// Phase 5 hardening — engine invariants for the Naming Standards transform/compliance.
// These are the properties an identifier-rewriting engine must hold to be trustworthy.
import { describe, it, expect } from "vitest";
import { toWords, applyNamingRule, checkNaming, previewNaming, newNamingStandard, type NamingRule, NAME_CASES } from "./naming";
import { newModel, newEntity, newField, type Model } from "./model";

const SAMPLE = [
  "CustomerOrder", "customer_id", "customerID", "APIKey", "first-name",
  "ORDER_TOTAL", "x", "A1B2", "already_snake", "HTTPStatusCode", "mixED_Case",
];

describe("invariant: applyNamingRule is idempotent (its output is a fixed point)", () => {
  for (const c of NAME_CASES) {
    it(`case=${c} — f(f(x)) === f(x) across the sample`, () => {
      const rule: NamingRule = { target: "attribute", case: c, prefix: "p_", suffix: "_s" };
      for (const name of SAMPLE) {
        const once = applyNamingRule(name, rule);
        const twice = applyNamingRule(once, rule);
        expect(twice).toBe(once);
      }
    });
  }
});

describe("invariant: toWords is stable on canonical (snake) output", () => {
  it("toWords(words.join('_')) === words", () => {
    for (const name of SAMPLE) {
      const words = toWords(name);
      expect(toWords(words.join("_"))).toEqual(words);
    }
  });
});

function sampleModel(): Model {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const e = newEntity("CustomerOrder", { x: 0, y: 0 });
  e.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
  e.fields.push(newField("customerName", "string"));
  m.entities.push(e);
  return m;
}

describe("invariant: a conformed model has no further (non-colliding) changes — convergence", () => {
  it("applying the proposed names makes checkNaming's rename set empty", () => {
    const m = sampleModel();
    const std = newNamingStandard("snake");
    std.rules = [
      { target: "entity", case: "snake_case" },
      { target: "attribute", case: "snake_case" },
    ];
    // Simulate apply by writing the proposed names onto a clone.
    const applied: Model = JSON.parse(JSON.stringify(m));
    for (const c of previewNaming(m, std).changes) {
      if (c.target === "entity") applied.entities.find((e) => e.id === c.entityId)!.name = c.to;
      if (c.target === "attribute") applied.entities.find((e) => e.id === c.entityId)!.fields.find((f) => f.id === c.fieldId)!.name = c.to;
    }
    // Re-previewing the applied model yields no renames (ignoring any length-only flags).
    expect(previewNaming(applied, std).changes).toHaveLength(0);
  });
});

describe("edge cases", () => {
  it("empty rule set produces no changes and no collisions", () => {
    const m = sampleModel();
    const p = previewNaming(m, newNamingStandard("empty"));
    expect(p.changes).toHaveLength(0);
    expect(p.collisions).toHaveLength(0);
  });

  it("a length-only violation is reported by checkNaming but is NOT an auto-rename", () => {
    const m = sampleModel();
    const std = newNamingStandard("len");
    std.rules = [{ target: "attribute", case: "preserve", maxLength: 4 }];
    // "OrderID"(7) and "customerName"(12) exceed 4 → length violations…
    expect(checkNaming(m, std).filter((v) => v.reasons.includes("length")).length).toBe(2);
    // …but preserve-case + no affix means proposed === current → no rename proposed.
    expect(previewNaming(m, std).changes).toHaveLength(0);
  });

  it("a degenerate name that recases to empty is surfaced but skipped-worthy (invalid id)", () => {
    const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
    const e = newEntity("T", { x: 0, y: 0 });
    e.fields.push(newField("___", "string")); // no word characters
    m.entities.push(e);
    const std = newNamingStandard("snake");
    std.rules = [{ target: "attribute", case: "snake_case" }];
    const change = previewNaming(m, std).changes.find((c) => c.from === "___");
    // Either no change is proposed, or the proposed name is empty (an invalid identifier
    // the apply step will skip) — never a silent corruption.
    if (change) expect(change.to).toBe("");
  });

  it("three-way collision marks all three ids", () => {
    const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
    const e = newEntity("T", { x: 0, y: 0 });
    e.fields.push(newField("firstName", "string"));
    e.fields.push(newField("first_name", "string"));
    e.fields.push(newField("FirstName", "string"));
    m.entities.push(e);
    const std = newNamingStandard("snake");
    std.rules = [{ target: "attribute", case: "snake_case" }];
    const p = previewNaming(m, std);
    expect(p.collisions.some((c) => c.name === "first_name")).toBe(true);
    expect(p.collidingIds).toHaveLength(3);
  });
});
