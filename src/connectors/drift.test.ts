import { describe, it, expect } from "vitest";
import { computeDrift, applyDrift } from "./drift";
import { metadataToModel } from "./toModel";
import type { CanonicalMetadata, CanonicalObject } from "./metadata";

const NOW = "2026-01-01T00:00:00Z";

function md(objects: { schema: string; obj: CanonicalObject }[]): CanonicalMetadata {
  const schemas = new Map<string, CanonicalObject[]>();
  for (const { schema, obj } of objects) {
    if (!schemas.has(schema)) schemas.set(schema, []);
    schemas.get(schema)!.push(obj);
  }
  return {
    metadataVersion: 1,
    source: { systemType: "postgres", name: "t" },
    capabilities: [],
    catalogs: [{ name: "db", schemas: [...schemas].map(([name, objs]) => ({ name, objects: objs })) }],
  };
}

const col = (name: string, nativeType: string, type: any, extra: Partial<CanonicalObject["columns"][number]> = {}) => ({
  name,
  ordinal: 0,
  nativeType,
  normalizedType: type ? { type } : undefined,
  nullable: true,
  ...extra,
});

function table(name: string, columns: CanonicalObject["columns"], primaryKey?: string[], foreignKeys: CanonicalObject["foreignKeys"] = []): CanonicalObject {
  return { name, kind: "table", columns, primaryKey, foreignKeys, indexes: [] };
}

describe("computeDrift", () => {
  it("detects added/removed tables, a new column and a changed type", () => {
    const prev = md([
      { schema: "s", obj: table("keep", [col("id", "integer", "integer"), col("old", "text", "text")], ["id"]) },
      { schema: "s", obj: table("gone", [col("id", "integer", "integer")], ["id"]) },
    ]);
    const next = md([
      { schema: "s", obj: table("keep", [col("id", "bigint", "bigint"), col("new", "text", "text")], ["id"]) },
      { schema: "s", obj: table("fresh", [col("id", "integer", "integer")], ["id"]) },
    ]);
    const { changes } = computeDrift(prev, next, NOW);
    const keys = changes.map((c) => c.key);
    expect(keys).toContain("E+:fresh");
    expect(keys).toContain("E-:gone");
    expect(keys).toContain("F+:keep.new");
    expect(keys).toContain("F-:keep.old");
    expect(keys).toContain("F~:keep.id");
  });

  it("flags a possible rename (same columns) instead of add+remove", () => {
    const prev = md([{ schema: "s", obj: table("customer", [col("id", "integer", "integer"), col("email", "text", "text")], ["id"]) }]);
    const next = md([{ schema: "s", obj: table("client", [col("id", "integer", "integer"), col("email", "text", "text")], ["id"]) }]);
    const { changes } = computeDrift(prev, next, NOW);
    expect(changes.some((c) => c.kind === "possible-rename")).toBe(true);
    // Not applied as a destructive remove/add.
    expect(changes.some((c) => c.key === "E-:customer")).toBe(false);
    expect(changes.some((c) => c.key === "E+:client")).toBe(false);
  });
});

describe("applyDrift", () => {
  const prev = md([
    { schema: "s", obj: table("orders", [col("id", "integer", "integer"), col("amount", "integer", "integer")], ["id"]) },
  ]);
  const next = md([
    { schema: "s", obj: table("orders", [col("id", "integer", "integer"), col("amount", "bigint", "bigint"), col("status", "text", "text")], ["id"]) },
    { schema: "s", obj: table("shipment", [col("id", "integer", "integer")], ["id"]) },
  ]);

  it("applies only accepted changes and preserves unrelated manual edits", () => {
    // The user's working model started from `prev` then gained a manual column.
    const userModel = metadataToModel(prev, "work", NOW).model;
    const orders = userModel.entities.find((e) => e.name === "orders")!;
    orders.fields.push({ id: "f_manual01", name: "note", type: "text", nullable: true, primaryKey: false, unique: false });

    const { diff, nextModel } = computeDrift(prev, next, NOW);
    // Accept the new column and the new table, but NOT the amount type change.
    const accepted = new Set(["F+:orders.status", "E+:shipment"]);
    const result = applyDrift(userModel, nextModel, diff, accepted);

    const o = result.entities.find((e) => e.name === "orders")!;
    expect(o.fields.some((f) => f.name === "status")).toBe(true); // accepted add
    expect(o.fields.some((f) => f.name === "note")).toBe(true); // manual edit preserved
    expect(o.fields.find((f) => f.name === "amount")!.type).toBe("integer"); // change NOT accepted
    expect(result.entities.some((e) => e.name === "shipment")).toBe(true); // accepted add table
  });

  it("applies an accepted type change", () => {
    const userModel = metadataToModel(prev, "work", NOW).model;
    const { diff, nextModel } = computeDrift(prev, next, NOW);
    const result = applyDrift(userModel, nextModel, diff, new Set(["F~:orders.amount"]));
    expect(result.entities.find((e) => e.name === "orders")!.fields.find((f) => f.name === "amount")!.type).toBe("bigint");
  });

  it("does nothing when no changes are accepted", () => {
    const userModel = metadataToModel(prev, "work", NOW).model;
    const { diff, nextModel } = computeDrift(prev, next, NOW);
    const result = applyDrift(userModel, nextModel, diff, new Set());
    expect(result.entities.map((e) => e.name).sort()).toEqual(["orders"]);
    expect(result.entities[0].fields.map((f) => f.name).sort()).toEqual(["amount", "id"]);
  });
});
