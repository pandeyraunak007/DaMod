import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { MODEL_LEVELS, type ModelLevel } from "../model/levels";
import { baseName, pickWorkspaceFolder } from "../persist/fs";

const LEVEL_HINTS: Record<ModelLevel, string> = {
  Conceptual: "Entities and relationships only — names, no field types or keys.",
  Logical: "Generic types (Text, Number, …), keys and relationships. No Postgres types.",
  "Physical/Logical": "Hybrid — a generic type beside each physical column. Exports DDL.",
  Physical: "Postgres-ready types and keys. Exports DDL.",
};

// Create-model dialog. The modeling level is the primary choice (ERwin-style):
// pick the level, name it, and the canvas opens at that level. If no workspace is
// open yet, also choose the folder to keep models in.
export function NewModelDialog({ onClose }: { onClose: () => void }) {
  const path = useWorkspaceStore((s) => s.path);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const newModel = useWorkspaceStore((s) => s.newModel);

  const [level, setLevel] = useState<ModelLevel>("Physical");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<string | null>(path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseFolder = async () => {
    const dir = await pickWorkspaceFolder();
    if (dir) setFolder(dir);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the model a name.");
      return;
    }
    const target = path ?? folder;
    if (!target) {
      setError("Choose a folder to keep your models in.");
      return;
    }
    setBusy(true);
    try {
      if (!path) await openWorkspace(target);
      const err = await newModel(trimmed, level);
      if (err) {
        setError(err);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">New model</h2>

        <div className="field">
          <label>Model type</label>
          <div className="level-cards">
            {MODEL_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={`level-card ${level === l ? "level-card--active" : ""}`}
                onClick={() => setLevel(l)}
              >
                <span className="level-card__name">{l}</span>
                <span className="level-card__hint">{LEVEL_HINTS[l]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Name</label>
          <input
            autoFocus
            className={error && !name.trim() ? "is-error" : ""}
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
        </div>

        {!path && (
          <div className="field">
            <label>Workspace folder</label>
            <div className="folder-row">
              <span className="folder-row__path" title={folder ?? ""}>
                {folder ? baseName(folder) : "No folder chosen"}
              </span>
              <button className="btn btn--small" onClick={chooseFolder}>
                Choose…
              </button>
            </div>
            <p className="field__hint">A workspace is a folder that holds your model files.</p>
          </div>
        )}

        {error && <p className="field__hint field__hint--warn">{error}</p>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create model"}
          </button>
        </div>
      </div>
    </div>
  );
}
