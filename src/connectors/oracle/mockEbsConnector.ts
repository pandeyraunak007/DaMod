// A mock Oracle E-Business Suite connector (Req 21 §12 Phase 1). It implements the
// full connector contract with NO Oracle driver or network, using an eTRM-style
// fixture (Payables + General Ledger modules), so the EBS metadata → snapshot →
// reverse-engineering pipeline is fully testable before a live Rust Oracle adapter
// exists (that adapter needs an Instant Client dependency + author sign-off, and an
// Oracle instance to verify — see docs/ORACLE_EBS.md). Metadata only: never reads
// application row data. The same fixture doubles as an importable offline snapshot.

import type { Capability } from "../capabilities";
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryOptions,
  DiscoveryResult,
} from "../connector";
import type { ConnectionProfile } from "../connection";
import type { CanonicalColumn, CanonicalMetadata, CanonicalObject } from "../metadata";
import { mapOracleType } from "./oracleTypes";
import type { EbsAnnotation } from "./ebs";

const EBS_ID = "oracle-ebs";
const EBS_VERSION = "0.1.0";
const ORACLE_DB_VERSION = "Oracle Database 19c Enterprise Edition 19.3.0.0.0";
const EBS_RELEASE = "12.2.9";
const EBS_INSTANCE = "VIS";

const CAPS: Capability[] = [
  "testConnection",
  "listSchemas",
  "discoverTables",
  "discoverViews",
  "discoverColumns",
  "discoverPrimaryKeys",
  "discoverForeignKeys",
  "discoverIndexes",
  "detectSchemaChanges",
  // Deliberately NOT fullExtract/incrementalExtract: read-only metadata discovery.
];

function col(
  name: string,
  ordinal: number,
  nativeType: string,
  opts: { nullable?: boolean; default?: string; comment?: string } = {},
): CanonicalColumn {
  return {
    name,
    ordinal,
    nativeType,
    normalizedType: mapOracleType(nativeType),
    nullable: opts.nullable ?? true,
    default: opts.default,
    comment: opts.comment,
  };
}

function ebs(annotation: EbsAnnotation): Record<string, unknown> {
  return { ebs: annotation };
}

// --- Payables (AP) + General Ledger (GL) fixture, eTRM-style ------------------
function fixtureSchemas(): { name: string; objects: CanonicalObject[] }[] {
  const suppliers: CanonicalObject = {
    name: "AP_SUPPLIERS",
    kind: "table",
    primaryKey: ["VENDOR_ID"],
    foreignKeys: [],
    indexes: [{ name: "AP_SUPPLIERS_U1", columns: ["VENDOR_ID"], unique: true }],
    comment: "Supplier (vendor) master.",
    nativeId: "AP.AP_SUPPLIERS",
    native: ebs({ product: "AP", productName: "Payables", businessDescription: "Suppliers from whom the enterprise purchases goods and services.", verified: true }),
    columns: [
      col("VENDOR_ID", 0, "NUMBER(15)", { nullable: false, comment: "Supplier unique identifier." }),
      col("VENDOR_NAME", 1, "VARCHAR2(240)", { nullable: false }),
      col("SEGMENT1", 2, "VARCHAR2(30)", { comment: "Supplier number." }),
      col("CREATION_DATE", 3, "DATE", { nullable: false }),
    ],
  };

  const invoices: CanonicalObject = {
    name: "AP_INVOICES_ALL",
    kind: "table",
    primaryKey: ["INVOICE_ID"],
    // In real EBS this relationship is documented in eTRM, NOT a declared DB FK.
    foreignKeys: [
      { name: "AP_INVOICES_VENDOR", columns: ["VENDOR_ID"], refSchema: "AP", refObject: "AP_SUPPLIERS", refColumns: ["VENDOR_ID"], provenance: "ebs-metadata", confidence: 0.95 },
    ],
    indexes: [],
    comment: "Supplier invoices (operating-unit striped: _ALL).",
    nativeId: "AP.AP_INVOICES_ALL",
    native: ebs({ product: "AP", productName: "Payables", businessDescription: "Invoices entered against suppliers for payment.", verified: true }),
    columns: [
      col("INVOICE_ID", 0, "NUMBER(15)", { nullable: false }),
      col("VENDOR_ID", 1, "NUMBER(15)", { nullable: false }),
      col("INVOICE_NUM", 2, "VARCHAR2(50)", { nullable: false }),
      col("INVOICE_AMOUNT", 3, "NUMBER(15,2)"),
      col("INVOICE_DATE", 4, "DATE", { nullable: false }),
      col("CODE_COMBINATION_ID", 5, "NUMBER(15)", { comment: "Default GL account." }),
      // Intentionally unmappable native type → preserved native, text fallback.
      col("ATTACHMENT", 6, "BLOB"),
    ],
  };

  const invoiceLines: CanonicalObject = {
    name: "AP_INVOICE_LINES_ALL",
    kind: "table",
    primaryKey: ["INVOICE_ID", "LINE_NUMBER"],
    foreignKeys: [
      { name: "AP_INV_LINES_INVOICE", columns: ["INVOICE_ID"], refSchema: "AP", refObject: "AP_INVOICES_ALL", refColumns: ["INVOICE_ID"], provenance: "declared-fk" },
    ],
    indexes: [],
    nativeId: "AP.AP_INVOICE_LINES_ALL",
    native: ebs({ product: "AP", productName: "Payables", businessDescription: "Distribution lines of a supplier invoice.", verified: true }),
    columns: [
      col("INVOICE_ID", 0, "NUMBER(15)", { nullable: false }),
      col("LINE_NUMBER", 1, "NUMBER", { nullable: false }),
      col("AMOUNT", 2, "NUMBER(15,2)"),
      col("CODE_COMBINATION_ID", 3, "NUMBER(15)"),
    ],
  };

  const codeCombinations: CanonicalObject = {
    name: "GL_CODE_COMBINATIONS",
    kind: "table",
    primaryKey: ["CODE_COMBINATION_ID"],
    foreignKeys: [],
    indexes: [],
    comment: "Accounting flexfield combinations (GL accounts).",
    nativeId: "GL.GL_CODE_COMBINATIONS",
    native: ebs({ product: "GL", productName: "General Ledger", businessDescription: "Valid account code combinations of the accounting flexfield.", verified: true }),
    columns: [
      col("CODE_COMBINATION_ID", 0, "NUMBER(15)", { nullable: false }),
      col("SEGMENT1", 1, "VARCHAR2(25)"),
      col("SEGMENT2", 2, "VARCHAR2(25)"),
      col("ENABLED_FLAG", 3, "VARCHAR2(1)", { nullable: false, default: "'Y'" }),
    ],
  };

  const journals: CanonicalObject = {
    name: "GL_JE_HEADERS",
    kind: "table",
    primaryKey: ["JE_HEADER_ID"],
    foreignKeys: [],
    indexes: [],
    comment: "Journal entry headers.",
    nativeId: "GL.GL_JE_HEADERS",
    native: ebs({ product: "GL", productName: "General Ledger", businessDescription: "Headers of General Ledger journal entries.", verified: true }),
    columns: [
      col("JE_HEADER_ID", 0, "NUMBER(15)", { nullable: false }),
      col("NAME", 1, "VARCHAR2(100)", { nullable: false }),
      col("DEFAULT_EFFECTIVE_DATE", 2, "DATE", { nullable: false }),
    ],
  };

  return [
    { name: "AP", objects: [suppliers, invoices, invoiceLines] },
    { name: "GL", objects: [codeCombinations, journals] },
  ];
}

/** The fixture as a standalone canonical snapshot — also an importable offline
 *  metadata package (Req 21 §3C/§10: offline modeling from imported metadata). */
export function ebsMockMetadata(database = "VIS"): CanonicalMetadata {
  return {
    metadataVersion: 1,
    source: {
      systemType: "oracle-ebs",
      name: database,
      productVersion: ORACLE_DB_VERSION,
      ebsRelease: EBS_RELEASE,
      ebsInstance: EBS_INSTANCE,
    },
    capabilities: [...CAPS],
    catalogs: [{ name: database, schemas: fixtureSchemas() }],
  };
}

class MockEbsConnector implements Connector {
  readonly id = EBS_ID;
  readonly version = EBS_VERSION;
  readonly systemType = "oracle-ebs" as const;

  capabilities(): readonly Capability[] {
    return CAPS;
  }

  async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    if (!profile.params.database) {
      return { ok: false, message: "Missing required param: database (EBS instance/service name)" };
    }
    // Report EBS identity + release SEPARATELY from the Oracle DB version (§2).
    return {
      ok: true,
      message: `Oracle E-Business Suite ${EBS_RELEASE} (instance ${EBS_INSTANCE}) on ${ORACLE_DB_VERSION}`,
      productVersion: ORACLE_DB_VERSION,
    };
  }

  async listSchemas(): Promise<string[]> {
    return fixtureSchemas().map((s) => s.name);
  }

  async discover(profile: ConnectionProfile, options?: DiscoveryOptions): Promise<DiscoveryResult> {
    const db = profile.params.database ?? "VIS";
    const md = ebsMockMetadata(db);
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
        capabilitiesUsed: ["listSchemas", "discoverTables", "discoverColumns", "discoverPrimaryKeys", "discoverForeignKeys"],
      },
    };
  }
}

export function createMockEbsConnector(): Connector {
  return new MockEbsConnector();
}
