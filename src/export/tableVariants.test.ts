import { describe, it, expect } from "vitest";
import { newModel, newEntity, newField, type Model } from "../model/model";
import { createRelationship } from "../model/operations";
import { exportModelDDL } from "./ddl";
import { DIALECTS } from "./dialects";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { validateWorkspace } from "../validation/rules";

function twoTables(kindChild?: Model["entities"][number]["tableKind"]): { model: Model; childId: string } {
  let m = newModel("sf", "2026-01-01T00:00:00Z", "Physical", "snowflake");
  const parent = newEntity("CUSTOMER", { x: 0, y: 0 });
  parent.fields.push(newField("C_CUSTKEY", "integer", { primaryKey: true, nullable: false }));
  const child = newEntity("ORDERS", { x: 0, y: 0 });
  child.fields.push(newField("O_ORDERKEY", "integer", { primaryKey: true, nullable: false }));
  if (kindChild) child.tableKind = kindChild;
  m.entities.push(parent, child);
  m = createRelationship(m, { cardinality: "one-to-many", parentEntity: parent.id, childEntity: child.id, foreignKeyFieldName: "C_CUSTKEY" }).model;
  return { model: m, childId: m.entities.find((e) => e.name === "ORDERS")!.id };
}

describe("table variants + enforcement DDL (Req 23 §4.1/§4.2)", () => {
  it("Snowflake standard table: PK/FK export as NOT ENFORCED", () => {
    const ddl = exportModelDDL(twoTables().model, DIALECTS.snowflake);
    expect(ddl).toContain("PRIMARY KEY");
    expect(ddl).toContain("NOT ENFORCED");
    expect(ddl).toContain("FOREIGN KEY");
    // the FK line carries NOT ENFORCED too
    expect(ddl.match(/NOT ENFORCED/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("Snowflake hybrid table: constraints are ENFORCED (no NOT ENFORCED)", () => {
    const ddl = exportModelDDL(twoTables("hybrid").model, DIALECTS.snowflake);
    // The ORDERS (hybrid) table's constraints omit NOT ENFORCED.
    const ordersBlock = ddl.split("CREATE HYBRID TABLE")[1] ?? "";
    expect(ddl).toContain("CREATE HYBRID TABLE");
    expect(ordersBlock.split("CREATE")[0]).not.toContain("NOT ENFORCED");
  });

  it("emits the variant keyword (TRANSIENT / TEMPORARY)", () => {
    expect(exportModelDDL(twoTables("transient").model, DIALECTS.snowflake)).toContain("CREATE TRANSIENT TABLE");
    expect(exportModelDDL(twoTables("temporary").model, DIALECTS.snowflake)).toContain("CREATE TEMPORARY TABLE");
  });

  it("Postgres ignores Snowflake-only variants + never emits NOT ENFORCED", () => {
    const ddl = exportModelDDL(twoTables("transient").model, DIALECTS.postgres);
    expect(ddl).toContain("CREATE TABLE"); // not TRANSIENT
    expect(ddl).not.toContain("TRANSIENT");
    expect(ddl).not.toContain("NOT ENFORCED");
  });

  it("round-trips tableKind + enforced byte-identically", () => {
    const { model, childId } = twoTables("hybrid");
    model.relationships[0].enforced = true;
    const once = serializeModel(model);
    expect(once).toContain('"tableKind": "hybrid"');
    expect(once).toContain('"enforced": true');
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);
    expect(childId).toBeTruthy();
  });

  it("warns when a FK is marked enforced on a non-hybrid Snowflake table", () => {
    const { model } = twoTables("standard");
    model.relationships[0].enforced = true;
    const issues = validateWorkspace({ models: [{ id: model.id, name: model.name, model }], links: [], conceptGroups: [] });
    expect(issues.some((i) => i.rule === "snowflakeEnforcement" && i.severity === "warning")).toBe(true);
    // On a hybrid table, no such warning.
    const hybrid = twoTables("hybrid");
    hybrid.model.relationships[0].enforced = true;
    const ok = validateWorkspace({ models: [{ id: hybrid.model.id, name: "x", model: hybrid.model }], links: [], conceptGroups: [] });
    expect(ok.some((i) => i.rule === "snowflakeEnforcement")).toBe(false);
  });
});
