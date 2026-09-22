import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import {
  DATA_TYPE_KINDS,
  paramShape,
  type DataTypeKind,
} from "../model/dataTypes";
import { validateIdentifier } from "../model/identifiers";
import type { Entity, Field, RiAction, Udp } from "../model/model";

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
  const [tab, setTab] = useState("General");
  const patch = (p: Parameters<typeof updateEntity>[1]) => updateEntity(entity.id, p);

  return (
    <>
      <div className="props__head">
        <h2 className="modal__title">Entity: {entity.name}</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      <Tabs tabs={["General", "Fields", "Definition", "Note", "UDP"]} active={tab} onChange={setTab} />
      <div className="props__body">
        {tab === "General" && (
          <>
            <div className="field">
              <label>Name</label>
              <input
                defaultValue={entity.name}
                onChange={(e) => !validateIdentifier(e.target.value) && renameEntity(entity.id, e.target.value)}
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
          </>
        )}
        {tab === "Fields" && <FieldsTab entity={entity} />}
        {tab === "Definition" && (
          <textarea className="editor__input" rows={8} defaultValue={entity.description ?? ""} onChange={(e) => patch({ description: e.target.value })} />
        )}
        {tab === "Note" && (
          <textarea className="editor__input" rows={8} defaultValue={entity.note ?? ""} onChange={(e) => patch({ note: e.target.value })} />
        )}
        {tab === "UDP" && <UdpEditor udps={entity.udps} onChange={(u) => patch({ udps: u })} />}
      </div>
    </>
  );
}

function FieldsTab({ entity }: { entity: Entity }) {
  const [openId, setOpenId] = useState<string | null>(entity.fields[0]?.id ?? null);
  return (
    <div>
      {entity.fields.map((f) => (
        <div key={f.id} className="props__field">
          <button className="props__field-head" onClick={() => setOpenId(openId === f.id ? null : f.id)}>
            <span>{openId === f.id ? "▾" : "▸"}</span>
            <strong>{f.name}</strong>
            <span className="field__hint">{f.primaryKey ? "PK" : f.unique ? "unique" : ""}</span>
          </button>
          {openId === f.id && <FieldProps entityId={entity.id} field={f} />}
        </div>
      ))}
      {entity.fields.length === 0 && <p className="side__hint">No fields.</p>}
    </div>
  );
}

function FieldProps({ entityId, field }: { entityId: string; field: Field }) {
  const updateField = useModelStore((s) => s.updateField);
  const patch = (p: Partial<Field>) => updateField(entityId, field.id, p);
  const shape = field.type ? paramShape(field.type) : "none";
  return (
    <div className="props__field-body">
      <div className="attr-row">
        <input
          defaultValue={field.name}
          onChange={(e) => !validateIdentifier(e.target.value) && patch({ name: e.target.value })}
        />
        <select value={field.type ?? "string"} onChange={(e) => patch({ type: e.target.value as DataTypeKind })}>
          {DATA_TYPE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      {shape === "length" && (
        <label className="field-row__params">
          length
          <input type="number" value={field.length ?? 255} onChange={(e) => patch({ length: Number(e.target.value) })} />
        </label>
      )}
      {shape === "decimal" && (
        <div className="field-row__params">
          <label>
            precision
            <input type="number" value={field.precision ?? 12} onChange={(e) => patch({ precision: Number(e.target.value) })} />
          </label>
          <label>
            scale
            <input type="number" value={field.scale ?? 2} onChange={(e) => patch({ scale: Number(e.target.value) })} />
          </label>
        </div>
      )}
      <div className="field-row__flags">
        <label className="checkbox">
          <input type="checkbox" checked={field.primaryKey} onChange={(e) => patch({ primaryKey: e.target.checked, nullable: e.target.checked ? false : field.nullable })} />
          PK
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={!field.nullable} onChange={(e) => patch({ nullable: !e.target.checked })} />
          NOT NULL
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={field.unique} onChange={(e) => patch({ unique: e.target.checked })} />
          Unique
        </label>
      </div>
      <div className="field">
        <label>Default (SQL)</label>
        <input defaultValue={field.default ?? ""} onChange={(e) => patch({ default: e.target.value || undefined })} />
      </div>
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
      <Tabs tabs={["General", "Verb phrases", "RI", "Definition", "Note", "UDP"]} active={tab} onChange={setTab} />
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
            <p className="field__hint">Exported as ON DELETE / ON UPDATE on the Postgres foreign key.</p>
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
