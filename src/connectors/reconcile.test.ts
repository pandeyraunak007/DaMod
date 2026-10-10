import { describe, it, expect } from "vitest";
import { ebsSnapshotToModel } from "./oracle/ebs";
import { ebsMockMetadata } from "./oracle/mockEbsConnector";
import { reconcileDiscoveredModel } from "./reconcile";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import type { Model } from "../model/model";

const NOW = "2026-01-01T00:00:00Z";
const discover = (): Model => ebsSnapshotToModel(ebsMockMetadata(), "EBS", NOW).model;

describe("discovery provenance (Req 21 Phase 2)", () => {
  it("stamps a stable source identifier + product on discovered entities", () => {
    const m = discover();
    const inv = m.entities.find((e) => e.name === "AP_INVOICES_ALL")!;
    expect(inv.source?.nativeId).toBe("AP.AP_INVOICES_ALL");
    expect(inv.source?.system).toBe("oracle-ebs");
    expect(inv.source?.product).toBe("AP");
  });

  it("round-trips the source block byte-identically", () => {
    const once = serializeModel(discover());
    expect(once).toContain('"nativeId": "AP.AP_INVOICES_ALL"');
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);
  });
});

describe("idempotent re-discovery (Req 21 §6/§11, AC-6)", () => {
  it("re-discovering an unchanged snapshot updates in place (no duplicate entities, stable ids)", () => {
    const first = discover();
    const fresh = discover(); // fresh ids, same structure
    const { model, added, updated, removed } = reconcileDiscoveredModel(first, fresh);
    expect(model.entities).toHaveLength(first.entities.length); // no duplicates
    expect(added).toHaveLength(0);
    expect(removed).toHaveLength(0);
    expect(updated.sort()).toEqual(first.entities.map((e) => e.name).sort());
    // Stable ids preserved (matched by source.nativeId, not regenerated).
    for (const e of first.entities) {
      const r = model.entities.find((x) => x.source?.nativeId === e.source?.nativeId)!;
      expect(r.id).toBe(e.id);
    }
  });

  it("preserves manual edits across a refresh", () => {
    const existing = discover();
    const inv = existing.entities.find((e) => e.name === "AP_INVOICES_ALL")!;
    inv.logicalName = "Supplier Invoice"; // manual business name
    inv.description = "Hand-written note"; // manual override
    inv.position = { x: 999, y: 777 }; // manual layout
    inv.tags = [...(inv.tags ?? []), "reviewed"]; // manual tag

    const { model } = reconcileDiscoveredModel(existing, discover());
    const r = model.entities.find((e) => e.source?.nativeId === "AP.AP_INVOICES_ALL")!;
    expect(r.logicalName).toBe("Supplier Invoice");
    expect(r.description).toBe("Hand-written note");
    expect(r.position).toEqual({ x: 999, y: 777 });
    expect(r.tags).toContain("reviewed");
    expect(r.tags).toContain("ebs:AP"); // discovered tag still present
  });

  it("reports an added table and keeps structure valid", () => {
    const existing = discover();
    // Drop a table from the existing side so the fresh discovery looks like an add.
    existing.entities = existing.entities.filter((e) => e.name !== "GL_JE_HEADERS");
    const { model, added } = reconcileDiscoveredModel(existing, discover());
    expect(added).toContain("GL_JE_HEADERS");
    expect(model.entities.some((e) => e.name === "GL_JE_HEADERS")).toBe(true);
    const parsed = parseModelFile(serializeModel(model));
    expect(parsed.ok).toBe(true);
  });

  it("reports a removed table but keeps it pending review (does not delete)", () => {
    const existing = discover();
    // Fresh discovery missing one table.
    const fresh = discover();
    fresh.entities = fresh.entities.filter((e) => e.name !== "GL_JE_HEADERS");
    fresh.relationships = []; // (none touched it anyway)
    const { model, removed } = reconcileDiscoveredModel(existing, fresh);
    expect(removed).toContain("GL_JE_HEADERS");
    expect(model.entities.some((e) => e.name === "GL_JE_HEADERS")).toBe(true); // kept
  });
});
