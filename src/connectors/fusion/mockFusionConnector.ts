// A mock Oracle Fusion Cloud connector (Req 22 §12 Phase 1). It implements the full
// connector contract with NO network or OAuth, using a representative Financials
// fixture (invoices, invoice lines as a nested child, suppliers) plus REST-resource
// and extract-data-store metadata — so the Fusion discovery → snapshot → reverse-
// engineering pipeline is testable before a live REST connector exists (that needs a
// tenant + OAuth + rate-limit/pagination handling — see docs/ORACLE_FUSION.md).
// Metadata only: never reads business records. Doubles as an importable snapshot.

import type { Capability } from "../capabilities";
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryOptions,
  DiscoveryResult,
} from "../connector";
import type { ConnectionProfile } from "../connection";
import type { CanonicalColumn, CanonicalMetadata, CanonicalObject, FusionMetadata } from "../metadata";
import { mapFusionType } from "./fusionTypes";
import type { FusionAnnotation } from "./fusion";

const FUSION_ID = "oracle-fusion";
const FUSION_VERSION = "0.1.0";
const API_VERSION = "11.13.18.05";

const CAPS: Capability[] = [
  "testConnection",
  "listSchemas",
  "discoverTables",
  "discoverColumns",
  "discoverPrimaryKeys",
  "discoverForeignKeys",
  "detectSchemaChanges",
  // Deliberately NOT fullExtract/incrementalExtract: discovery is read-only; bulk
  // extraction (BICC / Data Extraction) is a separate, later capability.
];

function col(
  name: string,
  ordinal: number,
  fusionType: string,
  opts: { nullable?: boolean; comment?: string } = {},
): CanonicalColumn {
  return {
    name,
    ordinal,
    nativeType: fusionType,
    normalizedType: mapFusionType(fusionType),
    nullable: opts.nullable ?? true,
    comment: opts.comment,
  };
}

function fusion(a: FusionAnnotation): Record<string, unknown> {
  return { fusion: a };
}

// Financials family fixture, from documented REST business objects (shape only).
function fixtureObjects(): CanonicalObject[] {
  const supplier: CanonicalObject = {
    name: "Supplier",
    kind: "business-object",
    primaryKey: ["SupplierId"],
    foreignKeys: [],
    indexes: [],
    comment: "A party that provides goods or services.",
    nativeId: "fscmRestApi/resources/suppliers",
    native: fusion({ family: "Financials", module: "Payables", businessObjectId: "suppliers", apiPath: "/fscmRestApi/resources/11.13.18.05/suppliers", apiVersion: API_VERSION, verified: true }),
    columns: [
      col("SupplierId", 0, "long", { nullable: false, comment: "Unique supplier identifier." }),
      col("SupplierName", 1, "string", { nullable: false }),
      col("SupplierNumber", 2, "string"),
      col("CreationDate", 3, "date-time", { nullable: false }),
    ],
  };

  const invoice: CanonicalObject = {
    name: "InvoiceHeader",
    kind: "business-object",
    primaryKey: ["InvoiceId"],
    // Documented REST relationship (not a DB FK) — a Fusion business-object reference.
    foreignKeys: [
      { name: "invoice_supplier", columns: ["SupplierId"], refObject: "Supplier", refColumns: ["SupplierId"], provenance: "fusion-metadata", confidence: 0.95 },
    ],
    indexes: [],
    comment: "Supplier invoice header business object.",
    nativeId: "fscmRestApi/resources/invoices",
    native: fusion({ family: "Financials", module: "Payables", businessObjectId: "invoices", apiPath: "/fscmRestApi/resources/11.13.18.05/invoices", apiVersion: API_VERSION, verified: true }),
    columns: [
      col("InvoiceId", 0, "long", { nullable: false }),
      col("SupplierId", 1, "long", { nullable: false }),
      col("InvoiceNumber", 2, "string", { nullable: false }),
      col("InvoiceAmount", 3, "number"),
      col("InvoiceDate", 4, "date", { nullable: false }),
      col("Attachment", 5, "binary"), // unmappable → preserved native, text fallback
    ],
  };

  // Nested child resource (invoices/{id}/child/invoiceLines) → FK to the header.
  const invoiceLine: CanonicalObject = {
    name: "InvoiceLine",
    kind: "business-object",
    primaryKey: ["InvoiceId", "LineNumber"],
    foreignKeys: [
      { name: "line_invoice", columns: ["InvoiceId"], refObject: "InvoiceHeader", refColumns: ["InvoiceId"], provenance: "fusion-metadata" },
    ],
    indexes: [],
    comment: "Nested invoice distribution line.",
    nativeId: "fscmRestApi/resources/invoices/child/invoiceLines",
    native: fusion({ family: "Financials", module: "Payables", businessObjectId: "invoices/child/invoiceLines", apiPath: "/fscmRestApi/resources/11.13.18.05/invoices/{InvoicesUniqID}/child/invoiceLines", apiVersion: API_VERSION, verified: true }),
    columns: [
      col("InvoiceId", 0, "long", { nullable: false }),
      col("LineNumber", 1, "integer", { nullable: false }),
      col("LineAmount", 2, "number"),
    ],
  };

  return [supplier, invoice, invoiceLine];
}

function fixtureFusion(): FusionMetadata {
  return {
    apiResources: [
      { name: "invoices", path: "/fscmRestApi/resources/11.13.18.05/invoices", methods: ["GET", "POST", "PATCH"], version: API_VERSION, family: "Financials", description: "Supplier invoices." },
      { name: "suppliers", path: "/fscmRestApi/resources/11.13.18.05/suppliers", methods: ["GET", "POST", "PATCH"], version: API_VERSION, family: "Financials" },
    ],
    extractDataStores: [
      { name: "FscmTopModelAM.FinExtractAM.ApInvoicesExtractPVO", offering: "Financials", fields: ["InvoiceId", "SupplierId", "InvoiceAmount", "InvoiceDate"], incremental: true, description: "Payables invoices extract (BICC PVO)." },
    ],
  };
}

export function fusionMockMetadata(instance = "https://example.fa.ocs.oraclecloud.com"): CanonicalMetadata {
  return {
    metadataVersion: 1,
    source: { systemType: "oracle-fusion", name: instance, apiVersion: API_VERSION },
    capabilities: [...CAPS],
    // "Financials" is the discovered family; business objects live under it.
    catalogs: [{ name: "Fusion", schemas: [{ name: "Financials", objects: fixtureObjects() }] }],
    fusion: fixtureFusion(),
  };
}

class MockFusionConnector implements Connector {
  readonly id = FUSION_ID;
  readonly version = FUSION_VERSION;
  readonly systemType = "oracle-fusion" as const;

  capabilities(): readonly Capability[] {
    return CAPS;
  }

  async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    if (!profile.params.baseUrl && !profile.params.database) {
      return { ok: false, message: "Missing required param: baseUrl (Fusion instance URL)" };
    }
    return {
      ok: true,
      message: `Oracle Fusion Cloud reachable (REST API ${API_VERSION})`,
      productVersion: `Fusion REST API ${API_VERSION}`,
    };
  }

  async listSchemas(): Promise<string[]> {
    // Application families are the top-level grouping surfaced as "schemas".
    return [...new Set(fixtureObjects().map((o) => (o.native?.fusion as FusionAnnotation | undefined)?.family ?? "Financials"))];
  }

  async discover(profile: ConnectionProfile, options?: DiscoveryOptions): Promise<DiscoveryResult> {
    const instance = profile.params.baseUrl ?? profile.params.database ?? "fusion";
    const md = fusionMockMetadata(instance);
    const wanted = options?.schemas?.length ? new Set(options.schemas) : null;
    md.catalogs[0].schemas = md.catalogs[0].schemas.filter((s) => !wanted || wanted.has(s.name));
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

export function createMockFusionConnector(): Connector {
  return new MockFusionConnector();
}
