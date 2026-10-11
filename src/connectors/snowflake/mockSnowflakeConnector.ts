// A mock Snowflake connector (Req 23 §2/§7 Phase 2). Implements the full connector
// contract with NO Snowflake driver or network, using a representative ANALYTICS
// database fixture (customers / orders / a view) that exercises Snowflake-specific
// types — NUMBER(p,s), VARCHAR, TIMESTAMP_NTZ, VARIANT, GEOGRAPHY — so the discovery
// → snapshot → reverse-engineering pipeline is testable before a live adapter exists
// (that needs account/warehouse/role + key-pair/OAuth auth — see docs/SNOWFLAKE.md).
// Metadata only: never reads table rows.

import type { Capability } from "../capabilities";
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryOptions,
  DiscoveryResult,
} from "../connector";
import type { ConnectionProfile } from "../connection";
import type { CanonicalColumn, CanonicalMetadata, CanonicalObject } from "../metadata";
import { mapSnowflakeType } from "./snowflakeTypes";

const SF_ID = "snowflake";
const SF_VERSION = "0.1.0";
const SF_RELEASE = "Snowflake 8.x";

const CAPS: Capability[] = [
  "testConnection",
  "listSchemas",
  "discoverTables",
  "discoverViews",
  "discoverColumns",
  "discoverPrimaryKeys",
  "discoverForeignKeys",
  "detectSchemaChanges",
  // NOT fullExtract/incrementalExtract: read-only metadata discovery.
];

function col(
  name: string,
  ordinal: number,
  sfType: string,
  opts: { nullable?: boolean; comment?: string } = {},
): CanonicalColumn {
  return { name, ordinal, nativeType: sfType, normalizedType: mapSnowflakeType(sfType), nullable: opts.nullable ?? true, comment: opts.comment };
}

function fixtureSchemas(): { name: string; objects: CanonicalObject[] }[] {
  const customer: CanonicalObject = {
    name: "CUSTOMER",
    kind: "table",
    primaryKey: ["C_CUSTKEY"],
    foreignKeys: [],
    indexes: [],
    comment: "Customer dimension.",
    nativeId: "ANALYTICS.PUBLIC.CUSTOMER",
    columns: [
      col("C_CUSTKEY", 0, "NUMBER(38,0)", { nullable: false }),
      col("C_NAME", 1, "VARCHAR(100)", { nullable: false }),
      col("C_PROFILE", 2, "VARIANT"), // semi-structured → json, native preserved
      col("C_LOCATION", 3, "GEOGRAPHY"), // unmappable → native preserved
      col("C_CREATED_AT", 4, "TIMESTAMP_NTZ", { nullable: false }),
    ],
  };

  const orders: CanonicalObject = {
    name: "ORDERS",
    kind: "table",
    primaryKey: ["O_ORDERKEY"],
    // Snowflake constraints are declared but NOT enforced on standard tables (§4.2).
    foreignKeys: [
      { name: "ORDERS_CUSTOMER_FK", columns: ["O_CUSTKEY"], refObject: "CUSTOMER", refColumns: ["C_CUSTKEY"], provenance: "declared-fk" },
    ],
    indexes: [],
    comment: "Order fact (declared FK is not enforced by Snowflake).",
    nativeId: "ANALYTICS.PUBLIC.ORDERS",
    columns: [
      col("O_ORDERKEY", 0, "NUMBER(38,0)", { nullable: false }),
      col("O_CUSTKEY", 1, "NUMBER(38,0)", { nullable: false }),
      col("O_TOTALPRICE", 2, "NUMBER(12,2)"),
      col("O_ORDERDATE", 3, "DATE", { nullable: false }),
      col("O_SHIPPED", 4, "BOOLEAN"),
    ],
  };

  const activeCustomers: CanonicalObject = {
    name: "ACTIVE_CUSTOMERS",
    kind: "view",
    foreignKeys: [],
    indexes: [],
    comment: "Customers with at least one order.",
    nativeId: "ANALYTICS.PUBLIC.ACTIVE_CUSTOMERS",
    columns: [
      col("C_CUSTKEY", 0, "NUMBER(38,0)"),
      col("C_NAME", 1, "VARCHAR(100)"),
    ],
  };

  return [{ name: "PUBLIC", objects: [customer, orders, activeCustomers] }];
}

export function snowflakeMockMetadata(database = "ANALYTICS"): CanonicalMetadata {
  return {
    metadataVersion: 1,
    source: { systemType: "snowflake", name: database, productVersion: SF_RELEASE },
    capabilities: [...CAPS],
    catalogs: [{ name: database, schemas: fixtureSchemas() }],
  };
}

class MockSnowflakeConnector implements Connector {
  readonly id = SF_ID;
  readonly version = SF_VERSION;
  readonly systemType = "snowflake" as const;

  capabilities(): readonly Capability[] {
    return CAPS;
  }

  async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    if (!profile.params.database) {
      return { ok: false, message: "Missing required param: database (Snowflake account/database)" };
    }
    return { ok: true, message: `Snowflake reachable (${SF_RELEASE})`, productVersion: SF_RELEASE };
  }

  async listSchemas(): Promise<string[]> {
    return fixtureSchemas().map((s) => s.name);
  }

  async discover(profile: ConnectionProfile, options?: DiscoveryOptions): Promise<DiscoveryResult> {
    const db = profile.params.database ?? "ANALYTICS";
    const md = snowflakeMockMetadata(db);
    const wanted = options?.schemas?.length ? new Set(options.schemas) : null;
    const includeViews = options?.includeViews ?? true;
    md.catalogs[0].schemas = md.catalogs[0].schemas
      .filter((s) => !wanted || wanted.has(s.name))
      .map((s) => ({ name: s.name, objects: s.objects.filter((o) => includeViews || o.kind !== "view") }));
    return {
      metadata: md,
      provenance: {
        connectorId: this.id,
        connectorVersion: this.version,
        discoveredAt: "1970-01-01T00:00:00.000Z", // caller stamps the real time
        schemasDiscovered: md.catalogs[0].schemas.map((s) => s.name),
        capabilitiesUsed: ["listSchemas", "discoverTables", "discoverColumns", "discoverForeignKeys"],
      },
    };
  }
}

export function createMockSnowflakeConnector(): Connector {
  return new MockSnowflakeConnector();
}
