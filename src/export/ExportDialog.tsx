import { useMemo, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { validateWorkspace } from "../validation/rules";
import { canExportDdl } from "../model/levels";
import { DIALECTS, DIALECT_IDS, type DialectId } from "./dialects";
import { exportModelDDL, exportWorkspaceDDL } from "./ddl";
import { generateMigration } from "./migrate";
import { exportSemanticYaml } from "./semanticExport";
import { parseDdl } from "../import/reverse";
import { modelDialect, type Model } from "../model/model";
import { joinPath, pickFile, readTextFile, writeFile } from "../persist/fs";

type Scope = "model" | "workspace" | "semantic" | "migration";

// Export dialog (FR-8/FR-9) plus forward-engineering. Runs validation first and
// blocks on errors (FR-8.7). DDL is offered per dialect with schema options (drop
// first / if not exists); the migration scope diffs the active model against a
// baseline (another model, or a reverse-engineered .sql) to an ALTER script.
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const path = useWorkspaceStore((s) => s.path);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const links = useWorkspaceStore((s) => s.links);
  const semantic = useWorkspaceStore((s) => s.semantic);
  const activeModel = useModelStore((s) => s.model);

  // Default to the model's own target database (Req 17) — it is authoritative for
  // this model's DDL. The user can still override the dialect for a one-off export.
  const [dialect, setDialect] = useState<DialectId>(modelDialect(activeModel) as DialectId);
  const [scope, setScope] = useState<Scope>("model");
  const [dropFirst, setDropFirst] = useState(false);
  const [ifNotExists, setIfNotExists] = useState(false);
  const [useDomains, setUseDomains] = useState(false);
  const [baselineSel, setBaselineSel] = useState<string>(""); // model id, or "" / "sql"
  const [sqlBaseline, setSqlBaseline] = useState<Model | null>(null);
  const [sqlBaselineName, setSqlBaselineName] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const models = allModels();
  const otherModels = models.filter((m) => m.id !== activeModel.id);

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

  const loadSqlBaseline = async () => {
    const file = await pickFile(["sql"], "Open a baseline .sql file");
    if (!file) return;
    const content = await readTextFile(file);
    const { model } = parseDdl(content, "baseline", "2026-01-01T00:00:00Z");
    setSqlBaseline(model);
    setSqlBaselineName(file.split("/").pop() ?? "baseline.sql");
    setBaselineSel("sql");
  };

  const baselineModel: Model | null = useMemo(() => {
    if (scope !== "migration") return null;
    if (baselineSel === "sql") return sqlBaseline;
    const found = otherModels.find((m) => m.id === baselineSel);
    return found?.model ?? null;
  }, [scope, baselineSel, sqlBaseline, otherModels]);

  const opts = { dropFirst, ifNotExists, useDomains };

  const text = useMemo(() => {
    try {
      if (scope === "semantic") return exportSemanticYaml(semantic, models, links.conceptGroups);
      const d = DIALECTS[dialect];
      if (scope === "workspace") {
        const exportable = models.filter((m) => canExportDdl(m.model.level));
        return exportWorkspaceDDL(exportable, links.links, d, opts);
      }
      if (scope === "migration") {
        if (!baselineModel) return "-- choose a baseline model or load a .sql file to compare against.";
        return generateMigration(baselineModel, activeModel, d);
      }
      return exportModelDDL(activeModel, d, opts);
    } catch (e) {
      return `-- export error: ${(e as Error).message}`;
    }
  }, [scope, dialect, activeModel, models, links, semantic, dropFirst, ifNotExists, useDomains, baselineModel]);

  const fileName =
    scope === "semantic"
      ? "semantic.yaml"
      : scope === "workspace"
        ? "workspace.sql"
        : scope === "migration"
          ? `${activeModel.name}.migration.sql`
          : `${activeModel.name}.sql`;

  const blocked =
    errors.length > 0 ||
    (scope === "model" && !modelExportable) ||
    (scope === "migration" && (!modelExportable || !baselineModel));

  const doExport = async () => {
    if (!path || blocked) return;
    await writeFile(joinPath(path, fileName), text, false);
    setSaved(joinPath(path, fileName));
  };

  const showDialect = scope !== "semantic";
  const showSchemaOpts = scope === "model" || scope === "workspace";

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
              <option value="migration">Migration — ALTER script</option>
              <option value="semantic">Semantic layer — YAML</option>
            </select>
          </div>
          {showDialect && (
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

        {showSchemaOpts && (
          <div className="modal__row modal__row--pair">
            <label className="checkbox">
              <input type="checkbox" checked={dropFirst} onChange={(e) => setDropFirst(e.target.checked)} />
              DROP TABLE IF EXISTS first
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={ifNotExists} onChange={(e) => setIfNotExists(e.target.checked)} />
              CREATE TABLE IF NOT EXISTS
            </label>
            {dialect === "postgres" && (activeModel.domains?.length ?? 0) > 0 && (
              <label className="checkbox">
                <input type="checkbox" checked={useDomains} onChange={(e) => setUseDomains(e.target.checked)} />
                Emit CREATE DOMAIN &amp; use domain types (Postgres)
              </label>
            )}
          </div>
        )}

        {scope === "migration" && (
          <div className="modal__row modal__row--pair">
            <div className="field">
              <label>Baseline to compare against</label>
              <select value={baselineSel} onChange={(e) => setBaselineSel(e.target.value)}>
                <option value="">— choose a baseline —</option>
                {otherModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    model: {m.name}
                  </option>
                ))}
                {sqlBaseline && <option value="sql">file: {sqlBaselineName}</option>}
              </select>
            </div>
            <div className="field">
              <label>Or a database dump</label>
              <button className="btn btn--small" onClick={loadSqlBaseline}>
                Load baseline .sql…
              </button>
            </div>
          </div>
        )}

        {(scope === "model" || scope === "migration") && !modelExportable && (
          <p className="field__hint field__hint--warn">
            {activeModel.name} is a {activeModel.level} model — raise it to Physical to generate SQL.
          </p>
        )}
        {scope === "migration" && (
          <p className="field__hint">
            The migration turns the chosen baseline into <strong>{activeModel.name}</strong>. Tip:
            reverse-engineer your live database with “Import SQL”, keep it as the baseline, then diff.
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
