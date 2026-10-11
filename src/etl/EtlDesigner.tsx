import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { PipelineCanvas } from "./PipelineCanvas";
import { deriveStarterGraph } from "./graphBuild";
import { inferNodeSchemas } from "../connectors/pipeline/graph";
import { formatType } from "../model/dataTypes";
import type { Model } from "../model/model";
import type { PipelineSpec } from "../connectors/pipeline/spec";

// ETL Designer workspace (Phase 3 Slice B). A top-level view (swapped in by App via
// uiStore.etlDesignerOpen, mirroring the Semantic view) with its own pipeline canvas.
// Left: pipeline list. Center: the DAG canvas. Right: selected-node schema + the live
// graph validation. Read-only canvas for now (B1); editing follows in B2.
export function EtlDesigner() {
  const pipelines = useWorkspaceStore((s) => s.pipelines);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const upsertPipeline = useWorkspaceStore((s) => s.upsertPipeline);
  const close = useUiStore((s) => s.setEtlDesignerOpen);

  const [pipelineId, setPipelineId] = useState<string | null>(pipelines[0]?.id ?? null);
  const [nodeId, setNodeId] = useState<string | null>(null);

  const spec = pipelines.find((p) => p.id === pipelineId) ?? null;
  const model: Model | undefined = spec ? allModels().find((m) => m.id === spec.source.modelId)?.model : undefined;

  const graph = useMemo(() => (spec && model ? inferNodeSchemas(spec, model) : null), [spec, model]);
  const hasGraph = !!(spec?.nodes && spec.nodes.length);

  const createStarter = () => {
    if (!spec) return;
    const { nodes, edges } = deriveStarterGraph(spec);
    void upsertPipeline({ ...spec, nodes, edges } as PipelineSpec);
    setNodeId(null);
  };

  return (
    <div className="etl">
      <div className="panel-head">
        <span className="panel-head__title">ETL Designer</span>
        <button className="btn btn--small" onClick={() => close(false)}>← Back to modeling</button>
      </div>

      <div className="etl__body">
        <aside className="etl__left">
          <div className="panel-head"><span className="panel-head__title">Pipelines</span></div>
          {pipelines.length === 0 && <p className="side__hint">No pipelines yet — create one from the Data ribbon’s Pipelines dialog.</p>}
          <ul className="etl__list">
            {pipelines.map((p) => (
              <li key={p.id}>
                <button
                  className={`etl__list-item ${p.id === pipelineId ? "etl__list-item--active" : ""}`}
                  onClick={() => { setPipelineId(p.id); setNodeId(null); }}
                >
                  {p.name}
                  <span className="field__hint"> · {p.nodes?.length ?? 0} node(s)</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="etl__center">
          {!spec ? (
            <div className="side__empty"><p>Select a pipeline.</p></div>
          ) : !hasGraph ? (
            <div className="side__empty">
              <p>This pipeline has no visual graph yet.</p>
              <button className="btn btn--primary btn--small" onClick={createStarter}>Create starter graph</button>
              <p className="side__hint">Derives source→target nodes from the pipeline’s objects. You can edit them next.</p>
            </div>
          ) : (
            <PipelineCanvas spec={spec} selectedId={nodeId} onSelect={setNodeId} />
          )}
        </main>

        <aside className="etl__right">
          <div className="panel-head"><span className="panel-head__title">{nodeId ? "Node schema" : "Pipeline"}</span></div>
          {!model && spec && (
            <p className="field__hint field__hint--warn">Open source model “{spec.source.modelName}” to infer schemas.</p>
          )}
          {nodeId && graph ? (
            <div className="etl__schema">
              {(graph.schemas.get(nodeId) ?? []).map((f) => (
                <div key={f.name} className="etl__field">
                  <span>{f.name}</span>
                  <span className="field__hint">{f.type ? formatType(f.type as never) : "—"}</span>
                </div>
              ))}
              {(graph.schemas.get(nodeId) ?? []).length === 0 && <p className="side__hint">No fields.</p>}
            </div>
          ) : (
            <p className="side__hint">Select a node to see its inferred output schema.</p>
          )}
        </aside>
      </div>

      {graph && (
        <div className="etl__diagnostics">
          <span className="panel-head__title">
            Validation: {graph.issues.filter((i) => i.severity === "error").length} error(s),{" "}
            {graph.issues.filter((i) => i.severity === "warning").length} warning(s)
          </span>
          <ul className="etl__issues">
            {graph.issues.map((i, k) => (
              <li key={k} className={i.severity === "error" ? "field__hint--warn" : "field__hint"}>
                [{i.severity}] {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
