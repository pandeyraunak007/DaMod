import { useMemo, useState } from "react";
import { useModelStore } from "../store/modelStore";
import type { Cardinality } from "../model/model";
import { primaryKeyFields } from "../model/model";
import {
  suggestForeignKeyName,
  suggestJunctionName,
} from "../model/operations";

interface Props {
  onClose: () => void;
}

const CARDINALITIES: { value: Cardinality; label: string }[] = [
  { value: "one-to-one", label: "One-to-one" },
  { value: "one-to-many", label: "One-to-many" },
  { value: "many-to-many", label: "Many-to-many" },
];

// Shown when dragging one entity onto another (drag source = parent, holding the
// primary key; target = child, getting the foreign key) or from the side-panel
// "New relationship" button (FR-3.1). Parent and child are dropdowns, so they can
// be swapped or set to the same entity for a self-reference (FR-3.6). For M:N a
// junction entity is always created.
export function RelationshipDialog({ onClose }: Props) {
  const entities = useModelStore((s) => s.model.entities);
  const draft = useModelStore((s) => s.relationshipDraft);
  const createRelationship = useModelStore((s) => s.createRelationship);

  const [parentId, setParentId] = useState(draft?.source ?? "");
  const [childId, setChildId] = useState(draft?.target ?? "");
  const [cardinality, setCardinality] = useState<Cardinality>("one-to-many");
  const [parentOptional, setParentOptional] = useState(false);
  const [childOptional, setChildOptional] = useState(true);
  const [label, setLabel] = useState("");

  const parent = entities.find((e) => e.id === parentId);
  const child = entities.find((e) => e.id === childId);

  const suggestedFk = useMemo(
    () => (parent ? suggestForeignKeyName(parent.name, primaryKeyFields(parent)[0]) : "fk_id"),
    [parent],
  );
  const suggestedJunction = useMemo(
    () => (parent && child ? suggestJunctionName(parent.name, child.name) : "Junction"),
    [parent, child],
  );
  const [fkName, setFkName] = useState<string | null>(null);
  const [junctionName, setJunctionName] = useState<string | null>(null);

  if (!parent || !child) return null;

  const parentHasPk = primaryKeyFields(parent).length > 0;
  const selfRef = parentId === childId;

  const submit = () => {
    if (cardinality === "many-to-many") {
      createRelationship({
        cardinality,
        parentEntity: parentId,
        childEntity: childId,
        parentOptional,
        childOptional,
        label: label || undefined,
        junctionName: junctionName ?? suggestedJunction,
      });
    } else {
      createRelationship({
        cardinality,
        parentEntity: parentId,
        childEntity: childId,
        parentOptional,
        childOptional,
        label: label || undefined,
        foreignKeyFieldName: fkName ?? suggestedFk,
      });
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">New relationship</h2>

        <div className="modal__row modal__row--pair">
          <div className="field">
            <label>Parent (holds key)</label>
            <select
              value={parentId}
              onChange={(e) => {
                setParentId(e.target.value);
                setFkName(null);
              }}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Child (holds foreign key)</label>
            <select value={childId} onChange={(e) => setChildId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {selfRef && (
          <p className="field__hint">Self-reference on {parent.name}.</p>
        )}

        <div className="field">
          <label>Cardinality</label>
          <select value={cardinality} onChange={(e) => setCardinality(e.target.value as Cardinality)}>
            {CARDINALITIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {cardinality !== "many-to-many" ? (
          <div className="field">
            <label>Foreign-key field on {child.name}</label>
            <input
              value={fkName ?? suggestedFk}
              onChange={(e) => setFkName(e.target.value)}
            />
            {!parentHasPk && (
              <p className="field__hint field__hint--warn">
                {parent.name} has no primary key; the field will default to uuid.
              </p>
            )}
            <p className="field__hint">
              Created with {parent.name}'s primary key type.
            </p>
          </div>
        ) : (
          <div className="field">
            <label>Junction entity name</label>
            <input
              value={junctionName ?? suggestedJunction}
              onChange={(e) => setJunctionName(e.target.value)}
            />
            <p className="field__hint">
              A junction table with both foreign keys as a composite primary key.
            </p>
          </div>
        )}

        <div className="modal__row modal__row--pair">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={parentOptional}
              onChange={(e) => setParentOptional(e.target.checked)}
            />
            {parent.name} optional
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={childOptional}
              onChange={(e) => setChildOptional(e.target.checked)}
            />
            {child.name} optional
          </label>
        </div>

        <div className="field">
          <label>Label (optional verb, e.g. places)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="places" />
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
