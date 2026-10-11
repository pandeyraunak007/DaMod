// Gap G8 — the dialectIdentifierIssues validation rule (reserved words + length), scoped
// to the model's dialect and to physical levels. Warnings, never blocking.
import { describe, it, expect } from "vitest";
import { validateWorkspace } from "./rules";
import { newModel, newEntity, newField, type Model } from "../model/model";

function ctx(model: Model) {
  return { models: [{ id: model.id, name: model.name, model }], links: [], conceptGroups: [] };
}

function withNames(dialect: Parameters<typeof newModel>[3], entityName: string, fieldName: string, level: Parameters<typeof newModel>[2] = "Physical"): Model {
  const m = newModel("m", "2026-01-01T00:00:00Z", level, dialect);
  const e = newEntity(entityName, { x: 0, y: 0 });
  e.fields.push(newField(fieldName, "integer"));
  m.entities.push(e);
  return m;
}

const rule = (model: Model) => validateWorkspace(ctx(model)).filter((i) => i.rule === "dialectIdentifierIssues");

describe("dialectIdentifierIssues", () => {
  it("flags a reserved-word table name for the model's dialect (warning)", () => {
    const issues = rule(withNames("postgres", "Order", "amount"));
    expect(issues.some((i) => i.message.includes("reserved word") && i.message.includes("Order"))).toBe(true);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("flags an over-length name against the dialect's limit (Oracle 30)", () => {
    const long = "very_long_identifier_exceeding_thirty_chars";
    const ora = rule(withNames("oracle", "T", long));
    expect(ora.some((i) => i.message.includes("exceeds") && i.message.includes("oracle"))).toBe(true);
    // Same name on Postgres (limit 63) is NOT flagged for length.
    const pg = rule(withNames("postgres", "T", long));
    expect(pg.some((i) => i.message.includes("exceeds"))).toBe(false);
  });

  it("does not run at conceptual level (identifiers are a physical concern)", () => {
    expect(rule(withNames("postgres", "Order", "amount", "Conceptual"))).toHaveLength(0);
  });

  it("is silent for clean physical names", () => {
    expect(rule(withNames("postgres", "customer", "customer_id"))).toHaveLength(0);
  });
});
