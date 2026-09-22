import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import {
  DATA_TYPE_KINDS,
  paramShape,
  type DataTypeKind,
} from "../model/dataTypes";
import { validateIdentifier } from "../model/identifiers";
import type { Entity, Field } from "../model/model";

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
  const renameEntity = useModelStore((s) => s.renameEntity);
  const updateEntity = useModelStore((s) => s.updateEntity);
  const addField = useModelStore((s) => s.addField);
  const openRelationshipDraft = useModelStore((s) => s.openRelationshipDraft);

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
        <input
          className={`editor__input ${nameError ? "is-error" : ""}`}
          value={entity.name}
          onChange={(e) => {
            const err = renameEntity(entity.id, e.target.value);
            setNameError(err);
          }}
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
        <div className="fields">
          {entity.fields.map((f, i) => (
            <FieldRow
              key={f.id}
              entity={entity}
              field={f}
              index={i}
              total={entity.fields.length}
            />
          ))}
          {entity.fields.length === 0 && (
            <p className="side__hint">No fields yet. Add one above.</p>
          )}
        </div>
      </div>

      <div className="editor__section">
        <button className="btn btn--small" onClick={startRelationship}>
          + Relationship from {entity.name}
        </button>
      </div>
    </div>
  );
}

function FieldRow({
  entity,
  field,
  index,
  total,
}: {
  entity: Entity;
  field: Field;
  index: number;
  total: number;
}) {
  const updateField = useModelStore((s) => s.updateField);
  const deleteField = useModelStore((s) => s.deleteField);
  const reorderField = useModelStore((s) => s.reorderField);
  const [nameError, setNameError] = useState<string | null>(null);

  const duplicate = entity.fields.some((o) => o.id !== field.id && o.name === field.name);
  const shape = paramShape(field.type);

  return (
    <div className="field-row">
      <div className="field-row__line">
        <input
          className={`field-row__name ${nameError ? "is-error" : ""}`}
          value={field.name}
          onChange={(e) => {
            const err = validateIdentifier(e.target.value);
            setNameError(err);
            if (!err) updateField(entity.id, field.id, { name: e.target.value });
          }}
        />
        <select
          className="field-row__type"
          value={field.type}
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
        <button
          className="field-row__del"
          title="Delete field"
          onClick={() => deleteField(entity.id, field.id)}
        >
          ✕
        </button>
      </div>

      {shape === "length" && (
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
      {shape === "decimal" && (
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
