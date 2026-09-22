import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import { isConceptual } from "../model/levels";
import { type Ref, linksTouching } from "../links/links";

// A canvas card for one entity (FR-4.1): name plus fields with key markers and
// types. Double-clicking the name renames it inline (FR-4.3), rejecting invalid
// identifiers (AT-1.2).
function EntityNodeImpl({ data, selected }: NodeProps) {
  const entityId = data.entityId as string;
  const entity = useModelStore((s) => s.model.entities.find((e) => e.id === entityId));
  const level = useModelStore((s) => s.model.level);
  const modelId = useModelStore((s) => s.model.id);
  const renameEntity = useModelStore((s) => s.renameEntity);
  const links = useWorkspaceStore((s) => s.links.links);
  const allModels = useWorkspaceStore((s) => s.allModels);

  const linkTitle = (ref: Ref): string => {
    const touching = linksTouching(links, ref);
    if (touching.length === 0) return "";
    const models = allModels();
    const nameFor = (m: string, e: string) => {
      const mm = models.find((x) => x.id === m);
      const ent = mm?.model.entities.find((en) => en.id === e);
      return `${mm?.name ?? "?"}.${ent?.name ?? "?"}`;
    };
    return touching
      .map((l) => {
        const onFrom = l.from.model === ref.model && l.from.entity === ref.entity;
        const other = onFrom ? l.to : l.from;
        return `${l.type} → ${nameFor(other.model, other.entity)}`;
      })
      .join("\n");
  };

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
      <Handle type="target" position={Position.Left} id="l" className="entity__handle" />
      <Handle type="source" position={Position.Right} id="r" className="entity__handle" />
      <Handle type="target" position={Position.Top} id="t" className="entity__handle" />
      <Handle type="source" position={Position.Bottom} id="b" className="entity__handle" />

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
        {!editing && linksTouching(links, { model: modelId, entity: entity.id }).length > 0 && (
          <span
            className="entity__link-badge"
            title={linkTitle({ model: modelId, entity: entity.id })}
          >
            🔗
          </span>
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
                {linksTouching(links, { model: modelId, entity: entity.id, field: f.id }).length >
                  0 && (
                  <span
                    className="entity__field-link"
                    title={linkTitle({ model: modelId, entity: entity.id, field: f.id })}
                  >
                    {" "}
                    🔗
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const EntityNode = memo(EntityNodeImpl);
