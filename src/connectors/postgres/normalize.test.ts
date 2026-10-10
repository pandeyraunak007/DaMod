import { describe, it, expect } from "vitest";
import { normalizePgDiscovery, type PgDiscoveryPayload } from "./normalize";
import { parseMetadata, allObjects } from "../metadata";

const payload: PgDiscoveryPayload = {
  server_version: "16.2",
  database: "shop",
  schemas: [
    {
      name: "sales",
      objects: [
        {
          name: "customer",
          kind: "table",
          primary_key: ["id"],
          columns: [
            { name: "id", ordinal: 1, native_type: "uuid", nullable: false, default: null, generated: false },
            { name: "email", ordinal: 2, native_type: "character varying(320)", nullable: false, default: null, generated: false },
            { name: "balance", ordinal: 3, native_type: "numeric(12,2)", nullable: true, default: "0", generated: false },
            { name: "geo", ordinal: 4, native_type: "geography(Point,4326)", nullable: true, default: null, generated: false },
          ],
          foreign_keys: [],
          indexes: [{ name: "customer_email_idx", columns: ["email"], unique: true }],
        },
        {
          name: "order_line",
          kind: "table",
          primary_key: ["order_id", "product_id"],
          columns: [
            { name: "order_id", ordinal: 1, native_type: "uuid", nullable: false, default: null, generated: false },
            { name: "product_id", ordinal: 2, native_type: "uuid", nullable: false, default: null, generated: false },
          ],
          foreign_keys: [
            { name: "ol_order_fk", columns: ["order_id"], ref_schema: "sales", ref_object: "order", ref_columns: ["id"], on_delete: "cascade", on_update: "no action" },
          ],
          indexes: [],
        },
        {
          name: "active_customers",
          kind: "view",
          primary_key: [],
          columns: [{ name: "id", ordinal: 1, native_type: "uuid", nullable: true, default: null, generated: false }],
          foreign_keys: [],
          indexes: [],
        },
      ],
    },
  ],
};

describe("normalizePgDiscovery", () => {
  const md = normalizePgDiscovery(payload, "localhost:5432/shop");

  it("produces valid canonical metadata", () => {
    expect(parseMetadata(md).ok).toBe(true);
    expect(md.source.systemType).toBe("postgres");
    expect(md.source.productVersion).toBe("16.2");
  });

  it("maps native types into the fixed modeling set", () => {
    const customer = allObjects(md).find((o) => o.object.name === "customer")!.object;
    expect(customer.columns.find((c) => c.name === "email")!.normalizedType).toEqual({ type: "string", length: 320 });
    expect(customer.columns.find((c) => c.name === "balance")!.normalizedType).toEqual({ type: "decimal", precision: 12, scale: 2 });
  });

  it("preserves a native type with no confident mapping (normalizedType omitted)", () => {
    const customer = allObjects(md).find((o) => o.object.name === "customer")!.object;
    const geo = customer.columns.find((c) => c.name === "geo")!;
    expect(geo.nativeType).toBe("geography(Point,4326)");
    expect(geo.normalizedType).toBeUndefined();
  });

  it("carries composite primary keys and foreign keys with RI actions", () => {
    const ol = allObjects(md).find((o) => o.object.name === "order_line")!.object;
    expect(ol.primaryKey).toEqual(["order_id", "product_id"]);
    expect(ol.foreignKeys[0].refObject).toBe("order");
    expect(ol.foreignKeys[0].onDelete).toBe("cascade");
    expect(ol.foreignKeys[0].onUpdate).toBeUndefined(); // "no action" dropped
  });

  it("keeps views and indexes", () => {
    expect(allObjects(md).some((o) => o.object.kind === "view")).toBe(true);
    const customer = allObjects(md).find((o) => o.object.name === "customer")!.object;
    expect(customer.indexes[0]).toEqual({ name: "customer_email_idx", columns: ["email"], unique: true });
  });
});
