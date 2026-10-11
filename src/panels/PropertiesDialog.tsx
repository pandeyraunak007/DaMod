import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import {
  DATA_TYPE_KINDS,
  paramShape,
  type DataTypeKind,
} from "../model/dataTypes";
import { validateIdentifier } from "../model/identifiers";
import {
  LOGICAL_TYPE_KINDS,
  type LogicalTypeKind,
  inspectorCaps,
  levelTerms,
} from "../model/levels";
import { foreignKeys, tableDDL } from "../export/ddl";
import { DIALECTS, type DialectId } from "../export/dialects";
import type { Entity, Field, FieldRole, RiAction, Udp } from "../model/model";
import { modelDialect, TABLE_KINDS } from "../model/model";
import { DomainSelect } from "./DomainSelect";

const RI_ACTIONS: RiAction[] = ["no action", "cascade", "restrict", "set null", "set default"];

// An ERwin-style tabbed property editor for the selected entity or relationship.
// Opened by double-clicking a node, the side-panel "Properties…" button, or the
// Explorer context menu.
export function PropertiesDialog({ onClose }: { onClose: () => void }) {
  const selection = useModelStore((s) => s.selection);
  const entity = useModelStore((s) =>
    selection?.kind === "entity" ? s.model.entities.find((e) => e.id === selection.id) : undefined,
  );
  const rel = useModelStore((s) =>
    selection?.kind === "relationship"
      ? s.model.relationships.find((r) => r.id === selection.id)
      : undefined,
  );

  if (!entity && !rel) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--props" onClick={(e) => e.stopPropagation()}>
        {entity ? (
          <EntityProperties entity={entity} onClose={onClose} />
        ) : rel ? (
          <RelationshipProperties relId={rel.id} onClose={onClose} />
        ) : null}
      </div>
    </div>
  );
}

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t} className={`tab-btn ${active === t ? "tab-btn--active" : ""}`} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

function UdpEditor({ udps, onChange }: { udps: Udp[] | undefined; onChange: (u: Udp[]) => void }) {
  const list = udps ?? [];
  return (
    <div>
      {list.map((u, i) => (
        <div key={i} className="attr-row">
          <input
            value={u.name}
            placeholder="property"
            onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            value={u.value}
            placeholder="value"
            onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button className="field-row__del" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn--small" onClick={() => onChange([...list, { name: "property", value: "" }])}>
        + Property
      </button>
      <p className="field__hint">User-defined properties are carried in the model files.</p>
    </div>
  );
}

// ---- entity ------------------------------------------------------------------

function EntityProperties({ entity, onClose }: { entity: Entity; onClose: () => void }) {
  const renameEntity = useModelStore((s) => s.renameEntity);
  const updateEntity = useModelStore((s) => s.updateEntity);
  const applyScd2 = useModelStore((s) => s.applyScd2);
  const level = useModelStore((s) => s.model.level);
  const terms = levelTerms(level); // pure; computed in render (never inside a selector)
  const caps = inspectorCaps(level);
  const [tab, setTab] = useState("General");
  const patch = (p: Parameters<typeof updateEntity>[1]) => updateEntity(entity.id, p);
  const hasSurrogate = entity.fields.some((f) => f.name.toLowerCase() === `${entity.name.toLowerCase()}_key`);

  return (
    <>
      <div className="props__head">
        <h2 className="modal__title">{terms.entity}: {entity.name}</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      <Tabs
        tabs={["General", terms.fieldPlural, ...(caps.ddl ? ["Checks"] : []), "Definition", "Note", "UDP", ...(caps.ddl ? ["SQL"] : [])]}
        active={tab}
        onChange={setTab}
      />
      <div className="props__body">
        {tab === "General" && (
          <>
            <div className="field">
              <label>{terms.entity} name {terms.entity === "Table" ? "(physical)" : ""}</label>
              <input
                defaultValue={entity.name}
                onChange={(e) => !validateIdentifier(e.target.value) && renameEntity(entity.id, e.target.value)}
              />
            </div>
            <div className="field">
              <label>Logical / business name</label>
              <input
                defaultValue={entity.logicalName ?? ""}
                placeholder="e.g. Customer (shown at Logical/Conceptual levels)"
                onChange={(e) => patch({ logicalName: e.target.value || undefined })}
              />
            </div>
            <div className="field">
              <label>Stereotype</label>
              <select
                value={entity.stereotype ?? ""}
                onChange={(e) => patch({ stereotype: (e.target.value || undefined) as "fact" | "dimension" | undefined })}
              >
                <option value="">— none —</option>
                <option value="fact">Fact</option>
                <option value="dimension">Dimension</option>
              </select>
            </div>
            <div className="field">
              <label>Tags (comma-separated)</label>
              <input
                defaultValue={entity.tags?.join(", ") ?? ""}
                onChange={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
              />
            </div>
            {caps.ddl && <EntitySchemaField entity={entity} onPatch={patch} />}
            {caps.ddl && (
              <div className="field">
                <label>Table kind</label>
                <select
                  value={entity.tableKind ?? "standard"}
                  onChange={(e) => patch({ tableKind: (e.target.value === "standard" ? undefined : e.target.value) as Entity["tableKind"] })}
                >
                  {TABLE_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                <p className="field__hint">
                  Snowflake: hybrid tables enforce keys; standard/transient/external do not —
                  declared constraints export as <code>NOT ENFORCED</code>.
                </p>
              </div>
            )}
            {entity.source && <EntitySourceInfo source={entity.source} />}
            <div className="field">
              <label>Dimensional modeling (Kimball)</label>
              <button className="btn btn--small" onClick={() => applyScd2(entity.id)}>
                {hasSurrogate ? "Re-apply SCD-2 columns" : "Make SCD-2 dimension"}
              </button>
              <p className="field__hint">
                Adds a <code>{entity.name}_key</code> surrogate primary key (demoting the natural key
                to a business key) plus <code>valid_from</code>, <code>valid_to</code>,{" "}
                <code>is_current</code> and <code>version</code>. Idempotent.
              </p>
            </div>
          </>
        )}
        {tab === terms.fieldPlural && <FieldsTab entity={entity} />}
        {tab === "Checks" && caps.ddl && <ChecksTab entity={entity} />}
        {tab === "Definition" && (
          <textarea className="editor__input" rows={8} defaultValue={entity.description ?? ""} onChange={(e) => patch({ description: e.target.value })} />
        )}
        {tab === "Note" && (
          <textarea className="editor__input" rows={8} defaultValue={entity.note ?? ""} onChange={(e) => patch({ note: e.target.value })} />
        )}
        {tab === "UDP" && <UdpEditor udps={entity.udps} onChange={(u) => patch({ udps: u })} />}
        {tab === "SQL" && caps.ddl && <EntityDdl entityId={entity.id} />}
      </div>
    </>
  );
}

// Owning-schema picker for a table (Req 19). A free-text name backed by a
// datalist of the model's defined schemas; blank means the public schema.
function EntitySchemaField({
  entity,
  onPatch,
}: {
  entity: Entity;
  onPatch: (p: { schema?: string }) => void;
}) {
  const schemas = useModelStore((s) => s.model.schemas) ?? [];
  return (
    <div className="field">
      <label>Schema</label>
      <input
        list="damod-schema-list"
        defaultValue={entity.schema ?? ""}
        placeholder="public"
        onChange={(e) => onPatch({ schema: e.target.value.trim() || undefined })}
      />
      <datalist id="damod-schema-list">
        {schemas.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <p className="field__hint">Blank = the public schema. Define schemas in the Explorer (Schemas).</p>
    </div>
  );
}

// Read-only discovery provenance (Req 21 §5/§7) — where a reverse-engineered object
// came from. Shown as facts (source identifier/product), never editable here.
function EntitySourceInfo({ source }: { source: NonNullable<Entity["source"]> }) {
  const fusion = source.system === "oracle-fusion";
  const rows: [string, string][] = [];
  if (source.system) rows.push(["Source system", source.system]);
  if (source.product) rows.push([fusion ? "Application family" : "EBS product", source.product]);
  if (source.schema) rows.push([fusion ? "Module" : "Source schema", source.schema]);
  if (source.nativeId) rows.push([fusion ? "Business object" : "Source identifier", source.nativeId]);
  if (source.apiPath) rows.push(["API path", source.apiPath]);
  if (source.apiVersion) rows.push(["API version", source.apiVersion]);
  if (source.provenance) rows.push(["Provenance", source.provenance]);
  if (source.confidence !== undefined) rows.push(["Confidence", `${Math.round(source.confidence * 100)}%`]);
  if (!rows.length) return null;
  return (
    <div className="field">
      <label>{fusion ? "Fusion Cloud source (read-only)" : "Discovery source (read-only)"}</label>
      <table className="src-info">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="src-info__k">{k}</td>
              <td className="src-info__v">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field__hint">Verified discovery metadata — distinct from inferred business meaning.</p>
    </div>
  );
}

// Table CHECK constraints (Req 19) — name + SQL boolean expression, exported
// verbatim inside CHECK (...). Edits go through the shared store ops (undo/redo).
function ChecksTab({ entity }: { entity: Entity }) {
  const addCheck = useModelStore((s) => s.addCheck);
  const updateCheck = useModelStore((s) => s.updateCheck);
  const deleteCheck = useModelStore((s) => s.deleteCheck);
  const checks = entity.checks ?? [];
  return (
    <div>
      {checks.length === 0 && <p className="field__hint">No check constraints yet.</p>}
      {checks.map((c) => (
        <div key={c.id} className="field">
          <div className="attr-row">
            <input
              value={c.name}
              placeholder="constraint name"
              onChange={(e) => !validateIdentifier(e.target.value) && updateCheck(entity.id, c.id, { name: e.target.value })}
            />
            <button className="field-row__del" title="Delete constraint" onClick={() => deleteCheck(entity.id, c.id)}>
              ✕
            </button>
          </div>
          <textarea
            className="editor__input"
            rows={2}
            style={{ fontFamily: "ui-monospace, monospace" }}
            value={c.expression}
            placeholder="e.g. total >= 0"
            onChange={(e) => updateCheck(entity.id, c.id, { expression: e.target.value })}
          />
        </div>
      ))}
      <button className="btn btn--small" onClick={() => addCheck(entity.id)}>
        + Check constraint
      </button>
      <p className="field__hint">Exported as <code>CONSTRAINT name CHECK (expression)</code> on the table.</p>
    </div>
  );
}

// Compact, level-aware column/attribute grid (§2.2). Common properties edit
// inline in a dense table; clicking a row expands the detail editor for the rest.
// Columns shown adapt to the active modeling level via inspectorCaps.
function FieldsTab({ entity }: { entity: Entity }) {
  const level = useModelStore((s) => s.model.level);
  const addField = useModelStore((s) => s.addField);
  const caps = inspectorCaps(level);
  const terms = levelTerms(level);
  const [openId, setOpenId] = useState<string | null>(null);

  const cols =
    1 +
    (caps.physicalType ? 1 : 0) +
    (caps.logicalType ? 1 : 0) +
    (caps.physicalType ? 1 : 0) +
    (caps.keys ? 3 : 0) +
    (caps.physicalProps ? 1 : 0) +
    1;

  return (
    <div className="colgrid-wrap">
      <table className="colgrid">
        <thead>
          <tr>
            <th className="colgrid__name">Name</th>
            {caps.physicalType && <th>Type</th>}
            {caps.logicalType && <th>Logical</th>}
            {caps.physicalType && <th>Params</th>}
            {caps.keys && <th title="Primary key">PK</th>}
            {caps.keys && <th title="Not null">NN</th>}
            {caps.keys && <th title="Unique">U</th>}
            {caps.physicalProps && <th>Default</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {entity.fields.map((f, i) => (
            <ColumnRow
              key={f.id}
              entityId={entity.id}
              field={f}
              index={i}
              total={entity.fields.length}
              caps={caps}
              cols={cols}
              open={openId === f.id}
              onToggle={() => setOpenId(openId === f.id ? null : f.id)}
            />
          ))}
        </tbody>
      </table>
      {entity.fields.length === 0 && (
        <p className="side__hint">No {terms.fieldPlural.toLowerCase()} yet.</p>
      )}
      <button className="btn btn--small colgrid__add" onClick={() => addField(entity.id)}>
        + {terms.field}
      </button>
    </div>
  );
}

function ColumnRow({
  entityId,
  field,
  index,
  total,
  caps,
  cols,
  open,
  onToggle,
}: {
  entityId: string;
  field: Field;
  index: number;
  total: number;
  caps: ReturnType<typeof inspectorCaps>;
  cols: number;
  open: boolean;
  onToggle: () => void;
}) {
  const updateField = useModelStore((s) => s.updateField);
  const deleteField = useModelStore((s) => s.deleteField);
  const reorderField = useModelStore((s) => s.reorderField);
  const patch = (p: Partial<Field>) => updateField(entityId, field.id, p);
  const shape = field.type ? paramShape(field.type) : "none";

  return (
    <>
      <tr className={`colgrid__row ${open ? "colgrid__row--open" : ""}`}>
        <td className="colgrid__name">
          <input
            className="colgrid__input"
            defaultValue={field.name}
            onChange={(e) => !validateIdentifier(e.target.value) && patch({ name: e.target.value })}
          />
        </td>
        {caps.physicalType && (
          <td>
            <select className="colgrid__input" value={field.type ?? "string"} onChange={(e) => patch({ type: e.target.value as DataTypeKind })}>
              {DATA_TYPE_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </td>
        )}
        {caps.logicalType && (
          <td>
            <select className="colgrid__input" value={field.logicalType ?? "Text"} onChange={(e) => patch({ logicalType: e.target.value as LogicalTypeKind })}>
              {LOGICAL_TYPE_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </td>
        )}
        {caps.physicalType && (
          <td className="colgrid__params">
            {shape === "length" ? (
              <input type="number" min={1} className="colgrid__num" value={field.length ?? 255} onChange={(e) => patch({ length: Number(e.target.value) })} />
            ) : shape === "decimal" ? (
              <span className="colgrid__ps">
                <input type="number" min={1} className="colgrid__num" title="precision" value={field.precision ?? 12} onChange={(e) => patch({ precision: Number(e.target.value) })} />
                <input type="number" min={0} className="colgrid__num" title="scale" value={field.scale ?? 2} onChange={(e) => patch({ scale: Number(e.target.value) })} />
              </span>
            ) : (
              <span className="field__hint">—</span>
            )}
          </td>
        )}
        {caps.keys && (
          <>
            <td className="colgrid__chk">
              <input type="checkbox" checked={field.primaryKey} title="Primary key" onChange={(e) => patch({ primaryKey: e.target.checked, nullable: e.target.checked ? false : field.nullable })} />
            </td>
            <td className="colgrid__chk">
              <input type="checkbox" checked={!field.nullable} title="Not null" onChange={(e) => patch({ nullable: !e.target.checked })} />
            </td>
            <td className="colgrid__chk">
              <input type="checkbox" checked={field.unique} title="Unique" onChange={(e) => patch({ unique: e.target.checked })} />
            </td>
          </>
        )}
        {caps.physicalProps && (
          <td>
            <input className="colgrid__input" placeholder="—" defaultValue={field.default ?? ""} onChange={(e) => patch({ default: e.target.value || undefined })} />
          </td>
        )}
        <td className="colgrid__actions">
          <button className="colgrid__act" title="Move up" disabled={index === 0} onClick={() => reorderField(entityId, index, index - 1)}>↑</button>
          <button className="colgrid__act" title="Move down" disabled={index === total - 1} onClick={() => reorderField(entityId, index, index + 1)}>↓</button>
          <button className="colgrid__act" title="Details" onClick={onToggle}>{open ? "▾" : "⋯"}</button>
          <button className="colgrid__act colgrid__act--del" title="Delete" onClick={() => deleteField(entityId, field.id)}>✕</button>
        </td>
      </tr>
      {open && (
        <tr className="colgrid__detail-row">
          <td colSpan={cols}>
            <FieldDetail entityId={entityId} field={field} caps={caps} />
          </td>
        </tr>
      )}
    </>
  );
}

// The field editor is level-aware (§4/§7): Conceptual shows business meaning only
// (no type/keys), Logical shows a generic logical type + identifiers, and
// Physical / Physical-Logical show the full physical column editor. Hidden
// properties are never deleted from the underlying field — just not shown.
// The table's CREATE TABLE DDL (Postgres) — only offered at Physical / Physical-
// Logical (§13.2, §13.6-8). Reuses the existing DDL generator.
function EntityDdl({ entityId }: { entityId: string }) {
  const model = useModelStore((s) => s.model);
  const entity = model.entities.find((e) => e.id === entityId);
  if (!entity) return null;
  const fks = foreignKeys(model).filter((fk) => fk.child.id === entity.id);
  const dialect = DIALECTS[modelDialect(model) as DialectId];
  let ddl: string;
  try {
    ddl = tableDDL(dialect, entity, fks, undefined);
  } catch (e) {
    ddl = `-- error: ${(e as Error).message}`;
  }
  return (
    <div>
      <pre className="export-preview">{ddl}</pre>
      <button className="btn btn--small" onClick={() => navigator.clipboard?.writeText(ddl)}>Copy</button>
      <p className="field__hint">{dialect.label} CREATE TABLE for this table. Full export: Export (File tab).</p>
    </div>
  );
}

// The expanded detail for one column — only the properties NOT shown inline in
// the grid (name/type/params/keys/default are in the row). Level-aware via caps.
function FieldDetail({ entityId, field, caps }: { entityId: string; field: Field; caps: ReturnType<typeof inspectorCaps> }) {
  const updateField = useModelStore((s) => s.updateField);
  const bindFieldDomain = useModelStore((s) => s.bindFieldDomain);
  const domains = useModelStore((s) => s.model.domains) ?? [];
  const patch = (p: Partial<Field>) => updateField(entityId, field.id, p);

  return (
    <div className="colgrid__detail">
      <div className="field">
        <label>Logical / business name</label>
        <input
          defaultValue={field.logicalName ?? ""}
          placeholder="e.g. Customer ID (shown at Logical/Conceptual)"
          onChange={(e) => patch({ logicalName: e.target.value || undefined })}
        />
      </div>
      {field.source?.nativeType && (
        <div className="field">
          <label>Source-native type (read-only)</label>
          <input value={field.source.nativeType} readOnly className="src-native" title={field.source.system ? `from ${field.source.system}` : undefined} />
          <p className="field__hint">Verbatim type from discovery, preserved alongside the modeled type.</p>
        </div>
      )}
      {caps.physicalProps && domains.length > 0 && (
        <div className="field">
          <label>Domain</label>
          <DomainSelect
            domains={domains}
            value={field.domainId}
            onChange={(id) => bindFieldDomain(entityId, field.id, id)}
          />
        </div>
      )}
      {caps.physicalProps && (
        <div className="field">
          <label>Dimensional role (fact tables)</label>
          <select value={field.role ?? ""} onChange={(e) => patch({ role: (e.target.value || undefined) as FieldRole | undefined })}>
            <option value="">— none —</option>
            <option value="measure">Measure (additive fact)</option>
            <option value="degenerate">Degenerate dimension</option>
          </select>
        </div>
      )}
      <div className="field">
        <label>Definition</label>
        <textarea rows={2} defaultValue={field.description ?? ""} onChange={(e) => patch({ description: e.target.value || undefined })} />
      </div>
      <div className="field">
        <label>Note</label>
        <textarea rows={2} defaultValue={field.note ?? ""} onChange={(e) => patch({ note: e.target.value || undefined })} />
      </div>
      <label className="field__hint">User-defined properties</label>
      <UdpEditor udps={field.udps} onChange={(u) => patch({ udps: u.length ? u : undefined })} />
    </div>
  );
}

// ---- relationship ------------------------------------------------------------

function RelationshipProperties({ relId, onClose }: { relId: string; onClose: () => void }) {
  const rel = useModelStore((s) => s.model.relationships.find((r) => r.id === relId));
  const entities = useModelStore((s) => s.model.entities);
  const update = useModelStore((s) => s.updateRelationship);
  const caps = inspectorCaps(useModelStore((s) => s.model.level));
  const [tab, setTab] = useState("General");
  if (!rel) return null;
  const parent = entities.find((e) => e.id === rel.parentEntity);
  const child = entities.find((e) => e.id === rel.childEntity);
  const patch = (p: Parameters<typeof update>[1]) => update(rel.id, p);

  return (
    <>
      <div className="props__head">
        <h2 className="modal__title">
          Relationship: {parent?.name} → {child?.name}
        </h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      <Tabs
        tabs={["General", "Verb phrases", ...(caps.referentialIntegrity ? ["RI"] : []), "Definition", "Note", "UDP"]}
        active={tab}
        onChange={setTab}
      />
      <div className="props__body">
        {tab === "General" && (
          <>
            <p className="editor__rel-summary">
              <strong>{parent?.name}</strong> {rel.cardinality} <strong>{child?.name}</strong>
            </p>
            <p className="field__hint">
              {rel.subtype ? "Subtype / category" : rel.identifying ? "Identifying" : "Non-identifying"}
            </p>
            <div className="editor__section--row">
              <label className="checkbox">
                <input type="checkbox" checked={rel.parentOptional} onChange={(e) => patch({ parentOptional: e.target.checked })} />
                {parent?.name} optional
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={rel.childOptional} onChange={(e) => patch({ childOptional: e.target.checked })} />
                {child?.name} optional
              </label>
            </div>
          </>
        )}
        {tab === "Verb phrases" && (
          <>
            <div className="field">
              <label>Parent → child (e.g. “places”)</label>
              <input defaultValue={rel.label ?? ""} onChange={(e) => patch({ label: e.target.value || undefined })} />
            </div>
            <div className="field">
              <label>Child → parent (e.g. “is placed by”)</label>
              <input defaultValue={rel.childVerbPhrase ?? ""} onChange={(e) => patch({ childVerbPhrase: e.target.value || undefined })} />
            </div>
          </>
        )}
        {tab === "RI" && (
          <>
            <div className="field">
              <label>On delete</label>
              <select value={rel.onDelete ?? "no action"} onChange={(e) => patch({ onDelete: e.target.value as RiAction })}>
                {RI_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>On update</label>
              <select value={rel.onUpdate ?? "no action"} onChange={(e) => patch({ onUpdate: e.target.value as RiAction })}>
                {RI_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="checkbox">
                <input type="checkbox" checked={!!rel.enforced} onChange={(e) => patch({ enforced: e.target.checked || undefined })} />
                Enforced by the database
              </label>
              <p className="field__hint">
                Snowflake standard tables DECLARE but do not ENFORCE foreign keys (only hybrid
                tables enforce). Leave off unless the target DB truly enforces this relationship.
              </p>
            </div>
            <p className="field__hint">Exported as ON DELETE / ON UPDATE on the foreign key.</p>
          </>
        )}
        {tab === "Definition" && (
          <textarea className="editor__input" rows={8} defaultValue={rel.description ?? ""} onChange={(e) => patch({ description: e.target.value || undefined })} />
        )}
        {tab === "Note" && (
          <textarea className="editor__input" rows={8} defaultValue={rel.note ?? ""} onChange={(e) => patch({ note: e.target.value || undefined })} />
        )}
        {tab === "UDP" && <UdpEditor udps={rel.udps} onChange={(u) => patch({ udps: u.length ? u : undefined })} />}
      </div>
    </>
  );
}
