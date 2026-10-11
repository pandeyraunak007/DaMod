// @vitest-environment jsdom
//
// Phase 3 Slice B — the Data Type Standards manager. Preview is read-only; params
// are only normalised on Apply. Lossy warnings surface for the model's dialect.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TypeStandardsDialog } from "./TypeStandardsDialog";
import { useModelStore } from "../store/modelStore";
import { newModel, newEntity, newField } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical", "snowflake");
  const e = newEntity("T", { x: 0, y: 0 });
  e.fields.push(newField("amount", "decimal", { precision: 12, scale: 2 }));
  e.fields.push(newField("ref", "uuid")); // lossy on Snowflake
  m.entities.push(e);
  useModelStore.getState().loadModel(m);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("TypeStandardsDialog (Slice B)", () => {
  it("previews param changes + lossy warnings without mutating, applies on click", () => {
    const id = useModelStore.getState().createTypeStandard();
    useModelStore.getState().updateTypeStandard(id, { rules: [{ type: "decimal", precision: 18, scale: 4 }] });

    act(() => root.render(<TypeStandardsDialog onClose={() => {}} />));

    expect(container.textContent).toContain("decimal(12,2) → decimal(18,4)");
    expect(container.textContent).toContain("Lossy mappings");
    expect(container.textContent).toContain("ref"); // uuid lossy on snowflake
    // Not mutated yet.
    expect(useModelStore.getState().model.entities[0].fields[0].precision).toBe(12);

    const applyBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Apply to model")!;
    act(() => applyBtn.dispatchEvent(new Event("click", { bubbles: true })));

    expect(useModelStore.getState().model.entities[0].fields[0].precision).toBe(18);
    expect(useModelStore.getState().model.entities[0].fields[0].scale).toBe(4);
  });

  it("mounts cleanly with no standards", () => {
    expect(() => act(() => root.render(<TypeStandardsDialog onClose={() => {}} />))).not.toThrow();
    expect(container.textContent).toContain("No type standards yet");
  });
});
