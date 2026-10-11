// Slice 2 — dependency-aware domain deletion. deleteDomainResolved must either
// detach bound fields (keep their current type) or reassign them to another domain
// (applying its type), as ONE undo step; the pending-request flag is transient.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";

const s = () => useModelStore.getState();

function fieldOf(entityId: string, fieldId: string) {
  return s().model.entities.find((e) => e.id === entityId)!.fields.find((f) => f.id === fieldId)!;
}

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
});

describe("domain delete request flag", () => {
  it("sets and clears the transient pending id", () => {
    const id = s().createDomain();
    s().requestDomainDelete(id);
    expect(s().domainDeletePending).toBe(id);
    s().cancelDomainDelete();
    expect(s().domainDeletePending).toBeNull();
  });
});

describe("deleteDomainResolved — detach", () => {
  it("removes the domain, unbinds fields, keeps their last type, as one undo step", () => {
    const money = s().createDomain();
    s().updateDomain(money, { name: "Money", type: "decimal", precision: 15, scale: 2 });
    const e = s().createEntity();
    const f = s().addField(e)!;
    s().bindFieldDomain(e, f, money);
    expect(fieldOf(e, f).type).toBe("decimal");

    s().requestDomainDelete(money);
    s().deleteDomainResolved(money, "detach");

    expect(s().domainDeletePending).toBeNull();
    expect(s().model.domains ?? []).toHaveLength(0);
    expect(fieldOf(e, f).domainId).toBeUndefined();
    expect(fieldOf(e, f).type).toBe("decimal"); // keeps last resolved type

    s().undo(); // one step restores both the domain and the binding
    expect(s().model.domains).toHaveLength(1);
    expect(fieldOf(e, f).domainId).toBe(money);
  });
});

describe("deleteDomainResolved — reassign", () => {
  it("rebinds dependents to the replacement domain and applies its type", () => {
    const money = s().createDomain();
    s().updateDomain(money, { name: "Money", type: "decimal", precision: 15, scale: 2 });
    const cents = s().createDomain();
    s().updateDomain(cents, { name: "Cents", type: "integer" });
    const e = s().createEntity();
    const f = s().addField(e)!;
    s().bindFieldDomain(e, f, money);

    s().deleteDomainResolved(money, "reassign", cents);

    expect((s().model.domains ?? []).map((d) => d.id)).toEqual([cents]);
    expect(fieldOf(e, f).domainId).toBe(cents);
    expect(fieldOf(e, f).type).toBe("integer"); // replacement type applied

    s().undo();
    expect(s().model.domains).toHaveLength(2);
    expect(fieldOf(e, f).domainId).toBe(money);
    expect(fieldOf(e, f).type).toBe("decimal");
  });
});
