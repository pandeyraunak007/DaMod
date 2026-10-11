// ETL Phase 2 — pipeline persistence hardening: version gate + migration shim, and
// the additive optional `layout` field (deterministic, omit-empty, backward-compatible).
import { describe, it, expect } from "vitest";
import { planFullLoad } from "./planner";
import { serializePipeline, parsePipeline } from "./spec";
import { serializePipelines, parsePipelinesFile, emptyPipelinesDoc, migratePipelinesDoc } from "./pipelinesPersist";
import { newModel, newEntity, newField, type Model } from "../../model/model";

const NOW = "2026-01-01T00:00:00Z";
function model(): Model {
  const m = newModel("sales", NOW, "Physical");
  const e = newEntity("Customer", { x: 0, y: 0 });
  e.fields = [newField("id", "uuid", { primaryKey: true, nullable: false })];
  m.entities = [e];
  return m;
}

describe("pipelines.json version gate", () => {
  it("rejects a file from a newer format version with a clear message", () => {
    const r = parsePipelinesFile(JSON.stringify({ formatVersion: 99, pipelines: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("newer than this app supports");
  });

  it("rejects a missing/invalid formatVersion", () => {
    expect(parsePipelinesFile(JSON.stringify({ pipelines: [] })).ok).toBe(false);
    expect(parsePipelinesFile("not json").ok).toBe(false);
  });

  it("round-trips a current-version document", () => {
    const doc = emptyPipelinesDoc();
    doc.pipelines.push(planFullLoad(model(), ["Customer"], "postgres", { name: "p" }));
    const text = serializePipelines(doc);
    const parsed = parsePipelinesFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializePipelines(parsed.value)).toBe(text);
  });

  it("migratePipelinesDoc returns the same ref when nothing needs upgrading", () => {
    const raw = { formatVersion: 1, pipelines: [] };
    expect(migratePipelinesDoc(raw)).toBe(raw);
  });

  it("upgrades a pre-v2 (flat) spec to v2 and seeds a starter graph on load", () => {
    const v1 = {
      specVersion: 1,
      id: "p_legacy00",
      name: "legacy",
      source: { modelId: "m_x", modelName: "m" },
      target: { platform: "postgres" },
      loadStrategy: "full",
      objects: [
        { sourceObject: "Customer", targetObject: "Customer", columns: [{ source: "id", target: "id", targetType: { type: "uuid" }, required: true }], filters: [] },
      ],
      joins: [],
    };
    const parsed = parsePipelinesFile(JSON.stringify({ formatVersion: 1, pipelines: [v1] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = parsed.value.pipelines[0];
    expect(p.specVersion).toBe(2); // upgraded
    expect((p.nodes ?? []).length).toBeGreaterThan(0); // starter graph derived
    expect(p.nodes!.some((n) => n.kind === "source" && n.sourceObject === "Customer")).toBe(true);
    expect(p.objects).toHaveLength(1); // flat objects retained (tabular editor still works)
  });

  it("does not clobber a pre-v2 spec that already has a graph", () => {
    const v1 = {
      specVersion: 1, id: "p_x", name: "g", source: { modelId: "m", modelName: "m" },
      target: { platform: "postgres" }, loadStrategy: "full", objects: [], joins: [],
      nodes: [{ id: "keep", kind: "source", sourceObject: "X" }], edges: [],
    };
    const r = migratePipelinesDoc({ formatVersion: 1, pipelines: [v1] });
    const p = (r.pipelines as Record<string, unknown>[])[0];
    expect((p.nodes as { id: string }[])[0].id).toBe("keep"); // existing graph preserved
    expect(p.specVersion).toBe(2);
  });
});

describe("optional layout field", () => {
  it("is omitted when empty and round-trips byte-identically with nodes", () => {
    const spec = planFullLoad(model(), ["Customer"], "postgres", { name: "p" });
    // No layout → not serialized.
    expect(serializePipeline(spec)).not.toContain("layout");

    spec.layout = { nodes: [{ id: "n_b", x: 10, y: 20 }, { id: "n_a", x: 1, y: 2 }] };
    const once = serializePipeline(spec);
    expect(once).toContain('"layout"');
    // nodes sorted by id for determinism (n_a before n_b).
    expect(once.indexOf('"n_a"')).toBeLessThan(once.indexOf('"n_b"'));
    const parsed = parsePipeline(JSON.parse(once));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializePipeline(parsed.value)).toBe(once);
      expect(parsed.value.layout!.nodes).toHaveLength(2);
    }
  });

  it("older specs without layout still parse (backward compatible)", () => {
    const spec = planFullLoad(model(), ["Customer"], "postgres", { name: "p" });
    const plain = JSON.parse(serializePipeline(spec));
    expect("layout" in plain).toBe(false);
    expect(parsePipeline(plain).ok).toBe(true);
  });
});
