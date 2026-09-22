import { useMemo, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { validateWorkspace } from "../validation/rules";
import { canExportDdl } from "../model/levels";
import { DIALECTS, DIALECT_IDS, type DialectId } from "./dialects";
import { exportModelDDL, exportWorkspaceDDL } from "./ddl";
import { exportSemanticYaml } from "./semanticExport";
import { joinPath, writeFile } from "../persist/fs";

type Scope = "model" | "workspace" | "semantic";

// Export dialog (FR-8/FR-9). Runs validation first and blocks on errors
// (FR-8.7). DDL is offered per dialect; DDL scopes are disabled for
// Conceptual/Logical models (FR-11.8).
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const path = useWorkspaceStore((s) => s.path);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const links = useWorkspaceStore((s) => s.links);
  const semantic = useWorkspaceStore((s) => s.semantic);
  const activeModel = useModelStore((s) => s.model);

  const [dialect, setDialect] = useState<DialectId>("postgres");
  const [scope, setScope] = useState<Scope>("model");
  const [saved, setSaved] = useState<string | null>(null);

  const models = allModels();

  const issues = useMemo(
    () =>
      validateWorkspace({
        models,
        links: links.links,
        conceptGroups: links.conceptGroups,
        semantic,
      }),
    [models, links, semantic],
  );
  const errors = issues.filter((i) => i.severity === "error");

  const modelExportable = canExportDdl(activeModel.level);

  const text = useMemo(() => {
    try {
      if (scope === "semantic") return exportSemanticYaml(semantic, models, links.conceptGroups);
      const d = DIALECTS[dialect];
      if (scope === "workspace") {
        const exportable = models.filter((m) => canExportDdl(m.model.level));
        return exportWorkspaceDDL(exportable, links.links, d);
      }
      return exportModelDDL(activeModel, d);
    } catch (e) {
      return `-- export error: ${(e as Error).message}`;
    }
  }, [scope, dialect, activeModel, models, links, semantic]);

  const fileName =
    scope === "semantic"
      ? "semantic.yaml"
      : scope === "workspace"
        ? "workspace.sql"
        : `${activeModel.name}.sql`;

  const blocked = errors.length > 0 || (scope === "model" && !modelExportable);

  const doExport = async () => {
    if (!path || blocked) return;
    await writeFile(joinPath(path, fileName), text, false);
    setSaved(joinPath(path, fileName));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--map" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Export</h2>

        <div className="modal__row modal__row--pair">
          <div className="field">
            <label>What</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="model">Active model — DDL</option>
              <option value="workspace">Whole workspace — DDL</option>
              <option value="semantic">Semantic layer — YAML</option>
            </select>
          </div>
          {scope !== "semantic" && (
            <div className="field">
              <label>Dialect</label>
              <select value={dialect} onChange={(e) => setDialect(e.target.value as DialectId)}>
                {DIALECT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {DIALECTS[id].label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {scope === "model" && !modelExportable && (
          <p className="field__hint field__hint--warn">
            {activeModel.name} is a {activeModel.level} model — raise it to Physical to export DDL.
          </p>
        )}
        {errors.length > 0 && (
          <p className="field__hint field__hint--warn">
            {errors.length} validation error{errors.length > 1 ? "s" : ""} must be fixed before
            export (see the validation panel).
          </p>
        )}

        <pre className="export-preview">{text}</pre>

        {saved && <p className="field__hint">Saved to {saved}</p>}
        {dialect === "postgres" && scope !== "semantic" && (
          <p className="field__hint">
            Verify: <code>docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16</code>{" "}
            then <code>psql -h localhost -U postgres -f {fileName}</code>
          </p>
        )}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="btn"
            onClick={() => navigator.clipboard?.writeText(text)}
            disabled={blocked}
          >
            Copy
          </button>
          <button className="btn btn--primary" onClick={doExport} disabled={blocked}>
            Export to file
          </button>
        </div>
      </div>
    </div>
  );
}
