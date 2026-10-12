import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { baseName, pickFile, readTextFile } from "../persist/fs";
import { validateIdentifier } from "../model/identifiers";
import { parseDdl } from "./reverse";

// Reverse-engineer SQL DDL into a new model. Paste SQL or load a .sql file, name
// the model, preview what will be created, then import it into the workspace.
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const importModel = useWorkspaceStore((s) => s.importModel);
  const [sql, setSql] = useState("");
  const [name, setName] = useState("imported");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Parse on every edit for a live preview. The timestamp is fixed here; the
  // store stamps the real created/updated times on import.
  const parsed = useMemo(
    () => (sql.trim() ? parseDdl(sql, "preview", "2026-01-01T00:00:00Z") : null),
    [sql],
  );
  const nameError = validateIdentifier(name);

  const loadFile = async () => {
    const path = await pickFile(["sql"], "Open a .sql file");
    if (!path) return;
    const text = await readTextFile(path);
    setSql(text);
    // Default the model name to the file's base name when it is still the default.
    const base = baseName(path).replace(/\.sql$/i, "");
    if ((name === "imported" || !name) && !validateIdentifier(base)) setName(base);
  };

  const doImport = async () => {
    if (!parsed || nameError) return;
    setBusy(true);
    const err = await importModel(parsed.model, name);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  const entityCount = parsed?.model.entities.length ?? 0;
  const relCount = parsed?.model.relationships.length ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--map" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Reverse-engineer from SQL</h2>

        <div className="modal__row modal__row--pair">
          <div className="field">
            <label>New model name</label>
            <input
              className={nameError ? "is-error" : ""}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
            {nameError && <span className="toolbar__model-error">{nameError}</span>}
          </div>
          <div className="field">
            <label>Source</label>
            <button className="btn btn--small" onClick={loadFile}>
              Load .sql file…
            </button>
          </div>
        </div>

        <textarea
          className="editor__input"
          rows={12}
          placeholder="Paste CREATE TABLE statements here, or load a .sql file…"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
        />

        {parsed && (
          <div className="import-preview">
            <p className="field__hint">
              {entityCount} table{entityCount === 1 ? "" : "s"} · {relCount} relationship
              {relCount === 1 ? "" : "s"} will be created.
            </p>
            {parsed.model.entities.length > 0 && (
              <p className="field__hint">
                Tables: {parsed.model.entities.map((e) => e.name).join(", ")}
              </p>
            )}
            {parsed.warnings.length > 0 && (
              <ul className="import-warnings">
                {parsed.warnings.map((w, i) => (
                  <li key={i} className="field__hint field__hint--warn">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="field__hint field__hint--warn">{error}</p>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={doImport}
            disabled={busy || !parsed || entityCount === 0 || !!nameError}
          >
            Import as new model
          </button>
        </div>
      </div>
    </div>
  );
}
