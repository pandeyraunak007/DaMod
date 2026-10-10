import { describe, it, expect } from "vitest";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { exportModelDDL } from "../export/ddl";
import { DIALECTS } from "../export/dialects";
import { validateWorkspace } from "../validation/rules";

const s = () => useModelStore.getState();
const pg = DIALECTS.postgres;

function freshPhysical() {
  s().loadModel(newModel("shop", "2026-01-01T00:00:00Z", "Physical", "postgres"));
}

// Req 19 — new first-class PostgreSQL objects: check constraints, schemas,
// materialized views. Each exercised through create → edit → persist → DDL.
describe("check constraints (Req 19)", () => {
  it("create, edit, generate inline CHECK DDL, round-trip, delete, undo", () => {
    freshPhysical();
    const e = s().createEntity();
    s().renameEntity(e, "order_line");
    const f = s().addField(e)!;
    s().updateField(e, f, { name: "qty", type: "integer", primaryKey: true, nullable: false });

    const cid = s().addCheck(e)!;
    s().updateCheck(e, cid, { name: "qty_positive", expression: "qty > 0" });

    const ddl = exportModelDDL(s().model, pg);
    expect(ddl).toContain('CONSTRAINT "qty_positive" CHECK (qty > 0)');

    // Round-trips byte-identically.
    const once = serializeModel(s().model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);

    // Delete + undo.
    s().deleteCheck(e, cid);
    expect(s().model.entities[0].checks ?? []).toHaveLength(0);
    s().undo();
    expect(s().model.entities[0].checks).toHaveLength(1);
  });

  it("flags an empty check expression", () => {
    freshPhysical();
    const e = s().createEntity();
    const cid = s().addCheck(e)!;
    s().updateCheck(e, cid, { expression: "" });
    const issues = validateWorkspace({ models: [{ id: s().model.id, name: "shop", model: s().model }], links: [], conceptGroups: [] });
    expect(issues.some((i) => i.rule === "checkConstraintIssues")).toBe(true);
  });
});

describe("schemas (Req 19)", () => {
  it("create, edit, generate CREATE SCHEMA DDL, round-trip, delete detaches tables", () => {
    freshPhysical();
    const sid = s().createSchema();
    s().updateSchema(sid, { name: "sales", owner: "app_owner", comment: "sales domain" });
    const e = s().createEntity();
    s().renameEntity(e, "orders");
    s().updateEntity(e, { schema: "sales" });

    const ddl = exportModelDDL(s().model, pg);
    expect(ddl).toContain('CREATE SCHEMA IF NOT EXISTS "sales" AUTHORIZATION "app_owner";');
    expect(ddl).toContain('COMMENT ON SCHEMA "sales" IS \'sales domain\';');

    const once = serializeModel(s().model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);

    // Deleting the schema detaches the table (does NOT delete it).
    s().deleteSchema(sid);
    expect(s().model.schemas ?? []).toHaveLength(0);
    expect(s().model.entities[0].schema).toBeUndefined();
    expect(s().model.entities[0].name).toBe("orders");
  });

  it("flags a duplicate schema name", () => {
    freshPhysical();
    const a = s().createSchema();
    s().updateSchema(a, { name: "dup" });
    const b = s().createSchema();
    s().updateSchema(b, { name: "dup" });
    const issues = validateWorkspace({ models: [{ id: s().model.id, name: "shop", model: s().model }], links: [], conceptGroups: [] });
    expect(issues.some((i) => i.rule === "schemaIssues")).toBe(true);
  });
});

describe("materialized views (Req 19)", () => {
  it("create a materialized view with WITH NO DATA and generate the right DDL", () => {
    freshPhysical();
    const id = s().createView(undefined, true);
    s().updateView(id, { name: "mv_totals", definition: "SELECT 1 AS n", withNoData: true });
    const v = s().model.views!.find((x) => x.id === id)!;
    expect(v.materialized).toBe(true);

    const ddl = exportModelDDL(s().model, pg);
    expect(ddl).toContain('CREATE MATERIALIZED VIEW "mv_totals" AS');
    expect(ddl).toContain("WITH NO DATA;");

    // A plain view stays a plain view.
    const vid = s().createView();
    s().updateView(vid, { name: "v_plain", definition: "SELECT 2" });
    const ddl2 = exportModelDDL(s().model, pg);
    expect(ddl2).toContain('CREATE OR REPLACE VIEW "v_plain" AS');
  });
});
