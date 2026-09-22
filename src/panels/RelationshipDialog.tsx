import { useMemo, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { primaryKeyFields } from "../model/model";
import { suggestForeignKeyName, suggestJunctionName } from "../model/operations";

interface Props {
  onClose: () => void;
}

// Relationship types combine cardinality with the ERwin/IDEF1X distinctions:
// identifying (FK is part of the child's key, solid line) vs non-identifying
// (dashed), plus subtype/category (child shares the parent's key).
const REL_TYPES = [
  { key: "nonid-1m", label: "Non-identifying · one-to-many", cardinality: "one-to-many", identifying: false, subtype: false },
  { key: "nonid-11", label: "Non-identifying · one-to-one", cardinality: "one-to-one", identifying: false, subtype: false },
  { key: "id-1m", label: "Identifying · one-to-many", cardinality: "one-to-many", identifying: true, subtype: false },
  { key: "id-11", label: "Identifying · one-to-one", cardinality: "one-to-one", identifying: true, subtype: false },
  { key: "subtype", label: "Subtype / category", cardinality: "one-to-one", identifying: true, subtype: true },
  { key: "m2m", label: "Many-to-many", cardinality: "many-to-many", identifying: false, subtype: false },
] as const;

const TYPE_HINT: Record<string, string> = {
  "nonid-1m": "The foreign key is a regular column (dashed line).",
  "nonid-11": "The foreign key is a regular unique column (dashed line).",
  "id-1m": "The foreign key becomes part of the child's primary key (solid line).",
  "id-11": "The foreign key becomes part of the child's primary key (solid line).",
  subtype: "The child is a subtype that shares the parent's primary key.",
  m2m: "A junction table is created with both foreign keys as a composite primary key.",
};

// Shown when dragging one entity onto another (drag source = parent, target =
// child) or from the side-panel "New relationship" button (FR-3.1). Parent/child
// are dropdowns (swap or self-reference). For M:N a junction entity is created.
export function RelationshipDialog({ onClose }: Props) {
  const entities = useModelStore((s) => s.model.entities);
  const level = useModelStore((s) => s.model.level);
  const draft = useModelStore((s) => s.relationshipDraft);
  const createRelationship = useModelStore((s) => s.createRelationship);

  const [parentId, setParentId] = useState(draft?.source ?? "");
  const [childId, setChildId] = useState(draft?.target ?? "");
  const [relTypeKey, setRelTypeKey] = useState<string>("nonid-1m");
  const [parentOptional, setParentOptional] = useState(false);
  const [childOptional, setChildOptional] = useState(true);
  const [label, setLabel] = useState("");
  const [fkName, setFkName] = useState<string | null>(null);
  const [junctionName, setJunctionName] = useState<string | null>(null);

  const relType = REL_TYPES.find((t) => t.key === relTypeKey) ?? REL_TYPES[0];
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

  if (!parent || !child) return null;

  const parentHasPk = primaryKeyFields(parent).length > 0;
  const selfRef = parentId === childId;
  const isM2M = relType.cardinality === "many-to-many";

  const submit = () => {
    if (isM2M) {
      createRelationship({
        cardinality: "many-to-many",
        parentEntity: parentId,
        childEntity: childId,
        parentOptional,
        childOptional,
        label: label || undefined,
        junctionName: junctionName ?? suggestedJunction,
      });
    } else {
      createRelationship({
        cardinality: relType.cardinality,
        parentEntity: parentId,
        childEntity: childId,
        parentOptional,
        childOptional,
        label: label || undefined,
        identifying: relType.identifying,
        subtype: relType.subtype,
        foreignKeyFieldName: relType.subtype ? undefined : fkName ?? suggestedFk,
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
            <label>{relType.subtype ? "Supertype (parent)" : "Parent (holds key)"}</label>
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
            <label>{relType.subtype ? "Subtype (child)" : "Child (holds foreign key)"}</label>
            <select value={childId} onChange={(e) => setChildId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {selfRef && <p className="field__hint">Self-reference on {parent.name}.</p>}

        <div className="field">
          <label>Relationship type</label>
          <select value={relTypeKey} onChange={(e) => setRelTypeKey(e.target.value)}>
            {REL_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="field__hint">{TYPE_HINT[relType.key]}</p>
        </div>

        {level === "Conceptual" ? (
          <p className="field__hint">
            Conceptual model — the relationship is drawn as a line only, with no
            foreign-key fields.
          </p>
        ) : isM2M ? (
          <div className="field">
            <label>Junction entity name</label>
            <input value={junctionName ?? suggestedJunction} onChange={(e) => setJunctionName(e.target.value)} />
          </div>
        ) : relType.subtype ? (
          <p className="field__hint">
            {child.name} will inherit {parent.name}'s primary key.
          </p>
        ) : (
          <div className="field">
            <label>Foreign-key field on {child.name}</label>
            <input value={fkName ?? suggestedFk} onChange={(e) => setFkName(e.target.value)} />
            {!parentHasPk && (
              <p className="field__hint field__hint--warn">
                {parent.name} has no primary key; the field will default to uuid.
              </p>
            )}
          </div>
        )}

        <div className="modal__row modal__row--pair">
          <label className="checkbox">
            <input type="checkbox" checked={parentOptional} onChange={(e) => setParentOptional(e.target.checked)} />
            {parent.name} optional
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={childOptional} onChange={(e) => setChildOptional(e.target.checked)} />
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
