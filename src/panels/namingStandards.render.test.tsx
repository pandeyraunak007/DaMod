// @vitest-environment jsdom
//
// Phase 2 Slice C — the Naming Standards manager. The preview is read-only; the
// model is only renamed when Apply is clicked.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NamingStandardsDialog } from "./NamingStandardsDialog";
import { useModelStore } from "../store/modelStore";
import { newModel, newEntity, newField } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const e = newEntity("CustomerOrder", { x: 0, y: 0 });
  e.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
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

describe("NamingStandardsDialog (Slice C)", () => {
  it("shows a live preview without mutating, and applies only on click", () => {
    const id = useModelStore.getState().createNamingStandard();
    useModelStore.getState().updateNamingStandard(id, {
      rules: [
        { target: "entity", case: "snake_case" },
        { target: "attribute", case: "snake_case" },
      ],
    });

    act(() => root.render(<NamingStandardsDialog onClose={() => {}} />));

    // Preview visible; model NOT yet mutated.
    expect(container.textContent).toContain("CustomerOrder → customer_order");
    expect(container.textContent).toContain("OrderID → order_id");
    expect(useModelStore.getState().model.entities[0].name).toBe("CustomerOrder");

    // Apply.
    const applyBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Apply to model")!;
    act(() => applyBtn.dispatchEvent(new Event("click", { bubbles: true })));

    const m = useModelStore.getState().model;
    expect(m.entities[0].name).toBe("customer_order");
    expect(m.entities[0].fields[0].name).toBe("order_id");
  });

  it("mounts cleanly on a model with no standards", () => {
    expect(() => act(() => root.render(<NamingStandardsDialog onClose={() => {}} />))).not.toThrow();
    expect(container.textContent).toContain("No naming standards yet");
  });
});
