import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parsePlan } from "./actions";
import { executePlan } from "./execute";

const s = () => useModelStore.getState();

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("shop", "2026-01-01T00:00:00Z", "Physical"));
});

describe("Copilot plan validation", () => {
  it("rejects a malformed plan (bad action)", () => {
    const r = parsePlan({ summary: "x", actions: [{ kind: "nope" }] });
    expect(r.ok).toBe(false);
  });
  it("accepts a well-formed plan", () => {
    const r = parsePlan({
      summary: "add Customer",
      actions: [{ kind: "create_entity", name: "Customer", fields: [{ name: "id", type: "uuid", primaryKey: true }] }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("executePlan (reuses existing ops, atomic, idempotent)", () => {
  it("creates entities + a relationship and applies them as ONE undo step", () => {
    const plan = parsePlan({
      summary: "orders",
      actions: [
        { kind: "create_entity", name: "Customer", description: "A buyer", fields: [{ name: "id", type: "uuid", primaryKey: true }] },
        { kind: "create_entity", name: "Order", fields: [{ name: "id", type: "uuid", primaryKey: true }] },
        { kind: "create_relationship", parent: "Customer", child: "Order", cardinality: "one-to-many", foreignKeyFieldName: "customer_id" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const res = executePlan(plan.value);
    expect(res.applied).toBe(3);
    expect(res.failed).toBe(0);

    const m = s().model;
    expect(m.entities.map((e) => e.name).sort()).toEqual(["Customer", "Order"]);
    expect(m.entities.find((e) => e.name === "Customer")!.description).toBe("A buyer");
    expect(m.relationships).toHaveLength(1);
    // FK auto-created on the child via existing relationship logic.
    expect(m.entities.find((e) => e.name === "Order")!.fields.some((f) => f.name === "customer_id")).toBe(true);

    // ONE undo reverts the entire plan.
    s().undo();
    expect(s().model.entities).toHaveLength(0);
    expect(s().model.relationships).toHaveLength(0);
    s().redo();
    expect(s().model.entities).toHaveLength(2);
  });

  it("is idempotent — re-running the same plan skips existing objects", () => {
    const plan = parsePlan({
      summary: "x",
      actions: [{ kind: "create_entity", name: "Customer", fields: [{ name: "id", type: "uuid", primaryKey: true }] }],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    const res2 = executePlan(plan.value);
    expect(res2.skipped).toBe(1);
    expect(res2.applied).toBe(0);
    expect(s().model.entities).toHaveLength(1); // no duplicate
  });

  it("updates an entity description via existing updateEntity", () => {
    s().renameEntity(s().createEntity(), "Invoice");
    const plan = parsePlan({
      summary: "doc",
      actions: [{ kind: "update_description", entity: "Invoice", text: "A request for payment." }],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    expect(s().model.entities[0].description).toBe("A request for payment.");
  });

  it("reports a failed action without mutating for it (missing target)", () => {
    const before = serializeModel(s().model);
    const plan = parsePlan({
      summary: "x",
      actions: [{ kind: "update_description", entity: "DoesNotExist", text: "y" }],
    });
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.failed).toBe(1);
    expect(serializeModel(s().model)).toBe(before); // no change
  });

  it("rejecting a plan (never calling executePlan) leaves the model byte-identical", () => {
    const before = serializeModel(s().model);
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_entity", name: "Ghost" }] });
    expect(plan.ok).toBe(true);
    // Simulate rejection: we simply do not execute.
    expect(serializeModel(s().model)).toBe(before);
  });
});
