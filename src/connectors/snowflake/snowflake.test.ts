import { describe, it, expect } from "vitest";
import { mapSnowflakeType } from "./snowflakeTypes";
import { createMockSnowflakeConnector, snowflakeMockMetadata } from "./mockSnowflakeConnector";
import { metadataToModelForSource } from "../buildModel";
import { parseMetadata } from "../metadata";
import { getConnector } from "../registry";
import { exportModelDDL } from "../../export/ddl";
import { DIALECTS } from "../../export/dialects";
import { serializeModel } from "../../persist/serialize";
import { parseModelFile } from "../../persist/schema";
import type { ConnectionProfile } from "../connection";

const NOW = "2026-01-01T00:00:00Z";
const profile: ConnectionProfile = { id: "p1", name: "sf", systemType: "snowflake", params: { database: "ANALYTICS" } };

describe("Snowflake type mapping (Req 23 §4.1)", () => {
  it("maps Snowflake spellings to the canonical set", () => {
    expect(mapSnowflakeType("NUMBER(12,2)")).toEqual({ type: "decimal", precision: 12, scale: 2 });
    expect(mapSnowflakeType("NUMBER(9,0)")).toEqual({ type: "integer" });
    expect(mapSnowflakeType("NUMBER(38,0)")).toEqual({ type: "decimal", precision: 38, scale: 0 });
    expect(mapSnowflakeType("VARCHAR(100)")).toEqual({ type: "string", length: 100 });
    expect(mapSnowflakeType("BOOLEAN")).toEqual({ type: "boolean" });
    expect(mapSnowflakeType("DATE")).toEqual({ type: "date" });
    expect(mapSnowflakeType("TIMESTAMP_NTZ")).toEqual({ type: "timestamp" });
    expect(mapSnowflakeType("VARIANT")).toEqual({ type: "json" }); // semi-structured
    expect(mapSnowflakeType("OBJECT")).toEqual({ type: "json" });
    expect(mapSnowflakeType("ARRAY")).toEqual({ type: "json" });
  });
  it("returns undefined for types with no faithful mapping (preserve native)", () => {
    expect(mapSnowflakeType("GEOGRAPHY")).toBeUndefined();
    expect(mapSnowflakeType("GEOMETRY")).toBeUndefined();
    expect(mapSnowflakeType("BINARY")).toBeUndefined();
    expect(mapSnowflakeType("VECTOR(FLOAT,3)")).toBeUndefined();
  });
});

describe("mock Snowflake connector (Req 23 §2/§7)", () => {
  it("is resolvable from the registry", () => {
    expect(getConnector("snowflake")?.systemType).toBe("snowflake");
  });
  it("tests + discovers valid canonical metadata", async () => {
    const c = createMockSnowflakeConnector();
    expect((await c.testConnection(profile)).ok).toBe(true);
    const { metadata } = await c.discover(profile);
    expect(parseMetadata(metadata).ok).toBe(true);
    expect(metadata.source.systemType).toBe("snowflake");
  });
  it("fails without a database param", async () => {
    expect((await createMockSnowflakeConnector().testConnection({ ...profile, params: {} })).ok).toBe(false);
  });
});

describe("Snowflake reverse-engineering → model → DDL (Req 23 §7/§5)", () => {
  it("reverse-engineers tables/view/relationship, preserving Snowflake-native types", () => {
    const { model, warnings } = metadataToModelForSource(snowflakeMockMetadata(), "sf", NOW);
    expect(model.entities.map((e) => e.name).sort()).toEqual(["ACTIVE_CUSTOMERS", "CUSTOMER", "ORDERS"]);
    const cust = model.entities.find((e) => e.name === "CUSTOMER")!;
    // Semi-structured VARIANT normalized to json, native spelling preserved on the field.
    const profileCol = cust.fields.find((f) => f.name === "C_PROFILE")!;
    expect(profileCol.type).toBe("json");
    expect(profileCol.source?.nativeType).toBe("VARIANT");
    // Unmappable GEOGRAPHY → text fallback (warned), native spelling preserved.
    const geo = cust.fields.find((f) => f.name === "C_LOCATION")!;
    expect(geo.type).toBe("text");
    expect(geo.source?.nativeType).toBe("GEOGRAPHY");
    expect(warnings.some((w) => w.includes("GEOGRAPHY"))).toBe(true);
    // Declared (not enforced) FK → relationship.
    expect(model.relationships.length).toBe(1);
    // A view becomes an entity tagged "view".
    expect(model.entities.find((e) => e.name === "ACTIVE_CUSTOMERS")?.tags).toContain("view");
  });

  it("generates Snowflake DDL and round-trips the model byte-identically", () => {
    const { model } = metadataToModelForSource(snowflakeMockMetadata(), "sf", NOW);
    const ddl = exportModelDDL(model, DIALECTS.snowflake);
    expect(ddl).toContain('CREATE TABLE "CUSTOMER"');
    expect(ddl).toContain("VARIANT"); // json column → Snowflake VARIANT
    expect(ddl).toContain("NUMBER(12,2)"); // decimal → Snowflake NUMBER

    const once = serializeModel(model);
    expect(once).toContain('"nativeType": "VARIANT"');
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);
  });
});
