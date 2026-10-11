// @vitest-environment jsdom
//
// Slice 1 — Domains discoverable & bindable. The docked SidePanel must offer a
// domain selector when editing a physical field (parity with the modal inspector),
// and a DomainEditor when a domain is selected. Also covers the shared DomainSelect.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SidePanel } from "./SidePanel";
import { DomainSelect } from "./DomainSelect";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function seedEntityWithField(): { entityId: string; fieldId: string } {
  const s = useModelStore.getState();
  const entityId = s.createEntity();
  const fieldId = s.addField(entityId)!;
  s.updateField(entityId, fieldId, { name: "amount", type: "integer" });
  return { entityId, fieldId };
}

describe("SidePanel domain binding (Slice 1)", () => {
  it("shows a domain selector on a physical field when the model has a domain", () => {
    const { entityId } = seedEntityWithField();
    const domainId = useModelStore.getState().createDomain();
    useModelStore.getState().updateDomain(domainId, { name: "Money", type: "decimal", precision: 15, scale: 2 });
    useModelStore.getState().select({ kind: "entity", id: entityId });

    act(() => root.render(<SidePanel onCollapse={() => {}} />));
    // A <select> offering the domain by name must be present.
    const selects = [...container.querySelectorAll("select")];
    const domainSelect = selects.find((sel) => [...sel.options].some((o) => o.value === domainId));
    expect(domainSelect).toBeTruthy();
    expect([...domainSelect!.options].some((o) => o.textContent === "Money")).toBe(true);
  });

  it("binds the domain and applies its type when chosen", () => {
    const { entityId, fieldId } = seedEntityWithField();
    const domainId = useModelStore.getState().createDomain();
    useModelStore.getState().updateDomain(domainId, { name: "Money", type: "decimal", precision: 15, scale: 2 });
    useModelStore.getState().select({ kind: "entity", id: entityId });
    act(() => root.render(<SidePanel onCollapse={() => {}} />));

    const selects = [...container.querySelectorAll("select")];
    const domainSelect = selects.find((sel) => [...sel.options].some((o) => o.value === domainId))!;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      nativeSetter.call(domainSelect, domainId);
      domainSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const field = useModelStore.getState().model.entities.find((e) => e.id === entityId)!.fields.find((f) => f.id === fieldId)!;
    expect(field.domainId).toBe(domainId);
    expect(field.type).toBe("decimal");
    expect(field.precision).toBe(15);
  });

  it("renders a DomainEditor (with delete) when a domain is selected", () => {
    const domainId = useModelStore.getState().createDomain();
    useModelStore.getState().updateDomain(domainId, { name: "Money", type: "decimal" });
    useModelStore.getState().select({ kind: "domain", id: domainId });
    act(() => root.render(<SidePanel onCollapse={() => {}} />));
    expect(container.textContent).toContain("Domain");
    expect(container.textContent).toContain("Delete domain");
  });
});

describe("DomainSelect helper", () => {
  it("lists a none option plus each domain, and reports id / null on change", () => {
    const calls: (string | null)[] = [];
    const domains = [
      { id: "n_1", name: "Money", type: "decimal" as const },
      { id: "n_2", name: "Email", type: "string" as const },
    ];
    act(() => root.render(<DomainSelect domains={domains} value={undefined} onChange={(v) => calls.push(v)} />));
    const sel = container.querySelector("select")!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["— none (free type) —", "Money", "Email"]);

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      nativeSetter.call(sel, "n_2");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      nativeSetter.call(sel, "");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls).toEqual(["n_2", null]);
  });
});
