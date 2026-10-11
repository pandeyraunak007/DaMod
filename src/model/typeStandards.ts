// Data Type Standards (Phase 3) — reusable, per-model policies for canonical type
// PARAMETERS (string length, decimal precision/scale) plus dialect lossy-mapping
// surfacing. This module is PURE: it does not fork the fixed canonical type set or
// the per-dialect renderers (those stay the single source of truth) — it only
// normalises parameters and reports fidelity risks. Domain-bound columns are left
// to the domain (precedence: explicit override > domain > type standard default).

import { newId } from "../lib/ids";
import { paramShape, type DataTypeKind, type TypeSpec } from "./dataTypes";
import type { DbDialect, Model } from "./model";

// Inlined to keep this module's model import type-only (no runtime import cycle with
// model.ts, which re-exports this module). Mirrors model.modelDialect exactly.
function dialectOf(model: Model): DbDialect {
  return model.dialect ?? "postgres";
}

export interface TypeRule {
  /** Canonical type this rule governs. Only length/decimal-shaped types carry params. */
  type: DataTypeKind;
  length?: number;
  precision?: number;
  scale?: number;
}

export interface TypeStandard {
  id: string;
  name: string;
  description?: string;
  rules: TypeRule[];
}

export function newTypeStandard(name: string): TypeStandard {
  return { id: newId("typeStandard"), name, rules: [] };
}

// ---- parameter-compliance check (pure, no mutation) -------------------------

export interface TypeViolation {
  standardId: string;
  entityId: string;
  fieldId: string;
  fieldName: string;
  current: TypeSpec;
  proposed: TypeSpec;
  /** Any of "length", "precision", "scale". */
  reasons: string[];
}

/** Columns whose type parameters deviate from `standard`. Read-only. Skips columns
 *  with no physical type (conceptual/logical) and domain-bound columns (the domain
 *  owns their type). */
export function checkTypes(model: Model, standard: TypeStandard): TypeViolation[] {
  const out: TypeViolation[] = [];
  for (const e of model.entities) {
    for (const f of e.fields) {
      if (!f.type || f.domainId) continue;
      const rule = standard.rules.find((r) => r.type === f.type);
      if (!rule) continue;
      const shape = paramShape(f.type);
      const reasons: string[] = [];
      const proposed: TypeSpec = { type: f.type, length: f.length, precision: f.precision, scale: f.scale };
      if (shape === "length" && rule.length != null && f.length !== rule.length) {
        reasons.push("length");
        proposed.length = rule.length;
      }
      if (shape === "decimal") {
        if (rule.precision != null && f.precision !== rule.precision) {
          reasons.push("precision");
          proposed.precision = rule.precision;
        }
        if (rule.scale != null && f.scale !== rule.scale) {
          reasons.push("scale");
          proposed.scale = rule.scale;
        }
      }
      if (reasons.length) {
        out.push({
          standardId: standard.id,
          entityId: e.id,
          fieldId: f.id,
          fieldName: f.name,
          current: { type: f.type, length: f.length, precision: f.precision, scale: f.scale },
          proposed,
          reasons,
        });
      }
    }
  }
  return out;
}

// ---- lossy-mapping surfacing (pure) -----------------------------------------

// Canonical types that have no faithful native equivalent on a dialect (stored as
// text/approximation). Advisory only — the DDL renderers still emit valid SQL. Kept
// deliberately conservative; mirrors the per-dialect renderers in export/dialects.ts.
const LOSSY: Partial<Record<DbDialect, Partial<Record<DataTypeKind, string>>>> = {
  snowflake: { uuid: "stored as VARCHAR(36) — no native UUID type" },
  databricks: { uuid: "stored as STRING — no native UUID type", json: "stored as STRING — no native JSON type" },
  oracle: { json: "stored as CLOB — no native JSON type", uuid: "stored as RAW(16) — no native UUID type", boolean: "stored as NUMBER(1) — no native BOOLEAN" },
  sqlserver: { json: "stored as NVARCHAR(MAX) — no native JSON type" },
  mysql: { uuid: "stored as CHAR(36) — no native UUID type" },
  bigquery: { uuid: "stored as STRING — no native UUID type" },
};

export interface LossyWarning {
  entityId: string;
  fieldId: string;
  fieldName: string;
  type: DataTypeKind;
  dialect: DbDialect;
  note: string;
}

/** Columns whose canonical type maps lossily to the model's target dialect. */
export function lossyTypeWarnings(model: Model): LossyWarning[] {
  const dialect = dialectOf(model);
  const table = LOSSY[dialect];
  if (!table) return [];
  const out: LossyWarning[] = [];
  for (const e of model.entities) {
    for (const f of e.fields) {
      const note = f.type ? table[f.type] : undefined;
      if (note) out.push({ entityId: e.id, fieldId: f.id, fieldName: f.name, type: f.type!, dialect, note });
    }
  }
  return out;
}
