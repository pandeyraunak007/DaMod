import { useMemo, useState } from "react";
import { DATA_TYPE_KINDS, type DataTypeKind } from "../../model/dataTypes";
import type { Model } from "../../model/model";
import { validatePipeline, columnFromField } from "./planner";
import {
  FILTER_OPS,
  JOIN_KINDS,
  filterNeedsValue,
  type ColumnMapping,
  type FilterOp,
  type JoinKind,
  type PipelineJoin,
  type PipelineObject,
  type PipelineSpec,
} from "./spec";

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
  const [joins, setJoins] = useState<PipelineJoin[]>(spec.joins);
  const dirty = JSON.stringify(objects) !== JSON.stringify(spec.objects) || JSON.stringify(joins) !== JSON.stringify(spec.joins);
  const draftSpec: PipelineSpec = { ...spec, objects, joins };

  const issues = useMemo(() => (model ? validatePipeline(draftSpec, model) : []), [objects, joins, model, draftSpec]);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const updateObject = (oi: number, patch: Partial<PipelineObject>) =>
    setObjects((os) => os.map((o, i) => (i === oi ? { ...o, ...patch } : o)));
  const updateCol = (oi: number, ci: number, patch: Partial<ColumnMapping>) =>
    updateObject(oi, { columns: objects[oi].columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)) });
  const removeCol = (oi: number, ci: number) =>
    updateObject(oi, { columns: objects[oi].columns.filter((_, i) => i !== ci) });
  const srcEntity = (name: string) => model?.entities.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const fieldsOf = (sourceObject: string) => srcEntity(sourceObject)?.fields ?? [];
  const addSourceCol = (oi: number, fieldName: string) => {
    const f = srcEntity(objects[oi].sourceObject)?.fields.find((x) => x.name === fieldName);
    if (f) updateObject(oi, { columns: [...objects[oi].columns, columnFromField(f)] });
  };

  // Filters (per object)
  const addFilter = (oi: number) => {
    const first = fieldsOf(objects[oi].sourceObject)[0]?.name ?? "";
    updateObject(oi, { filters: [...objects[oi].filters, { column: first, op: "=" as FilterOp, value: "" }] });
  };
  const updateFilter = (oi: number, fi: number, patch: Partial<PipelineObject["filters"][number]>) =>
    updateObject(oi, { filters: objects[oi].filters.map((f, i) => (i === fi ? { ...f, ...patch } : f)) });
  const removeFilter = (oi: number, fi: number) =>
    updateObject(oi, { filters: objects[oi].filters.filter((_, i) => i !== fi) });

  // Joins (spec level)
  const sourceObjects = objects.map((o) => o.sourceObject);
  const addJoin = () => {
    if (sourceObjects.length < 1) return;
    const left = sourceObjects[0];
    const right = sourceObjects[1] ?? sourceObjects[0];
    setJoins((js) => [...js, { leftObject: left, leftColumn: fieldsOf(left)[0]?.name ?? "", rightObject: right, rightColumn: fieldsOf(right)[0]?.name ?? "", kind: "inner" as JoinKind }]);
  };
  const updateJoin = (ji: number, patch: Partial<PipelineJoin>) =>
    setJoins((js) => js.map((j, i) => (i === ji ? { ...j, ...patch } : j)));
  const removeJoin = (ji: number) => setJoins((js) => js.filter((_, i) => i !== ji));

  return (
    <div>
      <p className={`field__hint ${errors ? "field__hint--warn" : ""}`}>
        Map each source column to a target column — rename, convert its type, add a transform, or drop
        it; add source-side filters and cross-object joins. Validation: {errors} error(s), {warnings} warning(s).
      </p>

      {/* Cross-object joins (§8.6). */}
      <div className="field map-obj">
        <label>Joins <button className="btn btn--small" onClick={addJoin} disabled={sourceObjects.length === 0}>+ join</button></label>
        {joins.length === 0 && <p className="field__hint">No joins — objects load independently.</p>}
        {joins.map((j, ji) => (
          <div key={ji} className="map-join">
            <select value={j.leftObject} onChange={(e) => updateJoin(ji, { leftObject: e.target.value, leftColumn: fieldsOf(e.target.value)[0]?.name ?? "" })}>
              {sourceObjects.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={j.leftColumn} onChange={(e) => updateJoin(ji, { leftColumn: e.target.value })}>
              {fieldsOf(j.leftObject).map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
            </select>
            <select value={j.kind} onChange={(e) => updateJoin(ji, { kind: e.target.value as JoinKind })}>
              {JOIN_KINDS.map((k) => <option key={k} value={k}>{k} join</option>)}
            </select>
            <select value={j.rightObject} onChange={(e) => updateJoin(ji, { rightObject: e.target.value, rightColumn: fieldsOf(e.target.value)[0]?.name ?? "" })}>
              {sourceObjects.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={j.rightColumn} onChange={(e) => updateJoin(ji, { rightColumn: e.target.value })}>
              {fieldsOf(j.rightObject).map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
            </select>
            <button className="field-row__del" title="Remove join" onClick={() => removeJoin(ji)}>✕</button>
          </div>
        ))}
      </div>
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
            {/* Source-side filters (§8.6). */}
            <div className="map-filters">
              <button className="btn btn--small" onClick={() => addFilter(oi)}>+ filter</button>
              {o.filters.map((f, fi) => (
                <span key={fi} className="map-filter">
                  <select value={f.column} onChange={(ev) => updateFilter(oi, fi, { column: ev.target.value })}>
                    {(e?.fields ?? []).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
                  </select>
                  <select value={f.op} onChange={(ev) => updateFilter(oi, fi, { op: ev.target.value as FilterOp })}>
                    {FILTER_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  {filterNeedsValue(f.op) && (
                    <input placeholder="value" value={f.value ?? ""} onChange={(ev) => updateFilter(oi, fi, { value: ev.target.value })} />
                  )}
                  <button className="field-row__del" title="Remove filter" onClick={() => removeFilter(oi, fi)}>✕</button>
                </span>
              ))}
            </div>
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
