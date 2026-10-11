import { describe, it, expect } from "vitest";
import { mapFusionType } from "./fusionTypes";
import { createMockFusionConnector, fusionMockMetadata } from "./mockFusionConnector";
import { fusionSnapshotToModel, fusionApiSummary, fusionAnnotation } from "./fusion";
import { parseMetadata, allObjects } from "../metadata";
import { serializeMetadata } from "../snapshot";
import { computeDrift } from "../drift";
import { getConnector } from "../registry";
import { serializeModel } from "../../persist/serialize";
import { parseModelFile } from "../../persist/schema";
import type { ConnectionProfile } from "../connection";

const NOW = "2026-01-01T00:00:00Z";
const profile: ConnectionProfile = { id: "p1", name: "f", systemType: "oracle-fusion", params: { baseUrl: "https://x.fa.ocs.oraclecloud.com" } };

describe("Fusion type mapping (Req 22 §5)", () => {
  it("maps Fusion REST attribute types to the canonical set", () => {
    expect(mapFusionType("string")).toEqual({ type: "string", length: 255 });
    expect(mapFusionType("long")).toEqual({ type: "bigint" });
    expect(mapFusionType("integer")).toEqual({ type: "integer" });
    expect(mapFusionType("number")).toEqual({ type: "decimal", precision: 38, scale: 6 });
    expect(mapFusionType("boolean")).toEqual({ type: "boolean" });
    expect(mapFusionType("date")).toEqual({ type: "date" });
    expect(mapFusionType("date-time")).toEqual({ type: "timestamp" });
  });
  it("returns undefined for unmappable types (preserve native)", () => {
    expect(mapFusionType("binary")).toBeUndefined();
    expect(mapFusionType("attachment")).toBeUndefined();
  });
});

describe("mock Fusion connector (Req 22 §2/§3)", () => {
  it("is resolvable from the registry", () => {
    expect(getConnector("oracle-fusion")?.systemType).toBe("oracle-fusion");
  });
  it("reports the REST API version on test", async () => {
    const r = await createMockFusionConnector().testConnection(profile);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("REST API 11.13.18.05");
  });
  it("fails without an instance URL", async () => {
    const r = await createMockFusionConnector().testConnection({ ...profile, params: {} });
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain("baseurl");
  });
  it("discovers valid canonical metadata with API version + fusion block", async () => {
    const { metadata } = await createMockFusionConnector().discover(profile);
    expect(parseMetadata(metadata).ok).toBe(true);
    expect(metadata.source.apiVersion).toBe("11.13.18.05");
    const sum = fusionApiSummary(metadata);
    expect(sum.apiResources).toBe(2);
    expect(sum.extractDataStores).toBe(1);
  });
  it("records documented (non-DB-FK) relationship provenance", () => {
    const inv = allObjects(fusionMockMetadata()).find((o) => o.object.name === "InvoiceHeader")!.object;
    expect(inv.foreignKeys[0].provenance).toBe("fusion-metadata");
  });
});

describe("Fusion reverse-engineering → model (Req 22 §6)", () => {
  it("builds entities with family tags, parent-child relationships and composite keys", () => {
    const { model, families, warnings } = fusionSnapshotToModel(fusionMockMetadata(), "Fusion Financials", NOW);
    expect(model.entities.map((e) => e.name).sort()).toEqual(["InvoiceHeader", "InvoiceLine", "Supplier"]);
    const inv = model.entities.find((e) => e.name === "InvoiceHeader")!;
    expect(inv.tags).toContain("fusion:Financials");
    expect(inv.source?.product).toBe("Financials");
    expect(inv.source?.schema).toBe("Payables");
    expect(inv.source?.apiPath).toContain("/invoices");
    expect(inv.source?.apiVersion).toBe("11.13.18.05");
    // Nested child → composite PK + relationship to the header.
    const line = model.entities.find((e) => e.name === "InvoiceLine")!;
    expect(line.fields.filter((f) => f.primaryKey).map((f) => f.name)).toEqual(["InvoiceId", "LineNumber"]);
    expect(model.relationships.length).toBeGreaterThanOrEqual(2);
    // Unmappable binary attribute → text fallback with a warning.
    expect(inv.fields.find((f) => f.name === "Attachment")?.type).toBe("text");
    expect(warnings.some((w) => w.includes("Attachment"))).toBe(true);
    expect(families.map((f) => f.name)).toEqual(["Financials"]);
  });

  it("round-trips the produced model and the snapshot metadata byte-identically", () => {
    const { model } = fusionSnapshotToModel(fusionMockMetadata(), "F", NOW);
    const once = serializeModel(model);
    const p = parseModelFile(once);
    expect(p.ok).toBe(true);
    if (p.ok) expect(serializeModel(p.value)).toBe(once);

    const md = serializeMetadata(fusionMockMetadata());
    expect(md).toContain('"apiVersion": "11.13.18.05"');
    expect(md).toContain('"apiResources"');
    const pm = parseMetadata(JSON.parse(md));
    expect(pm.ok).toBe(true);
    if (pm.ok) expect(serializeMetadata(pm.value)).toBe(md);
  });

  it("re-discovering an unchanged snapshot produces no drift (no duplicates)", () => {
    expect(computeDrift(fusionMockMetadata(), fusionMockMetadata(), NOW).changes).toHaveLength(0);
  });

  it("exposes verified Fusion annotations", () => {
    const obj = allObjects(fusionMockMetadata()).find((o) => o.object.name === "Supplier")!.object;
    const a = fusionAnnotation(obj)!;
    expect(a.family).toBe("Financials");
    expect(a.verified).toBe(true);
    expect(a.apiPath).toContain("/suppliers");
  });
});
