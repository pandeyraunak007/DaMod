import { useEffect, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  DATA_TYPE_KINDS,
  paramShape,
  type DataTypeKind,
} from "../model/dataTypes";
import {
  LOGICAL_TYPE_KINDS,
  type LogicalTypeKind,
  type ModelLevel,
  isConceptual,
  usesLogicalTypes,
  usesPhysicalTypes,
} from "../model/levels";
import { validateIdentifier } from "../model/identifiers";
import type { Entity, Field } from "../model/model";
import { componentFor, entityKey, linksTouching } from "../links/links";
import { newId } from "../lib/ids";

// An input for identifier-valued names (entity/field). Keeps a local draft so the
// field can be freely erased and retyped; commits to the store only when the value
// is a valid identifier, and reverts to the last committed value on blur if the
// current draft is invalid. Reports the current error to the parent for display.
function IdentifierInput({
  value,
  onCommit,
  onError,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  onError?: (err: string | null) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState<string | null>(null);

  // Resync when the committed value changes (undo/redo, external edit).
  useEffect(() => {
    setDraft(value);
    setErr(null);
    onError?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={`${className ?? ""} ${err ? "is-error" : ""}`}
      value={draft}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        const error = validateIdentifier(v);
        setErr(error);
        onError?.(error);
        if (!error) onCommit(v);
      }}
      onBlur={() => {
        if (err) {
          setDraft(value);
          setErr(null);
          onError?.(null);
        }
      }}
    />
  );
}

export function SidePanel() {
  const selection = useModelStore((s) => s.selection);
  const entity = useModelStore((s) =>
    selection?.kind === "entity"
      ? s.model.entities.find((e) => e.id === selection.id)
      : undefined,
  );
  const relId = selection?.kind === "relationship" ? selection.id : null;

  return (
    <aside className="side">
      {entity ? (
        <EntityEditor entity={entity} />
      ) : relId ? (
        <RelationshipEditor relId={relId} />
      ) : (
        <div className="side__empty">
          <p>Nothing selected.</p>
          <p className="side__hint">
            Select an entity or relationship, or add an entity from the toolbar.
          </p>
        </div>
      )}
    </aside>
  );
}

function EntityEditor({ entity }: { entity: Entity }) {
  const entities = useModelStore((s) => s.model.entities);
  const level = useModelStore((s) => s.model.level);
  const modelId = useModelStore((s) => s.model.id);
  const renameEntity = useModelStore((s) => s.renameEntity);
  const updateEntity = useModelStore((s) => s.updateEntity);
  const addField = useModelStore((s) => s.addField);
  const openRelationshipDraft = useModelStore((s) => s.openRelationshipDraft);
  const openLinkDraft = useModelStore((s) => s.openLinkDraft);

  const [nameError, setNameError] = useState<string | null>(null);

  const startRelationship = () => {
    const other = entities.find((e) => e.id !== entity.id);
    openRelationshipDraft(entity.id, other ? other.id : entity.id);
  };

  const duplicateName = entities.some(
    (e) => e.id !== entity.id && e.name === entity.name,
  );

  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Entity name</label>
        <IdentifierInput
          className="editor__input"
          value={entity.name}
          onCommit={(v) => renameEntity(entity.id, v)}
          onError={setNameError}
        />
        {nameError && <p className="editor__error">{nameError}</p>}
        {!nameError && duplicateName && (
          <p className="editor__error editor__error--warn">
            Another entity is already named “{entity.name}”.
          </p>
        )}
      </div>

      <div className="editor__section">
        <label className="editor__label">Description</label>
        <textarea
          className="editor__input"
          rows={2}
          value={entity.description ?? ""}
          onChange={(e) => updateEntity(entity.id, { description: e.target.value })}
        />
      </div>

      <div className="editor__section">
        <label className="editor__label">Tags (comma-separated)</label>
        <input
          className="editor__input"
          value={entity.tags?.join(", ") ?? ""}
          onChange={(e) =>
            updateEntity(entity.id, {
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <div className="editor__section">
        <div className="editor__fields-head">
          <span className="editor__label">Fields</span>
          <button className="btn btn--small" onClick={() => addField(entity.id)}>
            + Field
          </button>
        </div>
        {isConceptual(level) && (
          <p className="side__hint">Conceptual model — fields carry names only.</p>
        )}
        <div className="fields">
          {entity.fields.map((f, i) => (
            <FieldRow
              key={f.id}
              entity={entity}
              field={f}
              index={i}
              total={entity.fields.length}
              level={level}
            />
          ))}
          {entity.fields.length === 0 && (
            <p className="side__hint">No fields yet. Add one above.</p>
          )}
        </div>
      </div>

      <div className="editor__section editor__section--row">
        <button className="btn btn--small" onClick={startRelationship}>
          + Relationship
        </button>
        <button
          className="btn btn--small"
          onClick={() => openLinkDraft({ model: modelId, entity: entity.id })}
        >
          + Link (same-as)
        </button>
      </div>

      <ConceptGroupSection modelId={modelId} entity={entity} />
      <WhereUsed modelId={modelId} entity={entity} />
    </div>
  );
}

// Name a same-as concept group and pick its canonical entity (FR-6.7). Shown only
// when the entity is part of a same-as component.
function ConceptGroupSection({ modelId, entity }: { modelId: string; entity: Entity }) {
  const links = useWorkspaceStore((s) => s.links);
  const upsertConceptGroup = useWorkspaceStore((s) => s.upsertConceptGroup);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const syncFields = useModelStore((s) => s.syncFields);
  const pushNotice = useModelStore((s) => s.pushNotice);

  const component = componentFor(links.links, modelId, entity.id);
  if (!component || component.length < 2) return null;

  const models = allModels();
  const label = (m: string, e: string) => {
    const mm = models.find((x) => x.id === m);
    const ent = mm?.model.entities.find((en) => en.id === e);
    return `${mm?.name ?? "?"}.${ent?.name ?? "?"}`;
  };

  const keys = new Set(component.map((r) => entityKey(r.model, r.entity)));
  const group = links.conceptGroups.find((g) =>
    keys.has(entityKey(g.canonical.model, g.canonical.entity)),
  );

  const isCanonical =
    group && group.canonical.model === modelId && group.canonical.entity === entity.id;
  const canonicalEntity =
    group &&
    models
      .find((m) => m.id === group.canonical.model)
      ?.model.entities.find((e) => e.id === group.canonical.entity);

  const syncFromCanonical = () => {
    if (!canonicalEntity) return;
    const added = syncFields(entity.id, canonicalEntity.fields);
    pushNotice(added ? `Added ${added} field(s) from the canonical entity.` : "Nothing to sync.");
  };

  const setName = (name: string) =>
    upsertConceptGroup({
      id: group?.id ?? newId("conceptGroup"),
      name,
      canonical: group?.canonical ?? { model: component[0].model, entity: component[0].entity },
    });
  const setCanonical = (value: string) => {
    const [m, e] = value.split("|");
    upsertConceptGroup({
      id: group?.id ?? newId("conceptGroup"),
      name: group?.name ?? entity.name,
      canonical: { model: m, entity: e },
    });
  };

  return (
    <div className="editor__section">
      <span className="editor__label">Concept group</span>
      <input
        className="editor__input"
        placeholder="Group name (e.g. Customer)"
        value={group?.name ?? ""}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="editor__label" style={{ marginTop: "0.4rem" }}>
        Canonical entity
      </label>
      <select
        className="editor__input"
        value={group ? `${group.canonical.model}|${group.canonical.entity}` : ""}
        onChange={(e) => setCanonical(e.target.value)}
      >
        <option value="">Choose…</option>
        {component.map((r) => (
          <option key={entityKey(r.model, r.entity)} value={`${r.model}|${r.entity}`}>
            {label(r.model, r.entity)}
          </option>
        ))}
      </select>
      {group && !isCanonical && canonicalEntity && (
        <button className="btn btn--small" style={{ marginTop: "0.4rem" }} onClick={syncFromCanonical}>
          Sync fields from canonical ({canonicalEntity.name})
        </button>
      )}
    </div>
  );
}

// Where used (FR-6.8): every link that depends on this entity, across all models.
function WhereUsed({ modelId, entity }: { modelId: string; entity: Entity }) {
  const links = useWorkspaceStore((s) => s.links);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const deleteLink = useWorkspaceStore((s) => s.deleteLink);

  const touching = linksTouching(links.links, { model: modelId, entity: entity.id });
  if (touching.length === 0) return null;

  const models = allModels();
  const label = (m: string, e: string) => {
    const mm = models.find((x) => x.id === m);
    const ent = mm?.model.entities.find((en) => en.id === e);
    return `${mm?.name ?? "?"}.${ent?.name ?? "?"}`;
  };

  return (
    <div className="editor__section">
      <span className="editor__label">Where used ({touching.length})</span>
      <ul className="whereused">
        {touching.map((l) => {
          const onFrom = l.from.model === modelId && l.from.entity === entity.id;
          const other = onFrom ? l.to : l.from;
          return (
            <li key={l.id} className="whereused__row">
              <span>
                {l.type} → {label(other.model, other.entity)}
              </span>
              <button className="field-row__del" title="Delete link" onClick={() => deleteLink(l.id)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FieldRow({
  entity,
  field,
  index,
  total,
  level,
}: {
  entity: Entity;
  field: Field;
  index: number;
  total: number;
  level: ModelLevel;
}) {
  const updateField = useModelStore((s) => s.updateField);
  const deleteField = useModelStore((s) => s.deleteField);
  const reorderField = useModelStore((s) => s.reorderField);
  const modelId = useModelStore((s) => s.model.id);
  const openLinkDraft = useModelStore((s) => s.openLinkDraft);
  const [nameError, setNameError] = useState<string | null>(null);

  const duplicate = entity.fields.some((o) => o.id !== field.id && o.name === field.name);
  const shape = field.type ? paramShape(field.type) : "none";
  const conceptual = isConceptual(level);
  const showPhysical = usesPhysicalTypes(level);
  const showLogical = usesLogicalTypes(level);

  return (
    <div className="field-row">
      <div className="field-row__line">
        <IdentifierInput
          className="field-row__name"
          value={field.name}
          onCommit={(v) => updateField(entity.id, field.id, { name: v })}
          onError={setNameError}
        />
        {showPhysical && (
          <select
            className="field-row__type"
            title="Physical type"
            value={field.type ?? "string"}
            onChange={(e) =>
              updateField(entity.id, field.id, { type: e.target.value as DataTypeKind })
            }
          >
            {DATA_TYPE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        {showLogical && !showPhysical && (
          <select
            className="field-row__type"
            title="Logical type"
            value={field.logicalType ?? "Text"}
            onChange={(e) =>
              updateField(entity.id, field.id, {
                logicalType: e.target.value as LogicalTypeKind,
              })
            }
          >
            {LOGICAL_TYPE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        <button
          className="field-row__del"
          title="Add link (references / derived-from)"
          onClick={() => openLinkDraft({ model: modelId, entity: entity.id, field: field.id })}
        >
          🔗
        </button>
        <button
          className="field-row__del"
          title="Delete field"
          onClick={() => deleteField(entity.id, field.id)}
        >
          ✕
        </button>
      </div>

      {/* Hybrid: logical name + generic type shown beside the physical column (FR-11.5). */}
      {showPhysical && showLogical && (
        <div className="field-row__params">
          <label>
            logical name
            <input
              value={field.logicalName ?? ""}
              onChange={(e) =>
                updateField(entity.id, field.id, { logicalName: e.target.value })
              }
            />
          </label>
          <label>
            logical type
            <select
              value={field.logicalType ?? "Text"}
              onChange={(e) =>
                updateField(entity.id, field.id, {
                  logicalType: e.target.value as LogicalTypeKind,
                })
              }
            >
              {LOGICAL_TYPE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {showPhysical && shape === "length" && (
        <div className="field-row__params">
          <label>
            length
            <input
              type="number"
              min={1}
              value={field.length ?? 255}
              onChange={(e) =>
                updateField(entity.id, field.id, { length: Number(e.target.value) })
              }
            />
          </label>
        </div>
      )}
      {showPhysical && shape === "decimal" && (
        <div className="field-row__params">
          <label>
            precision
            <input
              type="number"
              min={1}
              value={field.precision ?? 12}
              onChange={(e) =>
                updateField(entity.id, field.id, { precision: Number(e.target.value) })
              }
            />
          </label>
          <label>
            scale
            <input
              type="number"
              min={0}
              value={field.scale ?? 2}
              onChange={(e) =>
                updateField(entity.id, field.id, { scale: Number(e.target.value) })
              }
            />
          </label>
        </div>
      )}

      {conceptual ? (
        <div className="field-row__flags">
          <span className="field-row__spacer" />
          <button
            className="field-row__move"
            disabled={index === 0}
            onClick={() => reorderField(entity.id, index, index - 1)}
            title="Move up"
          >
            ↑
          </button>
          <button
            className="field-row__move"
            disabled={index === total - 1}
            onClick={() => reorderField(entity.id, index, index + 1)}
            title="Move down"
          >
            ↓
          </button>
        </div>
      ) : (
      <div className="field-row__flags">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={field.primaryKey}
            onChange={(e) =>
              updateField(entity.id, field.id, {
                primaryKey: e.target.checked,
                // A PK is implicitly NOT NULL.
                nullable: e.target.checked ? false : field.nullable,
              })
            }
          />
          PK
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!field.nullable}
            onChange={(e) => updateField(entity.id, field.id, { nullable: !e.target.checked })}
          />
          NOT NULL
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={field.unique}
            onChange={(e) => updateField(entity.id, field.id, { unique: e.target.checked })}
          />
          Unique
        </label>
        <span className="field-row__spacer" />
        <button
          className="field-row__move"
          disabled={index === 0}
          onClick={() => reorderField(entity.id, index, index - 1)}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="field-row__move"
          disabled={index === total - 1}
          onClick={() => reorderField(entity.id, index, index + 1)}
          title="Move down"
        >
          ↓
        </button>
      </div>
      )}

      {nameError && <p className="editor__error">{nameError}</p>}
      {!nameError && duplicate && (
        <p className="editor__error editor__error--warn">Duplicate field name.</p>
      )}
    </div>
  );
}

function RelationshipEditor({ relId }: { relId: string }) {
  const rel = useModelStore((s) => s.model.relationships.find((r) => r.id === relId));
  const entities = useModelStore((s) => s.model.entities);
  const updateRelationship = useModelStore((s) => s.updateRelationship);
  const deleteRelationship = useModelStore((s) => s.deleteRelationship);

  if (!rel) return null;
  const parent = entities.find((e) => e.id === rel.parentEntity);
  const child = entities.find((e) => e.id === rel.childEntity);

  return (
    <div className="editor">
      <div className="editor__section">
        <span className="editor__label">Relationship</span>
        <p className="editor__rel-summary">
          <strong>{parent?.name ?? "?"}</strong> {rel.cardinality}{" "}
          <strong>{child?.name ?? "?"}</strong>
        </p>
        <p className="field__hint">
          {rel.subtype
            ? "Subtype / category"
            : rel.cardinality === "many-to-many"
              ? "Junction relationship"
              : rel.identifying
                ? "Identifying (FK in primary key, solid line)"
                : "Non-identifying (dashed line)"}
        </p>
      </div>

      <div className="editor__section">
        <label className="editor__label">Label</label>
        <input
          className="editor__input"
          value={rel.label ?? ""}
          placeholder="e.g. places"
          onChange={(e) => updateRelationship(rel.id, { label: e.target.value })}
        />
      </div>

      <div className="editor__section">
        <label className="editor__label">Description</label>
        <textarea
          className="editor__input"
          rows={2}
          value={rel.description ?? ""}
          onChange={(e) => updateRelationship(rel.id, { description: e.target.value })}
        />
      </div>

      <div className="editor__section editor__section--row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rel.parentOptional}
            onChange={(e) => updateRelationship(rel.id, { parentOptional: e.target.checked })}
          />
          {parent?.name} optional
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rel.childOptional}
            onChange={(e) => updateRelationship(rel.id, { childOptional: e.target.checked })}
          />
          {child?.name} optional
        </label>
      </div>

      <div className="editor__section">
        <button className="btn btn--danger" onClick={() => deleteRelationship(rel.id)}>
          Delete relationship
        </button>
      </div>
    </div>
  );
}
