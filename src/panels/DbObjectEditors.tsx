import { useModelStore } from "../store/modelStore";
import { validateIdentifier } from "../model/identifiers";
import type { DbDialect, SnowflakeObject } from "../model/model";

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
        {view.materialized && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!view.withNoData}
              onChange={(e) => update(id, { withNoData: e.target.checked })}
            />
            Create WITH NO DATA (populate later via REFRESH)
          </label>
        )}
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

const DIALECTS: DbDialect[] = ["postgres", "snowflake", "databricks", "oracle", "sqlserver", "mysql", "bigquery"];

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

// Req 19 — schema (CREATE SCHEMA) properties: name, owner, comment.
export function SchemaEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const schema = useModelStore((s) => s.model.schemas?.find((x) => x.id === id));
  const update = useModelStore((s) => s.updateSchema);
  const del = useModelStore((s) => s.deleteSchema);
  const entities = useModelStore((s) => s.model.entities);
  if (!schema) return null;
  const dependents = entities.filter((e) => e.schema === schema.name);
  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Schema name</label>
        <input
          className="editor__input"
          value={schema.name}
          onChange={(e) => !validateIdentifier(e.target.value) && update(id, { name: e.target.value })}
        />
      </div>
      <div className="editor__section">
        <label className="editor__label">Owner (role)</label>
        <input
          className="editor__input"
          value={schema.owner ?? ""}
          placeholder="e.g. app_owner"
          onChange={(e) => update(id, { owner: e.target.value })}
        />
      </div>
      <div className="editor__section">
        <label className="editor__label">Comment</label>
        <textarea
          className="editor__input"
          rows={3}
          value={schema.comment ?? ""}
          onChange={(e) => update(id, { comment: e.target.value })}
        />
      </div>
      <div className="editor__section">
        <label className="editor__label">Tables in this schema ({dependents.length})</label>
        {dependents.length === 0 ? (
          <p className="field__hint">No tables assigned. Set a table's schema in its General tab.</p>
        ) : (
          <p className="field__hint">{dependents.map((e) => e.name).join(", ")}</p>
        )}
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete schema
      </button>
    </div>
  );
}

// Snowflake data-engineering object editor (Req 23 §5/§9) — kind-adaptive, read-only
// of credentials (stages never expose secrets). Edits flow through the store op.
const SF_FORMATS = ["CSV", "JSON", "PARQUET", "AVRO", "ORC", "XML"];
export function SnowflakeObjectEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const obj = useModelStore((s) => s.model.snowflakeObjects?.find((o) => o.id === id));
  const update = useModelStore((s) => s.updateSnowflakeObject);
  const del = useModelStore((s) => s.deleteSnowflakeObject);
  if (!obj) return null;
  const set = (p: Partial<SnowflakeObject>) => update(id, p);
  const field = (label: string, value: string | undefined, key: keyof SnowflakeObject, mono = false) => (
    <div className="editor__section">
      <label className="editor__label">{label}</label>
      {mono ? (
        <textarea className="editor__input" rows={4} style={{ fontFamily: "ui-monospace, monospace" }} value={value ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<SnowflakeObject>)} />
      ) : (
        <input className="editor__input" value={value ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<SnowflakeObject>)} />
      )}
    </div>
  );

  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Name</label>
        <input className="editor__input" value={obj.name} onChange={(e) => !validateIdentifier(e.target.value) && set({ name: e.target.value })} />
      </div>

      {obj.kind === "stage" && (
        <>
          <div className="editor__section">
            <label className="editor__label">Stage type</label>
            <select value={obj.stageType ?? "internal"} onChange={(e) => set({ stageType: e.target.value as SnowflakeObject["stageType"] })}>
              <option value="internal">internal</option>
              <option value="external">external</option>
            </select>
          </div>
          {obj.stageType === "external" && field("URL", obj.url, "url")}
          {field("File format (name)", obj.fileFormat, "fileFormat")}
          <p className="field__hint">Credentials are never stored or shown here (§5).</p>
        </>
      )}

      {obj.kind === "fileFormat" && (
        <>
          <div className="editor__section">
            <label className="editor__label">Format type</label>
            <select value={obj.formatType ?? "CSV"} onChange={(e) => set({ formatType: e.target.value })}>
              {SF_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          {field("Options (raw)", obj.options, "options", true)}
        </>
      )}

      {obj.kind === "pipe" && (
        <>
          {field("COPY INTO statement", obj.copyStatement, "copyStatement", true)}
          <div className="editor__section">
            <label className="checkbox"><input type="checkbox" checked={!!obj.autoIngest} onChange={(e) => set({ autoIngest: e.target.checked })} /> Auto-ingest</label>
          </div>
        </>
      )}

      {obj.kind === "stream" && (
        <>
          {field("Source object", obj.sourceObject, "sourceObject")}
          <div className="editor__section">
            <label className="editor__label">Stream type</label>
            <select value={obj.streamType ?? "standard"} onChange={(e) => set({ streamType: e.target.value as SnowflakeObject["streamType"] })}>
              <option value="standard">standard</option>
              <option value="append_only">append_only</option>
              <option value="insert_only">insert_only</option>
            </select>
          </div>
        </>
      )}

      {obj.kind === "task" && (
        <>
          {field("Warehouse", obj.warehouse, "warehouse")}
          {field("Schedule", obj.schedule, "schedule")}
          {field("After (parent task)", obj.after, "after")}
          {field("SQL body", obj.sql, "sql", true)}
        </>
      )}

      {obj.kind === "dynamicTable" && (
        <>
          {field("Target lag", obj.targetLag, "targetLag")}
          {field("Warehouse", obj.warehouse, "warehouse")}
          {field("Query", obj.sql, "sql", true)}
        </>
      )}

      <div className="editor__section">
        <label className="editor__label">Comment</label>
        <textarea className="editor__input" rows={2} value={obj.comment ?? ""} onChange={(e) => set({ comment: e.target.value || undefined })} />
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>Delete {obj.kind}</button>
    </div>
  );
}
