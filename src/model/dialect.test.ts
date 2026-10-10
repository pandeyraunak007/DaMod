import { describe, it, expect } from "vitest";
import { newModel, modelDialect } from "./model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";

// Req 17 — a model carries its target database dialect, and it is authoritative.
describe("model dialect (Req 17)", () => {
  it("stores the dialect on a physical model", () => {
    const m = newModel("orders", "2026-01-01T00:00:00Z", "Physical", "snowflake");
    expect(m.dialect).toBe("snowflake");
    expect(modelDialect(m)).toBe("snowflake");
  });

  it("stores the dialect on a physical/logical model", () => {
    const m = newModel("orders", "2026-01-01T00:00:00Z", "Physical/Logical", "databricks");
    expect(m.dialect).toBe("databricks");
  });

  it("ignores a dialect for database-independent levels (Conceptual/Logical)", () => {
    expect(newModel("c", "t", "Conceptual", "snowflake").dialect).toBeUndefined();
    expect(newModel("l", "t", "Logical", "postgres").dialect).toBeUndefined();
  });

  it("defaults to postgres when a model carries no dialect (compatibility)", () => {
    const m = newModel("legacy", "2026-01-01T00:00:00Z", "Physical");
    expect(m.dialect).toBeUndefined();
    expect(modelDialect(m)).toBe("postgres");
  });

  it("round-trips the dialect byte-identically", () => {
    const m = newModel("orders", "2026-01-01T00:00:00Z", "Physical", "snowflake");
    const once = serializeModel(m);
    expect(once).toContain('"dialect": "snowflake"');
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.dialect).toBe("snowflake");
    expect(serializeModel(parsed.value)).toBe(once);
  });

  it("parses an older model with no dialect without changing it (no silent migration)", () => {
    const legacy = serializeModel(newModel("legacy", "2026-01-01T00:00:00Z", "Physical"));
    expect(legacy).not.toContain('"dialect"');
    const parsed = parseModelFile(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.dialect).toBeUndefined();
    // Re-serialising must not inject a dialect.
    expect(serializeModel(parsed.value)).toBe(legacy);
  });
});
