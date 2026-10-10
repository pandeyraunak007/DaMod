// @vitest-environment jsdom
//
// Req 17 — the New Model dialog reveals a required database selector for physical
// levels, hides it for database-independent levels, keeps the selection across
// level changes, and passes the chosen dialect to newModel.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewModelDialog } from "./NewModelDialog";
import { useWorkspaceStore } from "../store/workspaceStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let newModelSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  newModelSpy = vi.fn(async () => null);
  // A workspace is already open so the folder picker is out of the way.
  useWorkspaceStore.setState({ path: "/tmp/ws", newModel: newModelSpy as never });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<NewModelDialog onClose={() => {}} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function pickLevel(label: string) {
  const card = [...container.querySelectorAll("button.level-card")].find(
    (b) => b.querySelector(".level-card__name")?.textContent === label,
  ) as HTMLButtonElement;
  act(() => card.click());
}
function dbSelect() {
  return container.querySelector("#new-model-db") as HTMLSelectElement | null;
}
function setName(v: string) {
  const input = container.querySelector(".field input") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function createBtn() {
  return [...container.querySelectorAll("button")].find((b) => /Create model/.test(b.textContent ?? "")) as HTMLButtonElement;
}

describe("NewModelDialog database selector (Req 17)", () => {
  it("shows the selector for Physical (default) and Physical/Logical", () => {
    expect(dbSelect()).not.toBeNull(); // default level is Physical
    pickLevel("Physical/Logical");
    expect(dbSelect()).not.toBeNull();
  });

  it("hides the selector for Conceptual and Logical", () => {
    pickLevel("Conceptual");
    expect(dbSelect()).toBeNull();
    pickLevel("Logical");
    expect(dbSelect()).toBeNull();
  });

  it("keeps the chosen database across a level change away and back", () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      const sel = dbSelect()!;
      setValue.call(sel, "snowflake");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    pickLevel("Logical"); // selector hidden, selection must not be discarded
    pickLevel("Physical");
    expect(dbSelect()!.value).toBe("snowflake");
  });

  it("passes the chosen dialect to newModel for a physical model", () => {
    setName("orders");
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      const sel = dbSelect()!;
      setValue.call(sel, "databricks");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => createBtn().click());
    expect(newModelSpy).toHaveBeenCalledWith("orders", "Physical", "databricks");
  });

  it("passes no dialect for a database-independent model", () => {
    pickLevel("Logical");
    setName("concepts");
    act(() => createBtn().click());
    expect(newModelSpy).toHaveBeenCalledWith("concepts", "Logical", undefined);
  });

  it("disables Create until a name is entered", () => {
    expect(createBtn().disabled).toBe(true);
    setName("orders");
    expect(createBtn().disabled).toBe(false);
  });
});
