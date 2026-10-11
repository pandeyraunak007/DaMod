// Req 23 Phase 5 — Snowflake governance objects (roles, grants, tags, masking +
// row-access policies, shares): DDL → serialize round-trip → other-dialect
// omission → validation. Policy bodies are author-owned; no secret field exists.
import { describe, it, expect } from "vitest";
import { newModel, newGovernanceObject, type Model, type GovernanceObject } from "../model/model";
import { exportModelDDL } from "./ddl";
import { DIALECTS } from "./dialects";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import { validateWorkspace } from "../validation/rules";

function withGov(objs: GovernanceObject[]): Model {
  const m = newModel("sf_gov", "2026-01-01T00:00:00Z", "Physical", "snowflake");
  m.governanceObjects = objs;
  return m;
}

describe("snowflake governance object DDL", () => {
  it("emits CREATE ROLE plus GRANT ROLE for the hierarchy", () => {
    const role = newGovernanceObject("role", "ANALYST");
    role.grantedRoles = ["READER", "PUBLIC"];
    const ddl = exportModelDDL(withGov([role]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE ROLE "ANALYST"');
    expect(ddl).toContain('GRANT ROLE "READER" TO ROLE "ANALYST";');
    expect(ddl).toContain('GRANT ROLE "PUBLIC" TO ROLE "ANALYST";');
  });

  it("emits a GRANT statement", () => {
    const grant = newGovernanceObject("grant", "g1");
    grant.privilege = "SELECT";
    grant.onObject = "TABLE orders";
    grant.toRole = "ANALYST";
    const ddl = exportModelDDL(withGov([grant]), DIALECTS.snowflake);
    expect(ddl).toContain('GRANT SELECT ON TABLE orders TO ROLE "ANALYST";');
  });

  it("emits CREATE TAG with allowed values", () => {
    const tag = newGovernanceObject("tag", "CLASSIFICATION");
    tag.allowedValues = ["PII", "PUBLIC"];
    const ddl = exportModelDDL(withGov([tag]), DIALECTS.snowflake);
    expect(ddl).toContain(`CREATE TAG "CLASSIFICATION" ALLOWED_VALUES 'PII', 'PUBLIC';`);
  });

  it("emits CREATE MASKING POLICY with the author's expression", () => {
    const p = newGovernanceObject("maskingPolicy", "MASK_SSN");
    p.argType = "STRING";
    p.body = "CASE WHEN current_role() = 'ADMIN' THEN val ELSE '***' END";
    const ddl = exportModelDDL(withGov([p]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE MASKING POLICY "MASK_SSN" AS (val STRING) RETURNS STRING ->');
    expect(ddl).toContain("current_role()");
  });

  it("emits CREATE ROW ACCESS POLICY", () => {
    const p = newGovernanceObject("rowAccessPolicy", "REGION_RAP");
    p.signature = "(region STRING)";
    p.body = "region = current_region()";
    const ddl = exportModelDDL(withGov([p]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE ROW ACCESS POLICY "REGION_RAP" AS (region STRING) RETURNS BOOLEAN ->');
    expect(ddl).toContain("current_region()");
  });

  it("emits CREATE SHARE plus grants and accounts", () => {
    const sh = newGovernanceObject("share", "ANALYTICS_SHARE");
    sh.shareObjects = ["DATABASE analytics"];
    sh.accounts = ["ORG.CONSUMER"];
    const ddl = exportModelDDL(withGov([sh]), DIALECTS.snowflake);
    expect(ddl).toContain('CREATE SHARE "ANALYTICS_SHARE"');
    expect(ddl).toContain('GRANT USAGE ON DATABASE analytics TO SHARE "ANALYTICS_SHARE";');
    expect(ddl).toContain('ALTER SHARE "ANALYTICS_SHARE" ADD ACCOUNTS = ORG.CONSUMER;');
  });

  it("omits the objects (with a count comment) on non-Snowflake dialects", () => {
    const m = withGov([newGovernanceObject("role", "R1"), newGovernanceObject("tag", "T1")]);
    const ddl = exportModelDDL(m, DIALECTS.postgres);
    expect(ddl).toContain("2 Snowflake governance object(s) omitted for Postgres");
    expect(ddl).not.toContain("CREATE ROLE");
  });
});

describe("governance object serialization round-trip", () => {
  it("is byte-identical through serialize → parse → serialize (incl. arrays)", () => {
    const role = newGovernanceObject("role", "ANALYST");
    role.grantedRoles = ["READER"];
    const share = newGovernanceObject("share", "S");
    share.shareObjects = ["DATABASE d"];
    share.accounts = ["A.B"];
    const m = withGov([role, share]);
    const once = serializeModel(m);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeModel(parsed.value)).toBe(once);
    expect(parsed.value.governanceObjects).toHaveLength(2);
    expect(parsed.value.governanceObjects![0].grantedRoles).toEqual(["READER"]);
  });
});

describe("governance object validation", () => {
  it("warns on an incomplete grant, a bodyless policy and an empty share", () => {
    const m = withGov([
      newGovernanceObject("grant", "g"),
      newGovernanceObject("maskingPolicy", "mp"),
      newGovernanceObject("share", "sh"),
    ]);
    const issues = validateWorkspace({ models: [{ id: m.id, name: m.name, model: m }], links: [], conceptGroups: [] });
    const msgs = issues.map((i) => i.message).join("\n");
    expect(msgs).toContain("needs a target object");
    expect(msgs).toContain("needs a role to grant to");
    expect(msgs).toContain("needs an expression");
    expect(msgs).toContain("has no shared objects");
  });
});
