import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { MODEL_LEVELS, type ModelLevel, usesPhysicalTypes } from "../model/levels";
import type { DbDialect } from "../model/model";
import { DIALECTS, DIALECT_IDS } from "../export/dialects";
import { baseName, pickWorkspaceFolder } from "../persist/fs";

const LEVEL_HINTS: Record<ModelLevel, string> = {
  Conceptual: "Entities and relationships only — names, no field types or keys.",
  Logical: "Generic types (Text, Number, …), keys and relationships. No Postgres types.",
  "Physical/Logical": "Hybrid — a generic type beside each physical column. Exports DDL.",
  Physical: "Database-specific types and keys. Exports DDL.",
};

// Only Postgres is verified end-to-end (live connector, reverse-engineering).
// Snowflake and Databricks generate DDL and carry their own physical type
// spellings, but have no live connector yet — say so rather than imply parity.
const DIALECT_HINTS: Record<DbDialect, string> = {
  postgres: "Full support: types, DDL, live connection and reverse-engineering.",
  snowflake: "Physical types and DDL export. No live connection yet.",
  databricks: "Physical types and DDL export. No live connection yet.",
  oracle: "Physical types and DDL export (VARCHAR2/NUMBER/CLOB). No live connection yet.",
  sqlserver: "Physical types and DDL export (T-SQL). No live connection yet.",
  mysql: "Physical types and DDL export. No live connection yet.",
  bigquery: "Physical types and DDL export (INT64/STRING). No live connection yet.",
};

// Create-model dialog. The modeling level is the primary choice (ERwin-style):
// pick the level, name it, and the canvas opens at that level. If no workspace is
// open yet, also choose the folder to keep models in.
export function NewModelDialog({ onClose }: { onClose: () => void }) {
  const path = useWorkspaceStore((s) => s.path);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const newModel = useWorkspaceStore((s) => s.newModel);

  const [level, setLevel] = useState<ModelLevel>("Physical");
  // Chosen database for physical levels. Kept across level changes so toggling
  // Physical → Logical → Physical doesn't lose the selection (§1 Step 2, §5).
  const [dialect, setDialect] = useState<DbDialect>("postgres");
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
    if (needsDialect && !dialect) {
      setError("Choose a target database for a physical model.");
      return;
    }
    setBusy(true);
    try {
      if (!path) await openWorkspace(target);
      const err = await newModel(trimmed, level, needsDialect ? dialect : undefined);
      if (err) {
        setError(err);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const needsDialect = usesPhysicalTypes(level);
  const canCreate = !!name.trim() && (!!path || !!folder) && (!needsDialect || !!dialect);

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

        {needsDialect && (
          <div className="field">
            <label htmlFor="new-model-db">Target database</label>
            <select
              id="new-model-db"
              value={dialect}
              onChange={(e) => {
                setDialect(e.target.value as DbDialect);
                setError(null);
              }}
            >
              {DIALECT_IDS.map((id) => (
                <option key={id} value={id}>
                  {DIALECTS[id].label}
                </option>
              ))}
            </select>
            <p className="field__hint">
              {DIALECT_HINTS[dialect]} The database sets the physical types and SQL this model generates.
            </p>
          </div>
        )}

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
          <button className="btn btn--primary" onClick={submit} disabled={busy || !canCreate}>
            {busy ? "Creating…" : "Create model"}
          </button>
        </div>
      </div>
    </div>
  );
}
