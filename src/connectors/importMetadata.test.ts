import { describe, it, expect } from "vitest";
import { parseMetadataFile, serializeMetadata } from "./snapshot";
import { ebsMockMetadata } from "./oracle/mockEbsConnector";
import { metadataToModelForSource } from "./oracle/ebs";

// Req 21 — the "imported-only" driver path: load an eTRM-derived / exported metadata
// package from a file, offline, with no Oracle driver or live connection.
describe("parseMetadataFile (offline import)", () => {
  it("accepts a valid canonical metadata package", () => {
    const text = serializeMetadata(ebsMockMetadata());
    const r = parseMetadataFile(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source.systemType).toBe("oracle-ebs");
  });

  it("rejects invalid JSON with a readable error", () => {
    const r = parseMetadataFile("{ not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("json");
  });

  it("refuses a file carrying a credential (no secrets in metadata)", () => {
    const poisoned = JSON.parse(serializeMetadata(ebsMockMetadata()));
    poisoned.source.password = "hunter2";
    const r = parseMetadataFile(JSON.stringify(poisoned));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("credential");
  });

  it("rejects metadata that does not match the contract", () => {
    const r = parseMetadataFile(JSON.stringify({ metadataVersion: 1, source: { systemType: "oracle-ebs" } }));
    expect(r.ok).toBe(false);
  });

  it("an imported EBS package reverse-engineers into a product-tagged model", () => {
    const text = serializeMetadata(ebsMockMetadata());
    const parsed = parseMetadataFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { model } = metadataToModelForSource(parsed.value, "imported_ebs", "2026-01-01T00:00:00Z");
    expect(model.entities.length).toBeGreaterThan(0);
    expect(model.entities.find((e) => e.name === "AP_INVOICES_ALL")?.tags).toContain("ebs:AP");
  });

  it("a non-EBS package uses the plain mapper (no ebs tags)", () => {
    const md = ebsMockMetadata();
    const asPg = { ...md, source: { ...md.source, systemType: "postgres" as const }, application: undefined };
    const { model } = metadataToModelForSource(asPg, "x", "2026-01-01T00:00:00Z");
    expect(model.entities.every((e) => !(e.tags ?? []).some((t) => t.startsWith("ebs:")))).toBe(true);
  });
});
