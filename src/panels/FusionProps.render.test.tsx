// @vitest-environment jsdom
//
// Req 22 §7 — a Fusion business object's Properties Inspector shows a Fusion-specific
// source panel (Application family / Module / Business object / API path / API version),
// read-only, rather than the generic "Discovery source" labels.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PropertiesDialog } from "./PropertiesDialog";
import { useModelStore } from "../store/modelStore";
import { fusionSnapshotToModel } from "../connectors/fusion/fusion";
import { fusionMockMetadata } from "../connectors/fusion/mockFusionConnector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const s = () => useModelStore.getState();

beforeEach(() => {
  s().loadModel(fusionSnapshotToModel(fusionMockMetadata(), "Fusion", "2026-01-01T00:00:00Z").model);
  const inv = s().model.entities.find((e) => e.name === "InvoiceHeader")!;
  s().select({ kind: "entity", id: inv.id });
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

describe("Fusion-aware Properties panel", () => {
  it("shows Fusion source labels + API metadata (not generic/EBS labels)", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("Fusion Cloud source");
    expect(text).toContain("Application family");
    expect(text).toContain("Financials");
    expect(text).toContain("Module");
    expect(text).toContain("Business object");
    expect(text).toContain("API path");
    expect(text).toContain("API version");
    expect(text).toContain("11.13.18.05");
    // Not the EBS/generic label.
    expect(text).not.toContain("EBS product");
    expect(text).not.toContain("Discovery source");
  });
});
