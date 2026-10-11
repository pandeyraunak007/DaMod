import { describe, it, expect } from "vitest";
import { createMockConnector } from "./mock/mockConnector";
import { allObjects } from "./metadata";
import { metadataToModel } from "./toModel";
import { filterMetadataToTables, tableKey } from "./browseFilter";
import type { ConnectionProfile } from "./connection";

const NOW = "2026-01-01T00:00:00Z";
const profile: ConnectionProfile = { id: "g_t", name: "mock", systemType: "mock", params: { database: "demo" } };

describe("filterMetadataToTables (table-level reverse-engineering browse)", () => {
  it("keeps only the chosen objects and drops the rest", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const all = allObjects(metadata);
    expect(all.length).toBeGreaterThan(2);

    // Keep only Customer + OrderLine (drop Order, Product, the view, …).
    const keep = new Set(
      all
        .filter(({ object }) => object.name === "Customer" || object.name === "OrderLine")
        .map(({ schema, object }) => tableKey(schema, object.name)),
    );
    const filtered = filterMetadataToTables(metadata, keep);
    const kept = allObjects(filtered).map((o) => o.object.name).sort();
    expect(kept).toEqual(["Customer", "OrderLine"]);
  });

  it("downstream model drops entities not kept, and FKs to dropped parents are skipped (warned)", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const all = allObjects(metadata);
    const keep = new Set(
      all
        .filter(({ object }) => object.name === "Customer" || object.name === "OrderLine")
        .map(({ schema, object }) => tableKey(schema, object.name)),
    );
    const { model, warnings } = metadataToModel(filterMetadataToTables(metadata, keep), "imported", NOW);

    const names = model.entities.map((e) => e.name).sort();
    expect(names).toEqual(["Customer", "OrderLine"]);
    // OrderLine references Order/Product which were excluded → those FKs are skipped, not errors.
    expect(warnings.some((w) => /not in the import; skipped/.test(w))).toBe(true);
    // No relationship points at a missing entity.
    const ids = new Set(model.entities.map((e) => e.id));
    expect(model.relationships.every((r) => ids.has(r.parentEntity) && ids.has(r.childEntity))).toBe(true);
  });

  it("empty keep set yields an empty model", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const filtered = filterMetadataToTables(metadata, new Set());
    expect(allObjects(filtered)).toHaveLength(0);
    const { model } = metadataToModel(filtered, "imported", NOW);
    expect(model.entities).toHaveLength(0);
  });
});
