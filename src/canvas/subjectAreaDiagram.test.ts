import { describe, it, expect, beforeEach } from "vitest";
import { diagramEntityIds } from "./subjectAreaDiagram";
import { useModelStore } from "../store/modelStore";
import { newModel, newEntity } from "../model/model";
import type { Model } from "../model/model";

function modelWithArea(): { model: Model; areaId: string; aId: string; bId: string; cId: string } {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const a = newEntity("A", { x: 0, y: 0 });
  const b = newEntity("B", { x: 1, y: 0 });
  const c = newEntity("C", { x: 2, y: 0 });
  m.entities.push(a, b, c);
  m.subjectAreas = [{ id: "a_area1", name: "AB", entities: [a.id, b.id] }];
  return { model: m, areaId: "a_area1", aId: a.id, bId: b.id, cId: c.id };
}

describe("diagramEntityIds (subject-area diagrams)", () => {
  it("returns null (whole model) when no diagram is active", () => {
    const { model } = modelWithArea();
    expect(diagramEntityIds(model, null)).toBeNull();
  });

  it("returns only the area's members for a subject-area diagram", () => {
    const { model, areaId, aId, bId, cId } = modelWithArea();
    const ids = diagramEntityIds(model, areaId)!;
    expect(ids.has(aId)).toBe(true);
    expect(ids.has(bId)).toBe(true);
    expect(ids.has(cId)).toBe(false);
  });

  it("falls back to the whole model for an unknown or empty area (never blanks)", () => {
    const { model } = modelWithArea();
    expect(diagramEntityIds(model, "a_missing")).toBeNull();
    model.subjectAreas = [{ id: "a_empty", name: "E", entities: [] }];
    expect(diagramEntityIds(model, "a_empty")).toBeNull();
  });

  it("drops members that were deleted from the model", () => {
    const { model, areaId, aId } = modelWithArea();
    model.entities = model.entities.filter((e) => e.id === aId); // delete B
    const ids = diagramEntityIds(model, areaId)!;
    expect([...ids]).toEqual([aId]);
  });
});

describe("activeDiagram store state", () => {
  beforeEach(() => useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical")));

  it("sets and clears the active diagram", () => {
    useModelStore.getState().setActiveDiagram("a_x");
    expect(useModelStore.getState().activeDiagram).toBe("a_x");
    useModelStore.getState().setActiveDiagram(null);
    expect(useModelStore.getState().activeDiagram).toBeNull();
  });

  it("resets to the whole-model diagram on model load (tab switch)", () => {
    useModelStore.getState().setActiveDiagram("a_x");
    useModelStore.getState().loadModel(newModel("other", "2026-01-01T00:00:00Z", "Physical"));
    expect(useModelStore.getState().activeDiagram).toBeNull();
  });
});
