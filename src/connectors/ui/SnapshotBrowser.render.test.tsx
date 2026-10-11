// @vitest-environment jsdom
//
// Req 21/22 — the Source-snapshot browser surfaces the snapshot-only metadata that is
// NOT carried into the model: EBS application dictionary + Fusion API resources /
// extract data stores, plus source identity (release / API version).

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SnapshotView } from "./SnapshotBrowser";
import { ebsMockMetadata } from "../oracle/mockEbsConnector";
import { fusionMockMetadata } from "../fusion/mockFusionConnector";
import type { CanonicalMetadata } from "../metadata";
import type { SourceSnapshot } from "../snapshot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function snap(metadata: CanonicalMetadata): SourceSnapshot {
  return {
    snapshotVersion: 1,
    id: "s_1",
    connectionRef: "g_1",
    metadata,
    provenance: { connectorId: "mock", connectorVersion: "1", discoveredAt: "2026-01-01T00:00:00Z", schemasDiscovered: ["AP"], capabilitiesUsed: [] },
  };
}

function render(metadata: CanonicalMetadata) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SnapshotView snapshot={snap(metadata)} />));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SnapshotView", () => {
  it("shows EBS identity + application dictionary", () => {
    render(ebsMockMetadata());
    const t = container.textContent ?? "";
    expect(t).toContain("12.2.9"); // EBS release
    expect(t).toContain("EBS application dictionary");
    expect(t).toContain("Concurrent programs");
    expect(t).toContain("APXINWKB");
    expect(t).toContain("Lookups");
    expect(t).toContain("Program units");
    expect(t).toContain("AP_INVOICES_PKG");
  });

  it("shows Fusion API resources + extract data stores", () => {
    render(fusionMockMetadata());
    const t = container.textContent ?? "";
    expect(t).toContain("11.13.18.05"); // API version
    expect(t).toContain("Fusion Cloud metadata");
    expect(t).toContain("REST resources");
    expect(t).toContain("invoices");
    expect(t).toContain("Extract data stores");
    expect(t).toContain("ApInvoicesExtractPVO");
  });
});
