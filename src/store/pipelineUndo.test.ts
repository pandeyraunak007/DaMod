// ETL G-UNDO: per-pipeline undo/redo in the ETL Designer. History is transient
// (session-only) and keyed by pipeline id. commitPipelines only writes to disk when a
// workspace path is set, so with path:null these run purely in memory.
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import { PIPELINE_SPEC_VERSION, type PipelineSpec } from "../connectors/pipeline/spec";

const ws = () => useWorkspaceStore.getState();

function spec(id: string, name: string): PipelineSpec {
  return {
    specVersion: PIPELINE_SPEC_VERSION,
    id,
    name,
    source: { modelId: "m1", modelName: "sales" },
    target: { platform: "postgres" },
    loadStrategy: "full",
    objects: [],
    joins: [],
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ pipelines: [], pipelineHistory: {}, path: null });
});

describe("pipeline undo/redo (G-UNDO)", () => {
  it("records no history for a new pipeline, then undoes/redoes edits in order", async () => {
    await ws().upsertPipeline(spec("p1", "v1")); // brand new → no prior version
    expect(ws().pipelineHistory["p1"]).toBeUndefined();

    await ws().upsertPipeline(spec("p1", "v2"));
    await ws().upsertPipeline(spec("p1", "v3"));
    expect(ws().pipelineHistory["p1"].past.length).toBe(2);
    expect(ws().pipelines[0].name).toBe("v3");

    await ws().undoPipeline("p1");
    expect(ws().pipelines[0].name).toBe("v2");
    await ws().undoPipeline("p1");
    expect(ws().pipelines[0].name).toBe("v1");
    expect(ws().pipelineHistory["p1"].past).toHaveLength(0);
    expect(ws().pipelineHistory["p1"].future).toHaveLength(2);

    await ws().redoPipeline("p1");
    expect(ws().pipelines[0].name).toBe("v2");
    await ws().redoPipeline("p1");
    expect(ws().pipelines[0].name).toBe("v3");
    expect(ws().pipelineHistory["p1"].future).toHaveLength(0);
  });

  it("a fresh edit after undo clears the redo stack", async () => {
    await ws().upsertPipeline(spec("p1", "v1"));
    await ws().upsertPipeline(spec("p1", "v2"));
    await ws().undoPipeline("p1"); // back to v1, future = [v2]
    expect(ws().pipelineHistory["p1"].future).toHaveLength(1);
    await ws().upsertPipeline(spec("p1", "v3")); // diverge → redo stack dropped
    expect(ws().pipelineHistory["p1"].future).toHaveLength(0);
    expect(ws().pipelines[0].name).toBe("v3");
  });

  it("undo is a no-op with empty history; delete clears the pipeline's history", async () => {
    await ws().upsertPipeline(spec("p1", "v1"));
    await ws().undoPipeline("p1"); // nothing to undo yet
    expect(ws().pipelines[0].name).toBe("v1");

    await ws().upsertPipeline(spec("p1", "v2"));
    expect(ws().pipelineHistory["p1"].past).toHaveLength(1);
    await ws().deletePipeline("p1");
    expect(ws().pipelineHistory["p1"]).toBeUndefined();
    expect(ws().pipelines).toHaveLength(0);
  });

  it("keeps per-pipeline histories independent", async () => {
    await ws().upsertPipeline(spec("p1", "a1"));
    await ws().upsertPipeline(spec("p2", "b1"));
    await ws().upsertPipeline(spec("p1", "a2"));
    expect(ws().pipelineHistory["p1"].past).toHaveLength(1);
    expect(ws().pipelineHistory["p2"]).toBeUndefined(); // p2 never edited
    await ws().undoPipeline("p1");
    expect(ws().pipelines.find((p) => p.id === "p1")!.name).toBe("a1");
    expect(ws().pipelines.find((p) => p.id === "p2")!.name).toBe("b1"); // untouched
  });
});
