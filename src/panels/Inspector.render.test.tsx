// @vitest-environment jsdom
//
// §13.6 acceptance: the Properties Inspector adapts its tabs/fields to the active
// level WITHOUT reselecting (it reads the shared model level reactively), DDL is
// unavailable at Conceptual/Logical, and hidden physical metadata is preserved.

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
const s = () => useModelStore.getState();

function tabLabels(): string[] {
  return [...container.querySelectorAll("button.tab-btn")].map((b) => b.textContent ?? "");
}

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
  const e = s().createEntity();
  s().renameEntity(e, "Customer");
  const f = s().addField(e)!;
  s().updateField(e, f, { name: "total", type: "decimal", precision: 12, scale: 2, primaryKey: true });
  s().select({ kind: "entity", id: e });
  s().openProperties();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PropertiesDialog onClose={() => {}} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function setLevel(level: ModelLevel) {
  act(() => { s().setModelLevel(level); });
}

describe("level-aware Properties Inspector", () => {
  it("Physical: Table terminology + a SQL (DDL) tab", () => {
    expect(container.textContent).toContain("Table: Customer");
    expect(tabLabels()).toContain("Columns");
    expect(tabLabels()).toContain("SQL");
  });

  it("switching to Logical updates live: Entity/Attributes, NO SQL tab (DDL unavailable)", () => {
    setLevel("Logical");
    expect(container.textContent).toContain("Entity: Customer");
    expect(tabLabels()).toContain("Attributes");
    expect(tabLabels()).not.toContain("SQL");
  });

  it("switching to Conceptual hides keys/types + SQL; terminology is Business Entity", () => {
    setLevel("Conceptual");
    expect(container.textContent).toContain("Business Entity: Customer");
    expect(tabLabels()).not.toContain("SQL");
  });

  it("round-trips back to Physical with hidden physical metadata intact", () => {
    setLevel("Conceptual");
    setLevel("Physical");
    // The decimal type survived being hidden at Conceptual.
    expect(s().model.entities[0].fields.find((f) => f.name === "total")!.type).toBe("decimal");
    expect(tabLabels()).toContain("SQL");
  });
});
