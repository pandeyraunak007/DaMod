// @vitest-environment jsdom
//
// Req 21 §4 — the EBS-aware Explorer view groups the active model's discovered tables
// by product / schema, shows counts, and reveals an entity on click. Read-only.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EbsExplorer } from "./EbsExplorer";
import { useModelStore } from "../store/modelStore";
import { ebsSnapshotToModel } from "../connectors/oracle/ebs";
import { ebsMockMetadata } from "../connectors/oracle/mockEbsConnector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const s = () => useModelStore.getState();

beforeEach(() => {
  const model = ebsSnapshotToModel(ebsMockMetadata(), "EBS", "2026-01-01T00:00:00Z").model;
  s().loadModel(model);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<EbsExplorer model={s().model} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function expandFirstProduct() {
  const caret = container.querySelector(".tree-row__caret") as HTMLButtonElement;
  act(() => caret.click());
}

describe("EbsExplorer", () => {
  it("shows product groups by default", () => {
    expect(container.textContent).toContain("Product AP");
    expect(container.textContent).toContain("Product GL");
  });

  it("switches to schema grouping", () => {
    const schemaBtn = [...container.querySelectorAll(".ebsx__seg-btn")].find((b) => b.textContent === "Schemas") as HTMLButtonElement;
    act(() => schemaBtn.click());
    // Schema groups render (AP/GL schema names) without the "Product " prefix.
    expect(container.textContent).not.toContain("Product AP");
    expect(container.textContent).toContain("AP");
  });

  it("reveals an entity (selects it) when a table row is clicked", () => {
    expandFirstProduct();
    const tableRow = [...container.querySelectorAll(".tree__entity")].find((r) => /AP_INVOICES_ALL|AP_INVOICE_LINES_ALL|AP_SUPPLIERS/.test(r.textContent ?? "")) as HTMLElement;
    act(() => tableRow.click());
    expect(s().selection?.kind).toBe("entity");
  });

  it("creates a subject area from a product and lists it", () => {
    const addBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "+ area") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    act(() => addBtn.click());
    expect(s().model.subjectAreas?.length).toBe(1);
    // The parent re-passes the updated model (ModelExplorer subscribes to the store).
    act(() => root.render(<EbsExplorer model={s().model} />));
    expect(container.textContent).toContain("Subject areas");
  });

  it("filters objects by the search box", () => {
    const input = container.querySelector(".explorer__filter") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(input, "SUPPLIERS");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("AP_SUPPLIERS");
    expect(container.textContent).not.toContain("GL_JE_HEADERS");
  });
});
