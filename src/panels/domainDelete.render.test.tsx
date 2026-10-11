// @vitest-environment jsdom
//
// Slice 2 — the dependency-aware delete dialog. When a domain with bound columns is
// requested for deletion, the dialog lists the affected columns and requires an
// explicit detach/reassign choice; it renders nothing when no delete is pending.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DomainDeleteDialog } from "./DomainDeleteDialog";
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

function seedBoundField(): { domainId: string; entityId: string; fieldId: string } {
  const s = useModelStore.getState();
  const domainId = s.createDomain();
  s.updateDomain(domainId, { name: "Money", type: "decimal", precision: 15, scale: 2 });
  const entityId = s.createEntity();
  s.renameEntity(entityId, "Invoice");
  const fieldId = s.addField(entityId)!;
  s.updateField(entityId, fieldId, { name: "amount" });
  s.bindFieldDomain(entityId, fieldId, domainId);
  return { domainId, entityId, fieldId };
}

describe("DomainDeleteDialog (Slice 2)", () => {
  it("renders nothing when no delete is pending", () => {
    act(() => root.render(<DomainDeleteDialog />));
    expect(container.textContent).toBe("");
  });

  it("lists affected columns and confirming reassign rebinds + applies the new type", () => {
    const { domainId, entityId, fieldId } = seedBoundField();
    const cents = useModelStore.getState().createDomain();
    useModelStore.getState().updateDomain(cents, { name: "Cents", type: "integer" });
    useModelStore.getState().requestDomainDelete(domainId);

    act(() => root.render(<DomainDeleteDialog />));
    expect(container.textContent).toContain("Invoice.amount");
    expect(container.textContent).toContain("Reassign to another domain");

    // Choose reassign, then confirm.
    const reassign = [...container.querySelectorAll('input[type="radio"]')][1] as HTMLInputElement;
    act(() => reassign.click());
    const del = [...container.querySelectorAll("button")].find((b) => b.textContent === "Delete domain")!;
    act(() => del.dispatchEvent(new Event("click", { bubbles: true })));

    const field = useModelStore.getState().model.entities.find((e) => e.id === entityId)!.fields.find((f) => f.id === fieldId)!;
    expect(field.domainId).toBe(cents);
    expect(field.type).toBe("integer");
    expect(useModelStore.getState().domainDeletePending).toBeNull();
  });

  it("detach (default) unbinds and keeps the current type", () => {
    const { domainId, entityId, fieldId } = seedBoundField();
    useModelStore.getState().requestDomainDelete(domainId);
    act(() => root.render(<DomainDeleteDialog />));
    const del = [...container.querySelectorAll("button")].find((b) => b.textContent === "Delete domain")!;
    act(() => del.dispatchEvent(new Event("click", { bubbles: true })));

    const field = useModelStore.getState().model.entities.find((e) => e.id === entityId)!.fields.find((f) => f.id === fieldId)!;
    expect(field.domainId).toBeUndefined();
    expect(field.type).toBe("decimal");
    expect(useModelStore.getState().model.domains ?? []).toHaveLength(0);
  });
});
