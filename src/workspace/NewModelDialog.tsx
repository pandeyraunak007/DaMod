import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { MODEL_LEVELS, type ModelLevel } from "../model/levels";

const LEVEL_HINTS: Record<ModelLevel, string> = {
  Conceptual: "Entities and relationships only, names — no field types or keys.",
  Logical: "Generic types (Text, Number, …), keys and relationships. No Postgres types.",
  "Physical/Logical": "Hybrid: generic type beside the physical column. Exports DDL.",
  Physical: "Postgres-ready types and keys. Exports DDL.",
};

// New-model dialog with a level picker (FR-11.1). The chosen level fixes what the
// model's fields can hold from the start.
export function NewModelDialog({ onClose }: { onClose: () => void }) {
  const newModel = useWorkspaceStore((s) => s.newModel);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<ModelLevel>("Physical");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const err = await newModel(name.trim(), level);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">New model</h2>

        <div className="field">
          <label>Name</label>
          <input
            autoFocus
            className={error ? "is-error" : ""}
            value={name}
            placeholder="orders"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          {error && <p className="field__hint field__hint--warn">{error}</p>}
        </div>

        <div className="field">
          <label>Level</label>
          <select value={level} onChange={(e) => setLevel(e.target.value as ModelLevel)}>
            {MODEL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <p className="field__hint">{LEVEL_HINTS[level]}</p>
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
