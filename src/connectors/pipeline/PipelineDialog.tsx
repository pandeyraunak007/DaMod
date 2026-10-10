import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { DIALECT_IDS, DIALECTS, type DialectId } from "../../export/dialects";
import { joinPath, writeFile } from "../../persist/fs";
import { validateIdentifier } from "../../model/identifiers";
import type { Model } from "../../model/model";
import { planFullLoad, validatePipeline, pipelineReport, targetDdl } from "./planner";
import type { PipelineSpec } from "./spec";

// Pipeline designer (§6.D). Pick a saved model, choose objects + a target, plan a
// full load, review mappings + validation + target DDL, and save a spec. The
// planner consumes the already-discovered model — it never re-runs discovery.
export function PipelineDialog({ onClose }: { onClose: () => void }) {
  const pipelines = useWorkspaceStore((s) => s.pipelines);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(pipelines.length === 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--map" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Pipeline designer</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="conn__layout">
          <div className="conn__list">
            {pipelines.map((p) => (
              <button
                key={p.id}
                className={`conn__item ${p.id === selectedId && !creating ? "conn__item--active" : ""}`}
                onClick={() => {
                  setSelectedId(p.id);
                  setCreating(false);
                }}
              >
                <strong>{p.name}</strong>
                <span className="field__hint">{p.source.modelName} → {p.target.platform}</span>
              </button>
            ))}
            {pipelines.length === 0 && <p className="side__hint">No pipelines yet.</p>}
            <button className="btn btn--small" onClick={() => setCreating(true)}>+ New pipeline</button>
          </div>
          <div className="conn__panel">
            {creating ? (
              <NewPipeline onCreated={(id) => { setSelectedId(id); setCreating(false); }} />
            ) : selectedId ? (
              <PipelineView id={selectedId} onDeleted={() => setSelectedId(null)} />
            ) : (
              <p className="side__hint">Select or create a pipeline.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewPipeline({ onCreated }: { onCreated: (id: string) => void }) {
  const allModels = useWorkspaceStore((s) => s.allModels);
  const upsertPipeline = useWorkspaceStore((s) => s.upsertPipeline);
  const models = allModels();

  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [name, setName] = useState("new_pipeline");
  const [platform, setPlatform] = useState<DialectId>("postgres");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const model = models.find((m) => m.id === modelId)?.model;
  const nameError = validateIdentifier(name);

  const save = async () => {
    if (!model || nameError || picked.size === 0) return;
    const spec = planFullLoad(model, [...picked], platform, { name });
    await upsertPipeline(spec);
    onCreated(spec.id);
  };

  return (
    <div>
      <div className="field">
        <label>Name</label>
        <input className={nameError ? "is-error" : ""} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="modal__row modal__row--pair">
        <div className="field">
          <label>Source model</label>
          <select value={modelId} onChange={(e) => { setModelId(e.target.value); setPicked(new Set()); }}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Target platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as DialectId)}>
            {DIALECT_IDS.map((id) => <option key={id} value={id}>{DIALECTS[id].label}</option>)}
          </select>
        </div>
      </div>
      {model && (
        <div className="field">
          <label>Objects to load</label>
          <div className="conn__schemas">
            {model.entities.map((e) => (
              <label key={e.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={picked.has(e.name)}
                  onChange={(ev) => {
                    const next = new Set(picked);
                    if (ev.target.checked) next.add(e.name);
                    else next.delete(e.name);
                    setPicked(next);
                  }}
                />
                {e.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="modal__actions">
        <button className="btn btn--primary" onClick={save} disabled={!model || !!nameError || picked.size === 0}>
          Plan full load &amp; save
        </button>
      </div>
      {!model && <p className="field__hint field__hint--warn">Open a model first.</p>}
    </div>
  );
}

function PipelineView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const spec = useWorkspaceStore((s) => s.pipelines.find((p) => p.id === id)) as PipelineSpec | undefined;
  const allModels = useWorkspaceStore((s) => s.allModels);
  const deletePipeline = useWorkspaceStore((s) => s.deletePipeline);
  const path = useWorkspaceStore((s) => s.path);
  const [tab, setTab] = useState<"report" | "ddl">("report");
  const [saved, setSaved] = useState<string | null>(null);

  const model: Model | undefined = spec ? allModels().find((m) => m.id === spec.source.modelId)?.model : undefined;

  const issues = useMemo(() => (spec && model ? validatePipeline(spec, model) : []), [spec, model]);
  const report = useMemo(() => (spec ? pipelineReport(spec, issues) : ""), [spec, issues]);
  const ddl = useMemo(() => (spec ? targetDdl(spec) : ""), [spec]);

  if (!spec) return null;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const exportFiles = async () => {
    if (!path) return;
    await writeFile(joinPath(path, `${spec.name}.pipeline-report.txt`), report, false);
    await writeFile(joinPath(path, `${spec.name}.target.sql`), ddl, false);
    setSaved(`${spec.name}.pipeline-report.txt + ${spec.name}.target.sql`);
  };

  return (
    <div>
      <h3 className="modal__subtitle">{spec.name}</h3>
      <p className="field__hint">
        source: {spec.source.modelName} · target: {DIALECTS[spec.target.platform as DialectId].label} ·{" "}
        {spec.objects.length} object(s)
        {spec.source.snapshotId ? " · snapshot-referenced" : ""}
      </p>
      {!model && (
        <p className="field__hint field__hint--warn">
          Source model “{spec.source.modelName}” isn’t open — open it to re-validate against the current schema.
        </p>
      )}
      <p className={`field__hint ${errors ? "field__hint--warn" : ""}`}>
        Validation: {errors} error(s), {warnings} warning(s)
      </p>

      <div className="tabs">
        <button className={`tab-btn ${tab === "report" ? "tab-btn--active" : ""}`} onClick={() => setTab("report")}>Mapping report</button>
        <button className={`tab-btn ${tab === "ddl" ? "tab-btn--active" : ""}`} onClick={() => setTab("ddl")}>Target DDL</button>
      </div>
      <pre className="export-preview">{tab === "report" ? report : ddl}</pre>

      {saved && <p className="field__hint">Saved {saved}</p>}
      <div className="modal__actions">
        <button className="btn btn--danger btn--small" onClick={async () => { await deletePipeline(spec.id); onDeleted(); }}>
          Delete
        </button>
        <button className="btn btn--small" onClick={() => navigator.clipboard?.writeText(tab === "report" ? report : ddl)}>Copy</button>
        <button className="btn btn--primary btn--small" onClick={exportFiles} disabled={!path}>Export report + DDL</button>
      </div>
    </div>
  );
}
