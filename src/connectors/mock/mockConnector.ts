// An in-memory mock connector. It implements the full contract without any
// driver or network, so the metadata/snapshot pipeline and (later) the UI can be
// built and tested before the Rust PostgreSQL adapter exists. Its fixture
// deliberately includes the edge cases §4 calls for: composite keys, a
// self-reference, a view, a quoted identifier, and an unusual native type.

import type { Capability } from "../capabilities";
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryOptions,
  DiscoveryResult,
} from "../connector";
import { ConnectorError } from "../errors";
import type { ConnectionProfile } from "../connection";
import type { CanonicalMetadata, CanonicalObject } from "../metadata";

const MOCK_ID = "mock";
const MOCK_VERSION = "1.0.0";

const CAPS: Capability[] = [
  "testConnection",
  "listSchemas",
  "discoverTables",
  "discoverViews",
  "discoverColumns",
  "discoverPrimaryKeys",
  "discoverForeignKeys",
  "discoverIndexes",
  // Deliberately NOT fullExtract / incrementalExtract — exercises unsupported.
];

function fixtureObjects(): Record<string, CanonicalObject[]> {
  const customer: CanonicalObject = {
    name: "Customer",
    kind: "table",
    primaryKey: ["id"],
    foreignKeys: [],
    indexes: [{ name: "customer_email_idx", columns: ["email"], unique: true }],
    columns: [
      { name: "id", ordinal: 0, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: false },
      { name: "email", ordinal: 1, nativeType: "varchar(320)", normalizedType: { type: "string", length: 320 }, nullable: false },
      { name: "manager_id", ordinal: 2, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: true },
    ],
  };
  // Self-reference: Customer.manager_id -> Customer.id.
  customer.foreignKeys.push({
    name: "customer_manager_fk",
    columns: ["manager_id"],
    refSchema: "sales",
    refObject: "Customer",
    refColumns: ["id"],
    onDelete: "set null",
  });

  // Composite primary key + two foreign keys (a junction/line table).
  const orderLine: CanonicalObject = {
    name: "OrderLine",
    kind: "table",
    primaryKey: ["order_id", "product_id"],
    foreignKeys: [
      { name: "ol_order_fk", columns: ["order_id"], refSchema: "sales", refObject: "Order", refColumns: ["id"] },
      { name: "ol_product_fk", columns: ["product_id"], refSchema: "sales", refObject: "Product", refColumns: ["id"] },
    ],
    indexes: [],
    columns: [
      { name: "order_id", ordinal: 0, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: false },
      { name: "product_id", ordinal: 1, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: false },
      { name: "qty", ordinal: 2, nativeType: "integer", normalizedType: { type: "integer" }, nullable: false, default: "1" },
      // An unusual native type with no clean normalized mapping: preserved native, normalized omitted.
      { name: "geo", ordinal: 3, nativeType: "geography(Point,4326)", nullable: true },
    ],
  };

  const order: CanonicalObject = {
    name: "Order",
    kind: "table",
    primaryKey: ["id"],
    foreignKeys: [
      { name: "order_customer_fk", columns: ["customer_id"], refSchema: "sales", refObject: "Customer", refColumns: ["id"] },
    ],
    indexes: [],
    columns: [
      { name: "id", ordinal: 0, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: false },
      { name: "customer_id", ordinal: 1, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: false },
      { name: "placed_at", ordinal: 2, nativeType: "timestamptz", normalizedType: { type: "timestamp" }, nullable: false },
      { name: "total", ordinal: 3, nativeType: "numeric(12,2)", normalizedType: { type: "decimal", precision: 12, scale: 2 }, nullable: true },
    ],
  };

  const product: CanonicalObject = {
    name: "Product",
    kind: "table",
    primaryKey: ["id"],
    foreignKeys: [],
    indexes: [],
    columns: [
      { name: "id", ordinal: 0, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: false },
      // A quoted-identifier-worthy name (reserved word) kept verbatim.
      { name: "Order", ordinal: 1, nativeType: "integer", normalizedType: { type: "integer" }, nullable: true },
    ],
  };

  // A view in a second schema.
  const activeCustomers: CanonicalObject = {
    name: "active_customers",
    kind: "view",
    foreignKeys: [],
    indexes: [],
    columns: [
      { name: "id", ordinal: 0, nativeType: "uuid", normalizedType: { type: "uuid" }, nullable: true },
      { name: "email", ordinal: 1, nativeType: "varchar(320)", normalizedType: { type: "string", length: 320 }, nullable: true },
    ],
  };

  return {
    sales: [customer, order, orderLine, product],
    reporting: [activeCustomers],
  };
}

class MockConnector implements Connector {
  readonly id = MOCK_ID;
  readonly version = MOCK_VERSION;
  readonly systemType = "mock" as const;

  capabilities(): readonly Capability[] {
    return CAPS;
  }

  async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    if (!profile.params.database) {
      return { ok: false, message: "Missing required param: database" };
    }
    return { ok: true, message: "Mock source reachable", productVersion: MOCK_VERSION };
  }

  async listSchemas(): Promise<string[]> {
    return Object.keys(fixtureObjects()).sort();
  }

  async discover(profile: ConnectionProfile, options?: DiscoveryOptions): Promise<DiscoveryResult> {
    const all = fixtureObjects();
    const wanted = options?.schemas?.length ? options.schemas : Object.keys(all);
    const includeViews = options?.includeViews ?? true;
    const includeIndexes = options?.includeIndexes ?? true;

    const schemas = wanted
      .filter((s) => all[s])
      .map((s) => ({
        name: s,
        objects: all[s]
          .filter((o) => includeViews || o.kind !== "view")
          .map((o) => (includeIndexes ? o : { ...o, indexes: [] })),
      }));

    const metadata: CanonicalMetadata = {
      metadataVersion: 1,
      source: {
        systemType: "mock",
        name: profile.params.database ?? "mock",
        productVersion: MOCK_VERSION,
      },
      capabilities: [...CAPS],
      catalogs: [{ name: profile.params.database ?? "mock", schemas }],
    };

    return {
      metadata,
      provenance: {
        connectorId: this.id,
        connectorVersion: this.version,
        discoveredAt: "1970-01-01T00:00:00.000Z", // caller stamps the real time
        schemasDiscovered: schemas.map((s) => s.name),
        capabilitiesUsed: ["listSchemas", "discoverTables", "discoverColumns", "discoverForeignKeys"],
      },
    };
  }
}

export function createMockConnector(): Connector {
  return new MockConnector();
}

/** Helper used by tests to assert extraction is explicitly unsupported. */
export function mockExtract(): never {
  throw new ConnectorError("unsupported", `Connector “${MOCK_ID}” does not support extraction.`);
}
