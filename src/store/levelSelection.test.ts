import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";

const s = () => useModelStore.getState();

describe("selection hygiene on level change (§5/§7)", () => {
  beforeEach(() => {
    useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
  });

  it("clears a physical-only selection when switching to a level that hides it", () => {
    const e = s().createEntity();
    const idx = s().createIndex(e)!;
    s().select({ kind: "index", id: idx });
    s().openProperties();
    expect(s().selection).toEqual({ kind: "index", id: idx });

    s().setModelLevel("Logical"); // Logical hides indexes
    expect(s().selection).toBeNull();
    expect(s().propertiesOpen).toBe(false);
  });

  it("keeps an entity selection across a level change (entities are visible everywhere)", () => {
    const e = s().createEntity();
    s().select({ kind: "entity", id: e });
    s().setModelLevel("Conceptual");
    expect(s().selection).toEqual({ kind: "entity", id: e });
    s().setModelLevel("Physical");
    expect(s().selection).toEqual({ kind: "entity", id: e });
  });

  it("keeps a physical-only selection when the target level still shows it", () => {
    const e = s().createEntity();
    const idx = s().createIndex(e)!;
    s().select({ kind: "index", id: idx });
    s().setModelLevel("Physical/Logical"); // still physical
    expect(s().selection).toEqual({ kind: "index", id: idx });
  });
});
