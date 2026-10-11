// Phase 4 — Copilot actions for Naming & Data Type Standards. Create + apply flow
// through the SAME store ops as the UI (one undo group), idempotent, reviewed.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "../store/modelStore";
import { newModel, newEntity, newField } from "../model/model";
import { parsePlan, requiresApproval } from "./actions";
import { executePlan } from "./execute";

const s = () => useModelStore.getState();

beforeEach(() => {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const e = newEntity("CustomerOrder", { x: 0, y: 0 });
  e.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
  e.fields.push(newField("amount", "decimal", { precision: 12, scale: 2 }));
  m.entities.push(e);
  s().loadModel(m);
});

describe("Copilot: create + apply naming standard", () => {
  it("creates a standard and applies it as one undo group (reviewed/approved)", () => {
    const plan = parsePlan({
      summary: "house naming",
      actions: [
        {
          kind: "create_naming_standard",
          name: "House",
          rules: [
            { target: "entity", case: "snake_case" },
            { target: "attribute", case: "snake_case" },
          ],
        },
        { kind: "apply_naming_standard", name: "House" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(requiresApproval(plan.value)).toBe(true); // structural → needs approval

    const res = executePlan(plan.value);
    expect(res.applied).toBe(2);
    expect(res.failed).toBe(0);

    const m = s().model;
    expect(m.namingStandards).toHaveLength(1);
    expect(m.entities[0].name).toBe("customer_order");
    expect(m.entities[0].fields.map((f) => f.name)).toEqual(["order_id", "amount"]);

    // The whole plan (create + apply) reverts in one undo.
    s().undo();
    expect(s().model.entities[0].name).toBe("CustomerOrder");
    expect(s().model.namingStandards ?? []).toHaveLength(0);
  });

  it("is idempotent — re-running skips the existing standard and conformant apply", () => {
    const plan = parsePlan({
      summary: "x",
      actions: [
        { kind: "create_naming_standard", name: "House", rules: [{ target: "attribute", case: "snake_case" }] },
        { kind: "apply_naming_standard", name: "House" },
      ],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    const res2 = executePlan(plan.value);
    expect(res2.skipped).toBe(2); // standard exists + model already conforms
    expect(res2.applied).toBe(0);
  });

  it("fails apply when the named standard does not exist", () => {
    const plan = parsePlan({ summary: "x", actions: [{ kind: "apply_naming_standard", name: "Nope" }] });
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.failed).toBe(1);
  });
});

describe("Copilot: create + apply type standard", () => {
  it("creates then normalises column params", () => {
    const plan = parsePlan({
      summary: "types",
      actions: [
        { kind: "create_type_standard", name: "Money", rules: [{ type: "decimal", precision: 18, scale: 4 }] },
        { kind: "apply_type_standard", name: "Money" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(2);
    const amount = s().model.entities[0].fields.find((f) => f.name === "amount")!;
    expect(amount.precision).toBe(18);
    expect(amount.scale).toBe(4);
  });

  it("rejects an invalid type-standard rule (bad canonical type)", () => {
    const r = parsePlan({
      summary: "x",
      actions: [{ kind: "create_type_standard", name: "Bad", rules: [{ type: "not_a_type" }] }],
    });
    expect(r.ok).toBe(false);
  });
});
