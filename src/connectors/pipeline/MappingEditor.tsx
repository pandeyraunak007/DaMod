import { useMemo, useState } from "react";
import { DATA_TYPE_KINDS, type DataTypeKind } from "../../model/dataTypes";
import type { Model } from "../../model/model";
import { validatePipeline, columnFromField } from "./planner";
import type { ColumnMapping, PipelineObject, PipelineSpec } from "./spec";

// Source-to-target mapping editor (Req 22 §8). Edits the pipeline spec's column
// mappings per object: rename the target column, convert its type, add a transform
// expression, toggle NOT NULL, drop a column, or add back an un-mapped source
// column. Edits a local draft and re-validates live; "Save mappings" persists the
// whole spec through the existing store op — no new mapping engine.
export function MappingEditor({
  spec,
  model,
  onSave,
}: {
  spec: PipelineSpec;
  model?: Model;
  onSave: (s: PipelineSpec) => void;
}) {
  const [objects, setObjects] = useState<PipelineObject[]>(spec.objects);
  const dirty = JSON.stringify(objects) !== JSON.stringify(spec.objects);
  const draftSpec: PipelineSpec = { ...spec, objects };

  const issues = useMemo(() => (model ? validatePipeline(draftSpec, model) : []), [objects, model, draftSpec]);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const updateObject = (oi: number, patch: Partial<PipelineObject>) =>
    setObjects((os) => os.map((o, i) => (i === oi ? { ...o, ...patch } : o)));
  const updateCol = (oi: number, ci: number, patch: Partial<ColumnMapping>) =>
    updateObject(oi, { columns: objects[oi].columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)) });
  const removeCol = (oi: number, ci: number) =>
    updateObject(oi, { columns: objects[oi].columns.filter((_, i) => i !== ci) });
  const srcEntity = (name: string) => model?.entities.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const addSourceCol = (oi: number, fieldName: string) => {
    const f = srcEntity(objects[oi].sourceObject)?.fields.find((x) => x.name === fieldName);
    if (f) updateObject(oi, { columns: [...objects[oi].columns, columnFromField(f)] });
  };

  return (
    <div>
      <p className={`field__hint ${errors ? "field__hint--warn" : ""}`}>
        Map each source column to a target column — rename, convert its type, add a transform, or drop
        it. Validation: {errors} error(s), {warnings} warning(s).
      </p>
      {objects.map((o, oi) => {
        const e = srcEntity(o.sourceObject);
        const mapped = new Set(o.columns.map((c) => c.source.toLowerCase()).filter(Boolean));
        const unmapped = (e?.fields ?? []).filter((f) => !mapped.has(f.name.toLowerCase()));
        return (
          <div key={oi} className="field map-obj">
            <label>
              {o.sourceObject} <span className="map-arrow">→</span>{" "}
              <input className="map-target-name" value={o.targetObject} onChange={(ev) => updateObject(oi, { targetObject: ev.target.value })} />
            </label>
            <table className="map-grid">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Target column</th>
                  <th>Type</th>
                  <th>Transform</th>
                  <th title="NOT NULL">NN</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {o.columns.map((c, ci) => (
                  <tr key={ci}>
                    <td className="map-src">{c.source || "(none)"}</td>
                    <td>
                      <input value={c.target} onChange={(ev) => updateCol(oi, ci, { target: ev.target.value })} />
                    </td>
                    <td>
                      <select
                        value={c.targetType.type}
                        onChange={(ev) => updateCol(oi, ci, { targetType: { ...c.targetType, type: ev.target.value as DataTypeKind } })}
                      >
                        {DATA_TYPE_KINDS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        placeholder="identity"
                        value={c.transform ?? ""}
                        onChange={(ev) => updateCol(oi, ci, { transform: ev.target.value || undefined })}
                      />
                    </td>
                    <td className="map-nn">
                      <input type="checkbox" checked={c.required} onChange={(ev) => updateCol(oi, ci, { required: ev.target.checked })} />
                    </td>
                    <td>
                      <button className="field-row__del" title="Drop column" onClick={() => removeCol(oi, ci)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unmapped.length > 0 && (
              <select className="map-add" value="" onChange={(ev) => ev.target.value && addSourceCol(oi, ev.target.value)}>
                <option value="">+ add source column…</option>
                {unmapped.map((f) => (
                  <option key={f.id} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      <div className="modal__actions">
        <button className="btn btn--primary btn--small" disabled={!dirty} onClick={() => onSave(draftSpec)}>
          Save mappings
        </button>
      </div>
    </div>
  );
}
