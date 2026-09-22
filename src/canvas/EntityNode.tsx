import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useModelStore } from "../store/modelStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import { isConceptual } from "../model/levels";

// A canvas card for one entity (FR-4.1): name plus fields with key markers and
// types. Double-clicking the name renames it inline (FR-4.3), rejecting invalid
// identifiers (AT-1.2).
function EntityNodeImpl({ data, selected }: NodeProps) {
  const entityId = data.entityId as string;
  const entity = useModelStore((s) => s.model.entities.find((e) => e.id === entityId));
  const level = useModelStore((s) => s.model.level);
  const renameEntity = useModelStore((s) => s.renameEntity);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!entity) return null;

  const startEdit = () => {
    setDraft(entity.name);
    setError(null);
    setEditing(true);
  };

  const commit = () => {
    const err = renameEntity(entity.id, draft);
    if (err) {
      setError(err);
      return; // keep editing, name unchanged (AT-1.2)
    }
    setEditing(false);
  };

  return (
    <div className={`entity ${selected ? "entity--selected" : ""} ${entity.junction ? "entity--junction" : ""}`}>
      <Handle type="target" position={Position.Left} className="entity__handle" />
      <Handle type="source" position={Position.Right} className="entity__handle" />

      <div className="entity__header" onDoubleClick={startEdit}>
        {editing ? (
          <div className="entity__rename">
            <input
              ref={inputRef}
              className={`entity__rename-input ${error ? "is-error" : ""}`}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={commit}
            />
            {error && <div className="entity__rename-error">{error}</div>}
          </div>
        ) : (
          <span className="entity__name">{entity.name}</span>
        )}
      </div>

      {/* Conceptual models draw entity boxes with no field rows (FR-11.2). */}
      {!isConceptual(level) && (
        <ul className="entity__fields">
          {entity.fields.length === 0 && <li className="entity__empty">no fields</li>}
          {entity.fields.map((f) => (
            <li key={f.id} className="entity__field">
              <span className="entity__key">
                {f.primaryKey ? "PK" : f.unique ? "U" : ""}
              </span>
              <span className="entity__field-name">{f.name}</span>
              <span className="entity__field-type">
                {fieldTypeLabel(f, level)}
                {!f.nullable && <span className="entity__notnull" title="NOT NULL"> •</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const EntityNode = memo(EntityNodeImpl);
