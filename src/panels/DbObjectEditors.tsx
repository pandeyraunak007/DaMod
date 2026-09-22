import { useModelStore } from "../store/modelStore";
import { validateIdentifier } from "../model/identifiers";
import type { DbDialect } from "../model/model";

// Side-panel editors for the non-table database objects (FR-8 extensions):
// views, indexes, sequences and raw dialect-specific objects.

export function ViewEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const view = useModelStore((s) => s.model.views?.find((v) => v.id === id));
  const entities = useModelStore((s) => s.model.entities);
  const update = useModelStore((s) => s.updateView);
  const del = useModelStore((s) => s.deleteView);
  if (!view) return null;
  const toggleSource = (eid: string) => {
    const cur = view.sources ?? [];
    update(id, { sources: cur.includes(eid) ? cur.filter((x) => x !== eid) : [...cur, eid] });
  };
  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">View name</label>
        <input
          className="editor__input"
          value={view.name}
          onChange={(e) => !validateIdentifier(e.target.value) && update(id, { name: e.target.value })}
        />
      </div>
      <div className="editor__section">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!view.materialized}
            onChange={(e) => update(id, { materialized: e.target.checked })}
          />
          Materialized
        </label>
      </div>
      <div className="editor__section">
        <label className="editor__label">SQL definition</label>
        <textarea
          className="editor__input"
          rows={6}
          style={{ fontFamily: "ui-monospace, monospace" }}
          value={view.definition}
          onChange={(e) => update(id, { definition: e.target.value })}
        />
      </div>
      <div className="editor__section">
        <label className="editor__label">Source entities (canvas lines)</label>
        {entities.map((e) => (
          <label key={e.id} className="checkbox">
            <input
              type="checkbox"
              checked={(view.sources ?? []).includes(e.id)}
              onChange={() => toggleSource(e.id)}
            />
            {e.name}
          </label>
        ))}
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete view
      </button>
    </div>
  );
}

export function IndexEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const index = useModelStore((s) => s.model.indexes?.find((i) => i.id === id));
  const entities = useModelStore((s) => s.model.entities);
  const update = useModelStore((s) => s.updateIndex);
  const del = useModelStore((s) => s.deleteIndex);
  if (!index) return null;
  const entity = entities.find((e) => e.id === index.entity);
  const toggleField = (fid: string) => {
    const cur = index.fields;
    update(id, { fields: cur.includes(fid) ? cur.filter((x) => x !== fid) : [...cur, fid] });
  };
  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Index name</label>
        <input
          className="editor__input"
          value={index.name}
          onChange={(e) => !validateIdentifier(e.target.value) && update(id, { name: e.target.value })}
        />
      </div>
      <div className="editor__section">
        <label className="editor__label">On entity</label>
        <select
          className="editor__input"
          value={index.entity}
          onChange={(e) => update(id, { entity: e.target.value, fields: [] })}
        >
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="editor__section">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!index.unique}
            onChange={(e) => update(id, { unique: e.target.checked })}
          />
          Unique
        </label>
      </div>
      <div className="editor__section">
        <label className="editor__label">Columns (in order)</label>
        {entity?.fields.map((f) => (
          <label key={f.id} className="checkbox">
            <input
              type="checkbox"
              checked={index.fields.includes(f.id)}
              onChange={() => toggleField(f.id)}
            />
            {f.name}
          </label>
        ))}
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete index
      </button>
    </div>
  );
}

export function SequenceEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const seq = useModelStore((s) => s.model.sequences?.find((x) => x.id === id));
  const update = useModelStore((s) => s.updateSequence);
  const del = useModelStore((s) => s.deleteSequence);
  if (!seq) return null;
  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Sequence name</label>
        <input
          className="editor__input"
          value={seq.name}
          onChange={(e) => !validateIdentifier(e.target.value) && update(id, { name: e.target.value })}
        />
      </div>
      <div className="editor__section editor__section--row">
        <label className="field-row__params">
          start
          <input
            type="number"
            value={seq.start ?? 1}
            onChange={(e) => update(id, { start: Number(e.target.value) })}
          />
        </label>
        <label className="field-row__params">
          increment
          <input
            type="number"
            value={seq.increment ?? 1}
            onChange={(e) => update(id, { increment: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="field__hint">Postgres + Snowflake export CREATE SEQUENCE; Databricks uses identity columns.</p>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete sequence
      </button>
    </div>
  );
}

const DIALECTS: DbDialect[] = ["postgres", "snowflake", "databricks"];

export function RawObjectEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const obj = useModelStore((s) => s.model.rawObjects?.find((o) => o.id === id));
  const update = useModelStore((s) => s.updateRawObject);
  const del = useModelStore((s) => s.deleteRawObject);
  if (!obj) return null;
  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Object name</label>
        <input className="editor__input" value={obj.name} onChange={(e) => update(id, { name: e.target.value })} />
      </div>
      <div className="editor__section modal__row--pair">
        <div className="field">
          <label>Dialect</label>
          <select value={obj.dialect} onChange={(e) => update(id, { dialect: e.target.value as DbDialect })}>
            {DIALECTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Kind (optional)</label>
          <input value={obj.kind ?? ""} placeholder="stage / stream / task…" onChange={(e) => update(id, { kind: e.target.value })} />
        </div>
      </div>
      <div className="editor__section">
        <label className="editor__label">SQL (exported verbatim for this dialect)</label>
        <textarea
          className="editor__input"
          rows={6}
          style={{ fontFamily: "ui-monospace, monospace" }}
          value={obj.sql}
          onChange={(e) => update(id, { sql: e.target.value })}
        />
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete object
      </button>
    </div>
  );
}
