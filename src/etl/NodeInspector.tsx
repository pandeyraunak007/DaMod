import { DATA_TYPE_KINDS, type DataTypeKind } from "../model/dataTypes";
import { AGG_FNS, FILTER_OPS, JOIN_KINDS, type PipelineNode, type SpecType } from "../connectors/pipeline/spec";
import type { GraphField } from "../connectors/pipeline/graph";
import type { Model } from "../model/model";

// Per-kind config editor for a selected DAG node (Phase 3 Slice B2). Emits a patch via
// onChange; the caller applies it with updateGraphNode + upsertPipeline. Column pickers
// use the node's INPUT schema where known. Pure presentational — no store access.
export function NodeInspector({
  node,
  model,
  inputSchema,
  onChange,
}: {
  node: PipelineNode;
  model?: Model;
  inputSchema: GraphField[];
  onChange: (patch: Partial<PipelineNode>) => void;
}) {
  const cols = inputSchema.map((f) => f.name);
  const typeSel = (value: SpecType | undefined, set: (t: SpecType) => void) => (
    <select value={value?.type ?? "string"} onChange={(e) => set({ type: e.target.value as DataTypeKind })}>
      {DATA_TYPE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
    </select>
  );

  switch (node.kind) {
    case "source":
      return (
        <div className="field">
          <label>Source object</label>
          <select value={node.sourceObject ?? ""} onChange={(e) => onChange({ sourceObject: e.target.value, label: e.target.value })}>
            <option value="">— choose —</option>
            {(model?.entities ?? []).map((en) => <option key={en.id} value={en.name}>{en.name}</option>)}
          </select>
        </div>
      );

    case "target":
      return (
        <div className="field">
          <label>Target object</label>
          <input value={node.targetObject ?? ""} onChange={(e) => onChange({ targetObject: e.target.value, label: e.target.value })} />
        </div>
      );

    case "filter": {
      const filters = node.filters ?? [];
      const setRow = (i: number, p: Partial<(typeof filters)[number]>) => onChange({ filters: filters.map((f, j) => (j === i ? { ...f, ...p } : f)) });
      return (
        <div className="field">
          <label>Filters (source-side)</label>
          {filters.map((f, i) => (
            <div key={i} className="attr-row">
              <select value={f.column} onChange={(e) => setRow(i, { column: e.target.value })}>
                <option value="">col</option>
                {cols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={f.op} onChange={(e) => setRow(i, { op: e.target.value as (typeof FILTER_OPS)[number] })}>
                {FILTER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input placeholder="value" value={f.value ?? ""} onChange={(e) => setRow(i, { value: e.target.value || undefined })} />
              <button className="field-row__del" onClick={() => onChange({ filters: filters.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn--small" onClick={() => onChange({ filters: [...filters, { column: cols[0] ?? "", op: "=" }] })}>+ filter</button>
        </div>
      );
    }

    case "select": {
      const keep = node.keep ?? [];
      const renames = node.renames ?? [];
      const toggle = (c: string) => onChange({ keep: keep.includes(c) ? keep.filter((k) => k !== c) : [...keep, c] });
      const setRen = (i: number, p: Partial<(typeof renames)[number]>) => onChange({ renames: renames.map((r, j) => (j === i ? { ...r, ...p } : r)) });
      return (
        <div className="field">
          <label>Keep columns (none = all)</label>
          {cols.map((c) => (
            <label key={c} className="checkbox"><input type="checkbox" checked={keep.includes(c)} onChange={() => toggle(c)} />{c}</label>
          ))}
          <label>Renames</label>
          {renames.map((r, i) => (
            <div key={i} className="attr-row">
              <input placeholder="from" value={r.from} onChange={(e) => setRen(i, { from: e.target.value })} />
              <input placeholder="to" value={r.to} onChange={(e) => setRen(i, { to: e.target.value })} />
              <button className="field-row__del" onClick={() => onChange({ renames: renames.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn--small" onClick={() => onChange({ renames: [...renames, { from: cols[0] ?? "", to: "" }] })}>+ rename</button>
        </div>
      );
    }

    case "derive": {
      const derive = node.derive ?? [];
      const setRow = (i: number, p: Partial<(typeof derive)[number]>) => onChange({ derive: derive.map((d, j) => (j === i ? { ...d, ...p } : d)) });
      return (
        <div className="field">
          <label>Derived columns</label>
          {derive.map((d, i) => (
            <div key={i} className="attr-row">
              <input placeholder="name" value={d.name} onChange={(e) => setRow(i, { name: e.target.value })} />
              <input placeholder="expression" value={d.expression} onChange={(e) => setRow(i, { expression: e.target.value })} />
              {typeSel(d.type, (t) => setRow(i, { type: t }))}
              <button className="field-row__del" onClick={() => onChange({ derive: derive.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn--small" onClick={() => onChange({ derive: [...derive, { name: "", expression: "", type: { type: "string" } }] })}>+ column</button>
        </div>
      );
    }

    case "cast": {
      const casts = node.casts ?? [];
      const setRow = (i: number, p: Partial<(typeof casts)[number]>) => onChange({ casts: casts.map((c, j) => (j === i ? { ...c, ...p } : c)) });
      return (
        <div className="field">
          <label>Casts</label>
          {casts.map((c, i) => (
            <div key={i} className="attr-row">
              <select value={c.column} onChange={(e) => setRow(i, { column: e.target.value })}>
                <option value="">col</option>
                {cols.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              {typeSel(c.type, (t) => setRow(i, { type: t }))}
              <button className="field-row__del" onClick={() => onChange({ casts: casts.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn--small" onClick={() => onChange({ casts: [...casts, { column: cols[0] ?? "", type: { type: "text" } }] })}>+ cast</button>
        </div>
      );
    }

    case "distinct":
      return <p className="field__hint">Removes duplicate rows (full-row <code>SELECT DISTINCT</code>). No configuration. Key-based dedup is a later enhancement.</p>;

    case "aggregate": {
      const groupBy = node.groupBy ?? [];
      const aggs = node.aggregates ?? [];
      const toggleGroup = (c: string) => onChange({ groupBy: groupBy.includes(c) ? groupBy.filter((g) => g !== c) : [...groupBy, c] });
      const setAgg = (i: number, p: Partial<(typeof aggs)[number]>) => onChange({ aggregates: aggs.map((a, j) => (j === i ? { ...a, ...p } : a)) });
      return (
        <div className="field">
          <label>Group by</label>
          {cols.map((c) => (
            <label key={c} className="checkbox"><input type="checkbox" checked={groupBy.includes(c)} onChange={() => toggleGroup(c)} />{c}</label>
          ))}
          {cols.length === 0 && <p className="field__hint">No input columns yet — connect a source upstream.</p>}
          <label>Measures</label>
          {aggs.map((a, i) => (
            <div key={i} className="attr-row">
              <select value={a.fn} onChange={(e) => setAgg(i, { fn: e.target.value as (typeof AGG_FNS)[number] })}>
                {AGG_FNS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={a.column ?? ""} onChange={(e) => setAgg(i, { column: e.target.value || undefined })}>
                <option value="">{a.fn === "count" ? "(all rows)" : "col"}</option>
                {cols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="as" value={a.as} onChange={(e) => setAgg(i, { as: e.target.value })} />
              <button className="field-row__del" onClick={() => onChange({ aggregates: aggs.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn--small" onClick={() => onChange({ aggregates: [...aggs, { fn: "sum", column: cols[0], as: "" }] })}>+ measure</button>
        </div>
      );
    }

    case "join": {
      const on = node.on ?? [];
      const setRow = (i: number, p: Partial<(typeof on)[number]>) => onChange({ on: on.map((o, j) => (j === i ? { ...o, ...p } : o)) });
      return (
        <div className="field">
          <label>Join kind</label>
          <select value={node.joinKind ?? "inner"} onChange={(e) => onChange({ joinKind: e.target.value as (typeof JOIN_KINDS)[number] })}>
            {JOIN_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <label>On (left = right)</label>
          {on.map((o, i) => (
            <div key={i} className="attr-row">
              <input placeholder="left column" value={o.leftColumn} onChange={(e) => setRow(i, { leftColumn: e.target.value })} />
              <input placeholder="right column" value={o.rightColumn} onChange={(e) => setRow(i, { rightColumn: e.target.value })} />
              <button className="field-row__del" onClick={() => onChange({ on: on.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn--small" onClick={() => onChange({ on: [...on, { leftColumn: "", rightColumn: "" }] })}>+ key</button>
          <p className="field__hint">Connect the two inputs to this join's left/right ports.</p>
        </div>
      );
    }
  }
}
