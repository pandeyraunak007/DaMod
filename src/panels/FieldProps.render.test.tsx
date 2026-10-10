// @vitest-environment jsdom
//
// §4/§7: the field editor in the Properties dialog must be level-aware —
// Conceptual shows business meaning only (no physical type/keys/default), while
// Physical shows the full column editor. Hidden controls must not delete data.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PropertiesDialog } from "./PropertiesDialog";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";
import type { ModelLevel } from "../model/levels";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mountAt(level: ModelLevel): HTMLDivElement {
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", level));
  const e = useModelStore.getState().createEntity();
  const f = useModelStore.getState().addField(e)!;
  // Give the field a physical type + default so there is real data to preserve.
  useModelStore.getState().updateField(e, f, { type: "decimal", precision: 12, scale: 2, default: "0", primaryKey: true });
  useModelStore.getState().select({ kind: "entity", id: e });
  useModelStore.getState().openProperties();
  act(() => root.render(<PropertiesDialog onClose={() => {}} />));
  // Open the Fields/Columns/Attributes tab, then expand the field.
  const tabBtns = [...container.querySelectorAll("button.tab-btn")] as HTMLButtonElement[];
  const fieldsTab = tabBtns.find((b) => /Fields|Columns|Attributes/.test(b.textContent ?? ""));
  act(() => fieldsTab?.click());
  return container;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("level-aware field editor", () => {
  it("hides the physical type select and SQL default at Conceptual", () => {
    mountAt("Conceptual");
    expect(container.textContent).not.toContain("Default (SQL)");
    // No physical data-type option like "decimal" is offered at Conceptual.
    const options = [...container.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).not.toContain("decimal");
  });

  it("shows the full physical editor at Physical", () => {
    mountAt("Physical");
    expect(container.textContent).toContain("Default (SQL)");
    const options = [...container.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("decimal"); // physical type dropdown present
  });

  it("preserves the hidden physical type in the model at Conceptual (not deleted)", () => {
    mountAt("Conceptual");
    const field = useModelStore.getState().model.entities[0].fields[0];
    // Lowering to Conceptual hides the type in the UI but keeps it on the field.
    expect(field.type).toBe("decimal");
    expect(field.default).toBe("0");
  });
});
