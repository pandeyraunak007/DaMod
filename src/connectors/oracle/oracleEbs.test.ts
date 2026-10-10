import { describe, it, expect } from "vitest";
import { mapOracleType } from "./oracleTypes";
import { createMockEbsConnector, ebsMockMetadata } from "./mockEbsConnector";
import { ebsSnapshotToModel, ebsAnnotation, ebsApplicationSummary } from "./ebs";
import { parseMetadata, allObjects } from "../metadata";
import { serializeMetadata } from "../snapshot";
import { computeDrift } from "../drift";
import { getConnector } from "../registry";
import { serializeModel } from "../../persist/serialize";
import { parseModelFile } from "../../persist/schema";
import type { ConnectionProfile } from "../connection";

const NOW = "2026-01-01T00:00:00Z";
const profile: ConnectionProfile = { id: "p1", name: "VIS", systemType: "oracle-ebs", params: { database: "VIS" } };

describe("Oracle type mapping (Req 21 §4)", () => {
  it("maps Oracle spellings to the canonical type set", () => {
    expect(mapOracleType("VARCHAR2(240)")).toEqual({ type: "string", length: 240 });
    expect(mapOracleType("CHAR(1)")).toEqual({ type: "string", length: 1 });
    expect(mapOracleType("CLOB")).toEqual({ type: "text" });
    expect(mapOracleType("NUMBER(15,2)")).toEqual({ type: "decimal", precision: 15, scale: 2 });
    expect(mapOracleType("NUMBER(9)")).toEqual({ type: "integer" });
    expect(mapOracleType("NUMBER(15)")).toEqual({ type: "bigint" });
    expect(mapOracleType("NUMBER")).toEqual({ type: "decimal", precision: 38, scale: 0 });
    expect(mapOracleType("DATE")).toEqual({ type: "timestamp" });
    expect(mapOracleType("TIMESTAMP(6)")).toEqual({ type: "timestamp" });
  });
  it("returns undefined for types with no faithful mapping (preserve native)", () => {
    expect(mapOracleType("BLOB")).toBeUndefined();
    expect(mapOracleType("RAW(16)")).toBeUndefined();
    expect(mapOracleType("SDO_GEOMETRY")).toBeUndefined();
  });
});

describe("mock EBS connector (Req 21 §3)", () => {
  it("is resolvable from the registry", () => {
    expect(getConnector("oracle-ebs")?.systemType).toBe("oracle-ebs");
  });

  it("reports EBS release separately from the Oracle DB version", async () => {
    const c = createMockEbsConnector();
    const r = await c.testConnection(profile);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("E-Business Suite 12.2.9");
    expect(r.productVersion).toContain("Oracle Database 19c");
  });

  it("fails connection without a database param (actionable message)", async () => {
    const r = await createMockEbsConnector().testConnection({ ...profile, params: {} });
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain("database");
  });

  it("discovers valid canonical metadata with EBS identity", async () => {
    const { metadata } = await createMockEbsConnector().discover(profile);
    const parsed = parseMetadata(metadata);
    expect(parsed.ok).toBe(true);
    expect(metadata.source.ebsRelease).toBe("12.2.9");
    expect(metadata.source.productVersion).toContain("19c");
    expect(metadata.source.ebsRelease).not.toBe(metadata.source.productVersion);
  });

  it("restricts discovery to requested schemas", async () => {
    const { metadata } = await createMockEbsConnector().discover(profile, { schemas: ["GL"] });
    expect(metadata.catalogs[0].schemas.map((s) => s.name)).toEqual(["GL"]);
  });

  it("records relationship provenance (not every relationship is a declared FK)", () => {
    const md = ebsMockMetadata();
    const inv = allObjects(md).find((o) => o.object.name === "AP_INVOICES_ALL")!.object;
    expect(inv.foreignKeys[0].provenance).toBe("ebs-metadata");
    expect(inv.foreignKeys[0].confidence).toBe(0.95);
    const lines = allObjects(md).find((o) => o.object.name === "AP_INVOICE_LINES_ALL")!.object;
    expect(lines.foreignKeys[0].provenance).toBe("declared-fk");
  });
});

describe("EBS reverse-engineering → model (Req 21 §6)", () => {
  it("builds entities, product tags, descriptions, relationships and composite keys", () => {
    const { model, products, warnings } = ebsSnapshotToModel(ebsMockMetadata(), "EBS Payables", NOW);
    expect(model.entities.map((e) => e.name).sort()).toEqual(
      ["AP_INVOICES_ALL", "AP_INVOICE_LINES_ALL", "AP_SUPPLIERS", "GL_CODE_COMBINATIONS", "GL_JE_HEADERS"].sort(),
    );
    // Product tag carried onto the entity; a real DB comment is preserved as-is.
    const invoices = model.entities.find((e) => e.name === "AP_INVOICES_ALL")!;
    expect(invoices.tags).toContain("ebs:AP");
    expect(invoices.description).toContain("operating-unit striped");
    // Composite PK preserved; and with no DB comment, the verified business
    // description seeds the entity description (never an inferred one — §5).
    const lines = model.entities.find((e) => e.name === "AP_INVOICE_LINES_ALL")!;
    expect(lines.fields.filter((f) => f.primaryKey).map((f) => f.name)).toEqual(["INVOICE_ID", "LINE_NUMBER"]);
    expect(lines.description).toContain("Distribution lines of a supplier invoice");
    // Relationships from documented + declared FKs.
    expect(model.relationships.length).toBeGreaterThanOrEqual(2);
    // The unmappable BLOB column fell back to text with a warning.
    expect(invoices.fields.find((f) => f.name === "ATTACHMENT")?.type).toBe("text");
    expect(warnings.some((w) => w.includes("ATTACHMENT"))).toBe(true);
    // Product catalog derived from annotations (not an assumed fixed list).
    expect(products.map((p) => p.code)).toEqual(["AP", "GL"]);
    expect(products.find((p) => p.code === "AP")?.objectCount).toBe(3);
  });

  it("the produced model round-trips byte-identically", () => {
    const { model } = ebsSnapshotToModel(ebsMockMetadata(), "EBS", NOW);
    const once = serializeModel(model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);
  });

  it("re-discovering the same snapshot produces no drift (no duplicates, §6/AC-6)", () => {
    const md = ebsMockMetadata();
    const drift = computeDrift(md, md, NOW);
    expect(drift.changes).toHaveLength(0);
  });

  it("exposes EBS annotations with a verified flag distinct from inferred meaning", () => {
    const obj = allObjects(ebsMockMetadata()).find((o) => o.object.name === "AP_SUPPLIERS")!.object;
    const a = ebsAnnotation(obj)!;
    expect(a.product).toBe("AP");
    expect(a.verified).toBe(true);
  });
});

describe("EBS application-dictionary metadata (Req 21 §3C / Phase 3)", () => {
  it("discovers concurrent programs, lookups and program units", () => {
    const sum = ebsApplicationSummary(ebsMockMetadata());
    expect(sum.concurrentPrograms).toBe(3);
    expect(sum.lookups).toBe(2);
    expect(sum.programUnits).toBe(4);
    expect(sum.programUnitsByKind).toEqual({ package: 3, synonym: 1 });
  });

  it("snapshot serialization now preserves EBS release, FK provenance and app metadata", () => {
    const once = serializeMetadata(ebsMockMetadata());
    // Previously dropped by metadataToPlain — now present (§11/§7 fix).
    expect(once).toContain('"ebsRelease": "12.2.9"');
    expect(once).toContain('"ebsInstance": "VIS"');
    expect(once).toContain('"provenance": "ebs-metadata"');
    expect(once).toContain('"confidence": 0.95');
    expect(once).toContain('"concurrentPrograms"');
    expect(once).toContain('"APXINWKB"');
  });

  it("round-trips the full snapshot metadata byte-identically", () => {
    const once = serializeMetadata(ebsMockMetadata());
    const parsed = parseMetadata(JSON.parse(once));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeMetadata(parsed.value)).toBe(once);
  });

  it("application metadata is NOT turned into model tables (§11 separation)", () => {
    const { model } = ebsSnapshotToModel(ebsMockMetadata(), "EBS", "2026-01-01T00:00:00Z");
    // Program units / concurrent programs never become entities.
    expect(model.entities.some((e) => e.name === "AP_INVOICES_PKG")).toBe(false);
    expect(model.entities.some((e) => e.name === "APXINWKB")).toBe(false);
  });
});
