// @vitest-environment jsdom
//
// §2.2: the compact column grid edits inline through the existing domain ops,
// supports add/delete, and expands a detail editor on demand.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PropertiesDialog } from "./PropertiesDialog";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const s = () => useModelStore.getState();

function openColumnsTab() {
  const tab = [...container.querySelectorAll("button.tab-btn")].find((b) => /Columns/.test(b.textContent ?? "")) as HTMLButtonElement;
  act(() => tab?.click());
}

beforeEach(() => {
  s().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
  const e = s().createEntity();
  s().renameEntity(e, "Customer");
  const f = s().addField(e)!;
  s().updateField(e, f, { name: "id", type: "uuid", primaryKey: true });
  s().select({ kind: "entity", id: e });
  s().openProperties();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PropertiesDialog onClose={() => {}} />));
  openColumnsTab();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function entity() {
  return s().model.entities[0];
}

describe("ColumnGrid interactions", () => {
  it("edits a column name inline via updateField", () => {
    const nameInput = container.querySelector(".colgrid__name input") as HTMLInputElement;
    expect(nameInput.value).toBe("id");
    // Use React's tracked value setter so onChange fires on an uncontrolled input.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(nameInput, "customer_id");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(entity().fields[0].name).toBe("customer_id");
  });

  it("toggles NOT NULL / unique via the row checkboxes", () => {
    const boxes = [...container.querySelectorAll(".colgrid__chk input")] as HTMLInputElement[];
    // order: PK, NN, U — toggle Unique (index 2).
    act(() => boxes[2].click());
    expect(entity().fields[0].unique).toBe(true);
  });

  it("adds a column with the + button and deletes one with ✕", () => {
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("+ ")) as HTMLButtonElement;
    act(() => add.click());
    expect(entity().fields.length).toBe(2);
    const del = container.querySelector(".colgrid__act--del") as HTMLButtonElement;
    act(() => del.click());
    expect(entity().fields.length).toBe(1);
  });

  it("expands the detail editor (Definition) on demand", () => {
    expect(container.textContent).not.toContain("Logical / business name");
    const details = [...container.querySelectorAll(".colgrid__act")].find((b) => b.textContent === "⋯") as HTMLButtonElement;
    act(() => details.click());
    expect(container.textContent).toContain("Logical / business name");
    expect(container.textContent).toContain("Definition");
  });
});
