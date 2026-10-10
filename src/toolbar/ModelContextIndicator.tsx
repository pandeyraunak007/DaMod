import { Database, Layers, Table2 } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { usesPhysicalTypes } from "../model/levels";
import type { ModelLevel } from "../model/levels";
import type { DbDialect } from "../model/model";
import { DIALECTS, type DialectId } from "../export/dialects";

// Req 20 — the persistent Model | Level | Database context indicator. Pure display:
// it reads the ACTIVE model's authoritative state and never mutates it (no undo
// entries). Lives in the always-visible top ribbon bar so it stays readable even
// when the Explorer / Properties / Copilot panels are collapsed.

/** The database label, derived strictly from the model's own metadata — it must
 *  NEVER assume Postgres (that is `modelDialect`'s *DDL* fallback, not a UI claim). */
export function databaseLabel(level: ModelLevel, dialect: DbDialect | undefined): string {
  if (!usesPhysicalTypes(level)) return "Database-independent";
  if (!dialect) return "Database not configured";
  return DIALECTS[dialect as DialectId]?.label ?? "Database not configured";
}

export function ModelContextIndicator() {
  // Primitive selectors only (never build a value inside a selector — see CLAUDE §5.1).
  const name = useModelStore((s) => s.model.name);
  const level = useModelStore((s) => s.model.level);
  const dialect = useModelStore((s) => s.model.dialect);

  const db = databaseLabel(level, dialect);
  const dbUnset = db === "Database not configured";

  return (
    <div className="mctx" role="status" aria-label="Active model context">
      <span className="mctx__seg mctx__seg--model" title={`Active model: ${name}`}>
        <Table2 size={12} strokeWidth={1.8} aria-hidden />
        <span className="mctx__val">{name}</span>
      </span>
      <span className="mctx__sep" aria-hidden>·</span>
      <span className="mctx__seg" title={`Modeling level: ${level}`}>
        <Layers size={12} strokeWidth={1.8} aria-hidden />
        <span className="mctx__val">{level}</span>
      </span>
      <span className="mctx__sep" aria-hidden>·</span>
      <span className={`mctx__seg ${dbUnset ? "mctx__seg--warn" : ""}`} title={`Target database: ${db}`}>
        <Database size={12} strokeWidth={1.8} aria-hidden />
        <span className="mctx__val">{db}</span>
      </span>
    </div>
  );
}
