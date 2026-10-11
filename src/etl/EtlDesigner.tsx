import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { PipelineCanvas } from "./PipelineCanvas";
import { NodeInspector } from "./NodeInspector";
import { deriveStarterGraph } from "./graphBuild";
import { addGraphNode, updateGraphNode } from "./graphEdit";
import { inferNodeSchemas, type GraphField } from "../connectors/pipeline/graph";
import { graphSql } from "../connectors/pipeline/graphSql";
import { formatType } from "../model/dataTypes";
import type { Model } from "../model/model";
import { NODE_KINDS, type NodeKind, type PipelineSpec, type PipelineNode } from "../connectors/pipeline/spec";

const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);

// ETL Designer workspace (Phase 3 Slice B). Top-level view (swapped in by App via
// uiStore.etlDesignerOpen). Left: pipeline list + node palette. Center: editable DAG
// canvas. Right: selected-node config (NodeInspector) + its inferred output schema.
// Bottom: live graph validation. All edits persist via upsertPipeline (no model undo).
export function EtlDesigner() {
  const pipelines = useWorkspaceStore((s) => s.pipelines);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const upsertPipeline = useWorkspaceStore((s) => s.upsertPipeline);
  const undoPipeline = useWorkspaceStore((s) => s.undoPipeline);
  const redoPipeline = useWorkspaceStore((s) => s.redoPipeline);
  const pipelineHistory = useWorkspaceStore((s) => s.pipelineHistory);
  const close = useUiStore((s) => s.setEtlDesignerOpen);

  const [pipelineId, setPipelineId] = useState<string | null>(pipelines[0]?.id ?? null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  const spec = pipelines.find((p) => p.id === pipelineId) ?? null;
  const model: Model | undefined = spec ? allModels().find((m) => m.id === spec.source.modelId)?.model : undefined;

  const graph = useMemo(() => (spec && model ? inferNodeSchemas(spec, model) : null), [spec, model]);
  const sql = useMemo(() => (spec && model ? graphSql(spec, model) : null), [spec, model]);
  const hasGraph = !!(spec?.nodes && spec.nodes.length);
  const selectedNode = spec?.nodes?.find((n) => n.id === nodeId) ?? null;

  const save = (next: PipelineSpec) => { setError(null); void upsertPipeline(next); };

  const hist = pipelineId ? pipelineHistory[pipelineId] : undefined;
  const canUndo = !!hist?.past.length;
  const canRedo = !!hist?.future.length;

  // ⌘Z / ⌘⇧Z undo-redo, scoped to the open pipeline (App yields these keys while the
  // Designer is open). Ignore while typing in an input (node inspector fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pipelineId) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      e.preventDefault();
      if (e.shiftKey) void redoPipeline(pipelineId);
      else void undoPipeline(pipelineId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pipelineId, undoPipeline, redoPipeline]);

  const createStarter = () => {
    if (!spec) return;
    const { nodes, edges } = deriveStarterGraph(spec);
    save({ ...spec, nodes, edges });
  };

  const addNode = (kind: NodeKind) => {
    if (!spec) return;
    const node: PipelineNode = { id: uid("n_"), kind, label: kind };
    save(addGraphNode(spec, node));
  };

  // Input schema for the selected node = union of its upstream nodes' output schemas.
  const inputSchema: GraphField[] = useMemo(() => {
    if (!spec || !graph || !nodeId) return [];
    const froms = (spec.edges ?? []).filter((e) => e.to === nodeId).map((e) => e.from);
    return froms.flatMap((f) => graph.schemas.get(f) ?? []);
  }, [spec, graph, nodeId]);

  return (
    <div className="etl">
      <div className="panel-head">
        <span className="panel-head__title">ETL Designer</span>
        {spec && (
          <>
            <button className="btn btn--small" disabled={!canUndo} title="Undo (⌘Z)" onClick={() => pipelineId && void undoPipeline(pipelineId)}>↶ Undo</button>
            <button className="btn btn--small" disabled={!canRedo} title="Redo (⌘⇧Z)" onClick={() => pipelineId && void redoPipeline(pipelineId)}>↷ Redo</button>
          </>
        )}
        {hasGraph && (
          <button className={`btn btn--small ${sqlOpen ? "btn--primary" : ""}`} onClick={() => setSqlOpen((v) => !v)}>
            {sqlOpen ? "Canvas" : "SQL"}
          </button>
        )}
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
                  {p.name}<span className="field__hint"> · {p.nodes?.length ?? 0} node(s)</span>
                </button>
              </li>
            ))}
          </ul>
          {spec && hasGraph && (
            <>
              <div className="panel-head"><span className="panel-head__title">Add node</span></div>
              <div className="etl__palette">
                {NODE_KINDS.map((k) => (
                  <button key={k} className="btn btn--small" onClick={() => addNode(k)}>+ {k}</button>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="etl__center">
          {!spec ? (
            <div className="side__empty"><p>Select a pipeline.</p></div>
          ) : !hasGraph ? (
            <div className="side__empty">
              <p>This pipeline has no visual graph yet.</p>
              <button className="btn btn--primary btn--small" onClick={createStarter}>Create starter graph</button>
              <p className="side__hint">Derives source→target nodes from the pipeline’s objects. Then edit on the canvas.</p>
            </div>
          ) : sqlOpen ? (
            <div className="etl__sql">
              <button className="btn btn--small" onClick={() => navigator.clipboard?.writeText(sql?.sql ?? "")}>Copy SQL</button>
              <pre className="export-preview">
                {sql?.sql}
                {sql && sql.unsupported.length ? `\n-- Notes:\n${sql.unsupported.map((u) => `-- ${u}`).join("\n")}\n` : ""}
              </pre>
            </div>
          ) : (
            <PipelineCanvas spec={spec} selectedId={nodeId} onSelect={setNodeId} onChange={save} onError={setError} />
          )}
          {error && <p className="etl__error field__hint--warn">{error}</p>}
        </main>

        <aside className="etl__right">
          <div className="panel-head"><span className="panel-head__title">{selectedNode ? `${selectedNode.kind} node` : "Pipeline"}</span></div>
          {!model && spec && <p className="field__hint field__hint--warn">Open source model “{spec.source.modelName}” to infer schemas.</p>}
          {selectedNode && spec ? (
            <>
              <NodeInspector
                node={selectedNode}
                model={model}
                inputSchema={inputSchema}
                onChange={(patch) => save(updateGraphNode(spec, selectedNode.id, patch))}
              />
              <div className="panel-head"><span className="panel-head__title">Output schema</span></div>
              <div className="etl__schema">
                {(graph?.schemas.get(selectedNode.id) ?? []).map((f) => (
                  <div key={f.name} className="etl__field"><span>{f.name}</span><span className="field__hint">{f.type ? formatType(f.type as never) : "—"}</span></div>
                ))}
                {(graph?.schemas.get(selectedNode.id) ?? []).length === 0 && <p className="side__hint">No fields.</p>}
              </div>
            </>
          ) : (
            <p className="side__hint">Select a node to configure it and see its inferred schema. Drag to move, drag between nodes to connect, Delete to remove.</p>
          )}
        </aside>
      </div>

      {graph && (
        <div className="etl__diagnostics">
          <span className="panel-head__title">
            Validation: {graph.issues.filter((i) => i.severity === "error").length} error(s), {graph.issues.filter((i) => i.severity === "warning").length} warning(s)
          </span>
          <ul className="etl__issues">
            {graph.issues.map((i, k) => (
              <li key={k} className={i.severity === "error" ? "field__hint--warn" : "field__hint"}>[{i.severity}] {i.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
