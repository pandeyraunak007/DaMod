// #1 — opt-in Postgres CREATE DOMAIN DDL + reverse-engineering round-trip.
import { describe, it, expect } from "vitest";
import { newModel, newEntity, newField, newDomain, type Model } from "../model/model";
import { exportModelDDL } from "./ddl";
import { DIALECTS } from "./dialects";
import { parseDdl } from "../import/reverse";

function modelWithDomain(): Model {
  const m = newModel("shop", "2026-01-01T00:00:00Z", "Physical", "postgres");
  const dom = newDomain("money_amt", "decimal");
  dom.precision = 15;
  dom.scale = 2;
  dom.default = "0";
  m.domains = [dom];
  const e = newEntity("invoice", { x: 0, y: 0 });
  e.fields.push(newField("id", "integer", { primaryKey: true, nullable: false }));
  const amount = newField("amount", "decimal", { precision: 15, scale: 2 });
  amount.domainId = dom.id;
  e.fields.push(amount);
  m.entities.push(e);
  return m;
}

describe("opt-in CREATE DOMAIN (Postgres)", () => {
  it("off by default: no CREATE DOMAIN, column uses the inline base type (unchanged output)", () => {
    const ddl = exportModelDDL(modelWithDomain(), DIALECTS.postgres);
    expect(ddl).not.toContain("CREATE DOMAIN");
    expect(ddl).toContain('"amount" numeric(15,2)');
  });

  it("opt-in: emits CREATE DOMAIN and the column references the domain name", () => {
    const ddl = exportModelDDL(modelWithDomain(), DIALECTS.postgres, { useDomains: true });
    expect(ddl).toContain('CREATE DOMAIN "money_amt" AS numeric(15,2) DEFAULT 0;');
    expect(ddl).toContain('"amount" "money_amt"');
    expect(ddl).not.toContain('"amount" numeric(15,2)'); // now the domain, not the base type
  });

  it("non-Postgres ignores useDomains (inline base type, no CREATE DOMAIN)", () => {
    const ddl = exportModelDDL(modelWithDomain(), DIALECTS.snowflake, { useDomains: true });
    expect(ddl).not.toContain("CREATE DOMAIN");
    expect(ddl).toContain("NUMBER(15,2)");
  });
});

describe("reverse-engineering CREATE DOMAIN", () => {
  it("parses a domain and binds columns typed as that domain", () => {
    const sql = `
      CREATE DOMAIN money_amt AS numeric(15,2) DEFAULT 0 NOT NULL;
      CREATE TABLE invoice (
        id integer PRIMARY KEY,
        amount money_amt
      );
    `;
    const { model } = parseDdl(sql, "shop", "2026-01-01T00:00:00Z");
    expect(model.domains).toHaveLength(1);
    const dom = model.domains![0];
    expect(dom.name).toBe("money_amt");
    expect(dom.type).toBe("decimal");
    expect(dom.precision).toBe(15);
    expect(dom.scale).toBe(2);
    expect(dom.default).toBe("0");

    const amount = model.entities[0].fields.find((f) => f.name === "amount")!;
    expect(amount.domainId).toBe(dom.id);
    expect(amount.type).toBe("decimal"); // inherited the domain's base type
    expect(amount.precision).toBe(15);
  });

  it("round-trips: export with useDomains then re-parse recovers the domain binding", () => {
    const original = modelWithDomain();
    const ddl = exportModelDDL(original, DIALECTS.postgres, { useDomains: true });
    const { model } = parseDdl(ddl, "shop", "2026-01-01T00:00:00Z");
    expect(model.domains!.map((d) => d.name)).toContain("money_amt");
    const amount = model.entities.find((e) => e.name === "invoice")!.fields.find((f) => f.name === "amount")!;
    expect(amount.domainId).toBe(model.domains![0].id);
  });
});
