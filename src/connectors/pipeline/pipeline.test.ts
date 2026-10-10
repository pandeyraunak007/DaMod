import { describe, it, expect } from "vitest";
import { planFullLoad, validatePipeline, pipelineReport, targetDdl } from "./planner";
import { serializePipeline, parsePipeline } from "./spec";
import { serializePipelines, parsePipelinesFile, emptyPipelinesDoc } from "./pipelinesPersist";
import { newModel, newEntity, newField, type Model } from "../../model/model";

const NOW = "2026-01-01T00:00:00Z";

function sourceModel(): Model {
  const m = newModel("sales", NOW, "Physical");
  const customer = newEntity("Customer", { x: 0, y: 0 });
  customer.fields = [
    newField("id", "uuid", { primaryKey: true, nullable: false }),
    newField("email", "string", { length: 320, nullable: false }),
  ];
  const order = newEntity("Order", { x: 0, y: 0 });
  order.fields = [
    newField("id", "uuid", { primaryKey: true, nullable: false }),
    newField("total", "decimal", { precision: 12, scale: 2 }),
  ];
  m.entities = [customer, order];
  return m;
}

describe("planFullLoad", () => {
  it("maps selected entities 1:1 to target objects", () => {
    const spec = planFullLoad(sourceModel(), ["Customer"], "postgres", { name: "load_customers" });
    expect(spec.objects).toHaveLength(1);
    const obj = spec.objects[0];
    expect(obj.sourceObject).toBe("Customer");
    expect(obj.targetObject).toBe("Customer");
    const email = obj.columns.find((c) => c.target === "email")!;
    expect(email.source).toBe("email");
    expect(email.targetType).toEqual({ type: "string", length: 320 });
    expect(email.required).toBe(true); // source NOT NULL → required
  });
});

describe("validatePipeline", () => {
  it("passes a clean 1:1 full load", () => {
    const model = sourceModel();
    const spec = planFullLoad(model, ["Customer", "Order"], "postgres", { name: "p" });
    expect(validatePipeline(spec, model)).toEqual([]);
  });

  it("warns on a type mismatch with no transform (no silent inference)", () => {
    const model = sourceModel();
    const spec = planFullLoad(model, ["Order"], "postgres", { name: "p" });
    // Change the target type so it no longer matches the source.
    spec.objects[0].columns.find((c) => c.target === "total")!.targetType = { type: "integer" };
    const issues = validatePipeline(spec, model);
    expect(issues.some((i) => i.severity === "warning" && /type conversion/.test(i.message))).toBe(true);
  });

  it("errors on a required target column with no source", () => {
    const model = sourceModel();
    const spec = planFullLoad(model, ["Customer"], "postgres", { name: "p" });
    spec.objects[0].columns.push({ source: "", target: "loaded_at", targetType: { type: "timestamp" }, required: true });
    const issues = validatePipeline(spec, model);
    expect(issues.some((i) => i.severity === "error" && /no source mapping/.test(i.message))).toBe(true);
  });

  it("errors when a source object drifted away", () => {
    const model = sourceModel();
    const spec = planFullLoad(model, ["Customer"], "postgres", { name: "p" });
    // Simulate drift: the source model no longer has Customer.
    const drifted: Model = { ...model, entities: model.entities.filter((e) => e.name !== "Customer") };
    const issues = validatePipeline(spec, drifted);
    expect(issues.some((i) => i.severity === "error" && /no longer in the model/.test(i.message))).toBe(true);
  });
});

describe("report and target DDL", () => {
  const model = sourceModel();
  const spec = planFullLoad(model, ["Customer"], "postgres", { name: "load" });

  it("renders a deterministic report", () => {
    const r1 = pipelineReport(spec, validatePipeline(spec, model));
    const r2 = pipelineReport(spec, validatePipeline(spec, model));
    expect(r1).toBe(r2);
    expect(r1).toMatch(/Customer → Customer/);
    expect(r1).toMatch(/0 error\(s\)/);
  });

  it("generates target DDL by reusing the DDL generator", () => {
    const ddl = targetDdl(spec);
    expect(ddl).toMatch(/CREATE TABLE "Customer"/);
    expect(ddl).toMatch(/varchar\(320\)/);
  });
});

describe("pipeline persistence", () => {
  it("round-trips a spec deterministically", () => {
    const spec = planFullLoad(sourceModel(), ["Customer", "Order"], "snowflake", { name: "p" });
    const text = serializePipeline(spec);
    const parsed = parsePipeline(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializePipeline(parsed.value)).toBe(text);
  });

  it("round-trips the pipelines doc", () => {
    const spec = planFullLoad(sourceModel(), ["Customer"], "postgres", { name: "p" });
    const doc = { ...emptyPipelinesDoc(), pipelines: [spec] };
    const text = serializePipelines(doc);
    const parsed = parsePipelinesFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializePipelines(parsed.value)).toBe(text);
  });
});
