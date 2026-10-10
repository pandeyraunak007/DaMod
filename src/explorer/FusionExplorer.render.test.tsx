// @vitest-environment jsdom
//
// Req 22 §4 — the Fusion-aware Explorer view groups the active model's discovered
// business objects by application family / module, with counts and click-to-reveal.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FusionExplorer } from "./EbsExplorer";
import { hasFusionContent, ebsGroups } from "./ebsTree";
import { useModelStore } from "../store/modelStore";
import { fusionSnapshotToModel } from "../connectors/fusion/fusion";
import { fusionMockMetadata } from "../connectors/fusion/mockFusionConnector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const s = () => useModelStore.getState();
const fusionModel = () => fusionSnapshotToModel(fusionMockMetadata(), "Fusion", "2026-01-01T00:00:00Z").model;

beforeEach(() => {
  s().loadModel(fusionModel());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<FusionExplorer model={s().model} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("hasFusionContent + grouping", () => {
  it("detects Fusion provenance and groups by family", () => {
    expect(hasFusionContent(fusionModel())).toBe(true);
    const groups = ebsGroups(fusionModel(), "product"); // product slot = family
    expect(groups.map((g) => g.key)).toEqual(["Financials"]);
    expect(groups[0].entities.length).toBe(3);
  });
});

describe("FusionExplorer view", () => {
  it("labels the primary grouping as Families and shows the family group", () => {
    expect(container.textContent).toContain("Families");
    expect(container.textContent).toContain("Family Financials");
  });

  it("switches to Modules grouping", () => {
    const modulesBtn = [...container.querySelectorAll(".ebsx__seg-btn")].find((b) => b.textContent === "Modules") as HTMLButtonElement;
    expect(modulesBtn).toBeTruthy();
    act(() => modulesBtn.click());
    expect(container.textContent).not.toContain("Family Financials");
  });

  it("reveals a business object on click", () => {
    const caret = container.querySelector(".tree-row__caret") as HTMLButtonElement;
    act(() => caret.click()); // expand the family group
    const row = [...container.querySelectorAll(".tree__entity")].find((r) => /InvoiceHeader|Supplier|InvoiceLine/.test(r.textContent ?? "")) as HTMLElement;
    act(() => row.click());
    expect(s().selection?.kind).toBe("entity");
  });
});
