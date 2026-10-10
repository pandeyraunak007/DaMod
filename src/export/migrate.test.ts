import { describe, it, expect } from "vitest";
import { diffModels, diffIsEmpty, generateMigration } from "./migrate";
import { exportModelDDL } from "./ddl";
import { DIALECTS } from "./dialects";
import { newModel, newEntity, newField, type Model } from "../model/model";

const NOW = "2026-01-01T00:00:00Z";
const pg = DIALECTS.postgres;

function model(build: (m: Model) => void): Model {
  const m = newModel("orders", NOW, "Physical");
  build(m);
  return m;
}

function entity(name: string, fields = [] as ReturnType<typeof newField>[]) {
  const e = newEntity(name, { x: 0, y: 0 });
  e.fields = fields;
  return e;
}

describe("diffModels", () => {
  it("reports no differences for identical models", () => {
    const a = model((m) => {
      m.entities = [entity("T", [newField("id", "integer", { primaryKey: true, nullable: false })])];
    });
    const b = structuredCloneModel(a);
    expect(diffIsEmpty(diffModels(a, b))).toBe(true);
  });

  it("detects added, removed and changed entities and fields", () => {
    const base = model((m) => {
      m.entities = [
        entity("Keep", [
          newField("id", "integer", { primaryKey: true, nullable: false }),
          newField("old", "text"),
          newField("amount", "integer"),
        ]),
        entity("Gone", [newField("id", "integer", { primaryKey: true })]),
      ];
    });
    const target = model((m) => {
      m.entities = [
        entity("Keep", [
          newField("id", "integer", { primaryKey: true, nullable: false }),
          newField("amount", "bigint"), // type changed
          newField("created", "timestamp"), // added
        ]),
        entity("New", [newField("id", "integer", { primaryKey: true })]), // added
      ];
    });
    const diff = diffModels(base, target);
    expect(diff.addedEntities.map((e) => e.name)).toEqual(["New"]);
    expect(diff.removedEntities.map((e) => e.name)).toEqual(["Gone"]);
    const keep = diff.changedEntities.find((c) => c.name === "Keep")!;
    expect(keep.addedFields.map((f) => f.name)).toEqual(["created"]);
    expect(keep.removedFields.map((f) => f.name)).toEqual(["old"]);
    expect(keep.changedFields[0].field).toBe("amount");
    expect(keep.changedFields[0].changes.join()).toMatch(/integer → bigint/);
  });

  it("detects added and removed foreign keys by name signature", () => {
    const mk = (withFk: boolean) =>
      model((m) => {
        const parent = entity("Parent", [newField("id", "uuid", { primaryKey: true, nullable: false })]);
        const fk = newField("parent_id", "uuid", { nullable: false });
        const child = entity("Child", [
          newField("id", "uuid", { primaryKey: true, nullable: false }),
          fk,
        ]);
        m.entities = [parent, child];
        m.relationships = withFk
          ? [
              {
                id: "r_aaaaaaaa",
                cardinality: "one-to-many",
                parentEntity: parent.id,
                childEntity: child.id,
                parentOptional: false,
                childOptional: true,
                foreignKeyFields: [fk.id],
              },
            ]
          : [];
      });
    const added = diffModels(mk(false), mk(true));
    expect(added.addedFks).toHaveLength(1);
    const removed = diffModels(mk(true), mk(false));
    expect(removed.removedFks).toHaveLength(1);
  });
});

describe("generateMigration", () => {
  it("emits an empty-diff note when nothing changed", () => {
    const a = model((m) => {
      m.entities = [entity("T", [newField("id", "integer", { primaryKey: true })])];
    });
    const out = generateMigration(a, structuredCloneModel(a), pg);
    expect(out).toMatch(/No differences/);
  });

  it("emits CREATE, DROP and ALTER statements", () => {
    const base = model((m) => {
      m.entities = [
        entity("Keep", [
          newField("id", "integer", { primaryKey: true, nullable: false }),
          newField("amount", "integer"),
        ]),
        entity("Gone", [newField("id", "integer", { primaryKey: true, nullable: false })]),
      ];
    });
    const target = model((m) => {
      m.entities = [
        entity("Keep", [
          newField("id", "integer", { primaryKey: true, nullable: false }),
          newField("amount", "bigint", { nullable: false }),
          newField("note", "text"),
        ]),
        entity("Fresh", [newField("id", "integer", { primaryKey: true, nullable: false })]),
      ];
    });
    const out = generateMigration(base, target, pg);
    expect(out).toMatch(/CREATE TABLE "Fresh"/);
    expect(out).toMatch(/DROP TABLE IF EXISTS "Gone"/);
    expect(out).toMatch(/ALTER TABLE "Keep" ADD COLUMN "note" text/);
    expect(out).toMatch(/ALTER TABLE "Keep" ALTER COLUMN "amount" TYPE bigint/);
    expect(out).toMatch(/ALTER TABLE "Keep" ALTER COLUMN "amount" SET NOT NULL/);
  });
});

describe("DDL schema options", () => {
  it("adds DROP TABLE and IF NOT EXISTS when requested", () => {
    const m = model((mm) => {
      mm.entities = [entity("T", [newField("id", "integer", { primaryKey: true, nullable: false })])];
    });
    const out = exportModelDDL(m, pg, { dropFirst: true, ifNotExists: true });
    expect(out).toMatch(/DROP TABLE IF EXISTS "T" CASCADE;/);
    expect(out).toMatch(/CREATE TABLE IF NOT EXISTS "T"/);
  });

  it("stays byte-identical to the plain export when no options are set (FR-8.6)", () => {
    const m = model((mm) => {
      mm.entities = [entity("T", [newField("id", "integer", { primaryKey: true, nullable: false })])];
    });
    expect(exportModelDDL(m, pg, {})).toBe(exportModelDDL(m, pg));
  });
});

/** structuredClone loses the Model's method-free shape fine; keep a tiny helper. */
function structuredCloneModel(m: Model): Model {
  return JSON.parse(JSON.stringify(m));
}
