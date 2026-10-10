import { describe, it, expect } from "vitest";
import { metadataToModel } from "./toModel";
import { createMockConnector } from "./mock/mockConnector";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import type { ConnectionProfile } from "./connection";

const NOW = "2026-01-01T00:00:00Z";
const profile: ConnectionProfile = {
  id: "g_t",
  name: "mock",
  systemType: "mock",
  params: { database: "demo" },
};

describe("metadataToModel (discover → model)", () => {
  it("maps the mock source into a valid, persistable model", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const { model, warnings } = metadataToModel(metadata, "imported", NOW);

    expect(model.level).toBe("Physical");
    const names = model.entities.map((e) => e.name).sort();
    expect(names).toEqual(["Customer", "Order", "OrderLine", "Product", "active_customers"]);

    // The unmappable native type (geography) warns and falls back to text.
    expect(warnings.some((w) => /geography/.test(w))).toBe(true);

    // Composite PK preserved.
    const orderLine = model.entities.find((e) => e.name === "OrderLine")!;
    const olPks = orderLine.fields.filter((f) => f.primaryKey).map((f) => f.name);
    expect(olPks).toEqual(["order_id", "product_id"]);

    // Self-reference on Customer.manager_id -> Customer.id becomes a relationship.
    const customer = model.entities.find((e) => e.name === "Customer")!;
    const selfRel = model.relationships.find(
      (r) => r.parentEntity === customer.id && r.childEntity === customer.id,
    );
    expect(selfRel).toBeTruthy();

    // A view is tagged.
    expect(model.entities.find((e) => e.name === "active_customers")!.tags).toEqual(["view"]);

    // The whole thing round-trips through the existing model persistence.
    const text = serializeModel(model);
    const parsed = parseModelFile(text);
    expect(parsed.ok).toBe(true);
  });

  it("maps types, nullability and a unique index onto fields", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const { model } = metadataToModel(metadata, "imported", NOW);
    const customer = model.entities.find((e) => e.name === "Customer")!;
    const email = customer.fields.find((f) => f.name === "email")!;
    expect(email.type).toBe("string");
    expect(email.length).toBe(320);
    expect(email.nullable).toBe(false);
    expect(email.unique).toBe(true); // from the unique single-column index
  });

  it("maps FK referential actions onto the relationship", async () => {
    const { metadata } = await createMockConnector().discover(profile);
    const { model } = metadataToModel(metadata, "imported", NOW);
    const customer = model.entities.find((e) => e.name === "Customer")!;
    const selfRel = model.relationships.find(
      (r) => r.parentEntity === customer.id && r.childEntity === customer.id,
    )!;
    expect(selfRel.onDelete).toBe("set null");
  });

  it("warns and skips a foreign key to an object outside the import", () => {
    const md = {
      metadataVersion: 1 as const,
      source: { systemType: "postgres" as const, name: "x" },
      capabilities: [],
      catalogs: [
        {
          name: "db",
          schemas: [
            {
              name: "s",
              objects: [
                {
                  name: "child",
                  kind: "table" as const,
                  columns: [{ name: "fk", ordinal: 0, nativeType: "integer", normalizedType: { type: "integer" as const }, nullable: true }],
                  foreignKeys: [{ columns: ["fk"], refObject: "missing", refColumns: ["id"] }],
                  indexes: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const { model, warnings } = metadataToModel(md, "x", NOW);
    expect(model.relationships).toHaveLength(0);
    expect(warnings.some((w) => /not in the import/.test(w))).toBe(true);
  });
});
