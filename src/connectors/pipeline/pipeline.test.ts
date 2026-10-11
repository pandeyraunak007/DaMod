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

import { columnFromField } from "./planner";
import type { PipelineSpec } from "./spec";

// Deep-clone a spec so edits don't mutate the plan under test.
function edit(spec: PipelineSpec, fn: (s: PipelineSpec) => void): PipelineSpec {
  const copy: PipelineSpec = JSON.parse(JSON.stringify(spec));
  fn(copy);
  return copy;
}

describe("source-to-target mapping edits (Req 22 §8)", () => {
  it("columnFromField builds an identity mapping", () => {
    const c = columnFromField({ name: "total", type: "decimal", precision: 12, scale: 2, nullable: false });
    expect(c).toEqual({ source: "total", target: "total", sourceType: { type: "decimal", precision: 12, scale: 2 }, targetType: { type: "decimal", precision: 12, scale: 2 }, required: true });
  });

  it("flags a type conversion without a transform, and clears it with one", () => {
    const model = sourceModel();
    const base = planFullLoad(model, ["Order"], "postgres", { name: "load_orders" });
    // Change target type of `total` decimal -> string with NO transform.
    const converted = edit(base, (s) => {
      const col = s.objects[0].columns.find((c) => c.target === "total")!;
      col.targetType = { type: "string", length: 20 };
    });
    expect(validatePipeline(converted, model).some((i) => i.severity === "warning" && /type conversion/.test(i.message))).toBe(true);
    // Add an explicit transform -> the conversion warning is resolved.
    const withXform = edit(converted, (s) => {
      s.objects[0].columns.find((c) => c.target === "total")!.transform = "CAST(total AS VARCHAR)";
    });
    expect(validatePipeline(withXform, model).some((i) => /type conversion/.test(i.message))).toBe(false);
  });

  it("errors on a required target column with no source mapping", () => {
    const model = sourceModel();
    const base = planFullLoad(model, ["Order"], "postgres", { name: "p" });
    const added = edit(base, (s) => {
      s.objects[0].columns.push({ source: "", target: "loaded_at", targetType: { type: "timestamp" }, required: true });
    });
    const issues = validatePipeline(added, model);
    expect(issues.some((i) => i.severity === "error" && /no source mapping/.test(i.message))).toBe(true);
  });

  it("renaming/dropping columns flows into the report, target DDL and round-trips", () => {
    const model = sourceModel();
    const base = planFullLoad(model, ["Customer"], "postgres", { name: "load_customers" });
    const mapped = edit(base, (s) => {
      const o = s.objects[0];
      o.targetObject = "dim_customer";
      o.columns = o.columns.filter((c) => c.target !== "id"); // drop id
      o.columns.find((c) => c.target === "email")!.target = "email_address"; // rename
    });
    const report = pipelineReport(mapped, validatePipeline(mapped, model));
    expect(report).toContain("Customer → dim_customer");
    expect(report).toContain("email_address");
    expect(report).not.toContain(" id ("); // dropped
    const ddl = targetDdl(mapped);
    expect(ddl).toContain('"dim_customer"');
    expect(ddl).toContain('"email_address"');
    // Deterministic round-trip of the edited spec.
    const once = serializePipeline(mapped);
    const parsed = parsePipeline(JSON.parse(once));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializePipeline(parsed.value)).toBe(once);
  });
});

describe("joins + filters (Req 22 §8.6)", () => {
  it("validates filters: unknown column + value-op needing a value", () => {
    const model = sourceModel();
    const base = planFullLoad(model, ["Order"], "postgres", { name: "p" });
    const filtered = edit(base, (s) => {
      s.objects[0].filters = [
        { column: "nope", op: "=", value: "1" }, // unknown column
        { column: "total", op: ">", value: "" }, // needs a value
        { column: "total", op: "is not null" }, // ok, no value needed
      ];
    });
    const issues = validatePipeline(filtered, model);
    expect(issues.some((i) => /unknown column/.test(i.message))).toBe(true);
    expect(issues.some((i) => /needs a value/.test(i.message))).toBe(true);
    // The valid filter contributes no error.
    const forValid = issues.filter((i) => /is not null/.test(i.message));
    expect(forValid).toHaveLength(0);
  });

  it("validates joins against the model and reports them", () => {
    const model = sourceModel();
    const base = planFullLoad(model, ["Customer", "Order"], "postgres", { name: "p" });
    const joined = edit(base, (s) => {
      s.joins = [{ leftObject: "Order", leftColumn: "id", rightObject: "Customer", rightColumn: "id", kind: "inner" }];
    });
    expect(validatePipeline(joined, model)).toHaveLength(0);
    expect(pipelineReport(joined, []).replace(/\s+/g, " ")).toContain("Order.id inner join Customer.id");

    const broken = edit(joined, (s) => {
      s.joins[0].rightColumn = "ghost";
      s.joins.push({ leftObject: "Order", leftColumn: "x", rightObject: "Missing", rightColumn: "y", kind: "left" });
    });
    const issues = validatePipeline(broken, model);
    expect(issues.some((i) => /Join column “Customer.ghost” not found/.test(i.message))).toBe(true);
    expect(issues.some((i) => /unknown object “Missing”/.test(i.message))).toBe(true);
  });

  it("round-trips a spec with joins + filters deterministically", () => {
    const model = sourceModel();
    const spec = edit(planFullLoad(model, ["Customer", "Order"], "postgres", { name: "p" }), (s) => {
      s.objects[0].filters = [{ column: "email", op: "is not null" }];
      s.joins = [{ leftObject: "Order", leftColumn: "id", rightObject: "Customer", rightColumn: "id", kind: "left" }];
    });
    const once = serializePipeline(spec);
    expect(once).toContain('"joins"');
    expect(once).toContain('"filters"');
    const parsed = parsePipeline(JSON.parse(once));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializePipeline(parsed.value)).toBe(once);
  });
});
