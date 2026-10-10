// Pipeline planner (§5.2). Consumes a source Model already produced by the
// connector framework (no re-discovery), auto-maps a full load, validates type
// compatibility and required fields, and renders human-readable reports plus
// target DDL (reusing the existing DDL generators, §5.3). It never silently
// infers a transformation that could change business meaning — mismatches are
// flagged for review.

import { type Model, newEntity, newField, newModel } from "../../model/model";
import { type DataTypeKind, formatType } from "../../model/dataTypes";
import { validateIdentifier } from "../../model/identifiers";
import { DIALECTS, type DialectId } from "../../export/dialects";
import { exportModelDDL } from "../../export/ddl";
import { newId } from "../../lib/ids";
import {
  type ColumnMapping,
  type PipelineSpec,
  type SpecType,
} from "./spec";

export interface PipelineIssue {
  severity: "error" | "warning";
  message: string;
  object?: string;
  column?: string;
}

function typeOfField(f: { type?: string; length?: number; precision?: number; scale?: number }): SpecType | undefined {
  return f.type ? { type: f.type, length: f.length, precision: f.precision, scale: f.scale } : undefined;
}

function sameType(a?: SpecType, b?: SpecType): boolean {
  if (!a || !b) return false;
  return (
    formatType(a as never) === formatType(b as never)
  );
}

/**
 * Plan a full load: select source entities and 1:1-map every column to a target
 * column of the same name and type. The user then refines mappings/transforms.
 */
export function planFullLoad(
  model: Model,
  selectedEntityNames: string[],
  targetPlatform: DialectId,
  opts: { name: string; schema?: string; connectionRef?: string; snapshotId?: string },
): PipelineSpec {
  const selected = new Set(selectedEntityNames.map((n) => n.toLowerCase()));
  const objects = model.entities
    .filter((e) => selected.has(e.name.toLowerCase()))
    .map((e) => ({
      sourceObject: e.name,
      targetObject: e.name,
      columns: e.fields.map((f): ColumnMapping => {
        const t = typeOfField(f);
        return {
          source: f.name,
          target: f.name,
          sourceType: t,
          targetType: t ?? { type: "text" },
          required: !f.nullable,
        };
      }),
    }));

  return {
    specVersion: 1,
    id: newId("pipeline"),
    name: opts.name,
    source: {
      connectionRef: opts.connectionRef,
      modelId: model.id,
      modelName: model.name,
      snapshotId: opts.snapshotId,
    },
    target: { platform: targetPlatform, schema: opts.schema },
    loadStrategy: "full",
    objects,
  };
}

/** Validate a spec against the current source model (type-compat, required, drift). */
export function validatePipeline(spec: PipelineSpec, model: Model): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const entityByName = (n: string) => model.entities.find((e) => e.name.toLowerCase() === n.toLowerCase());

  for (const obj of spec.objects) {
    if (validateIdentifier(obj.targetObject)) {
      issues.push({ severity: "error", object: obj.targetObject, message: `Invalid target table name “${obj.targetObject}”` });
    }
    const srcEntity = entityByName(obj.sourceObject);
    if (!srcEntity) {
      issues.push({ severity: "error", object: obj.sourceObject, message: `Source object “${obj.sourceObject}” is no longer in the model (schema drift?)` });
      continue;
    }
    for (const col of obj.columns) {
      if (validateIdentifier(col.target)) {
        issues.push({ severity: "error", object: obj.targetObject, column: col.target, message: `Invalid target column name “${col.target}”` });
      }
      if (col.source) {
        const srcField = srcEntity.fields.find((f) => f.name.toLowerCase() === col.source.toLowerCase());
        if (!srcField) {
          issues.push({ severity: "error", object: obj.sourceObject, column: col.source, message: `Source column “${obj.sourceObject}.${col.source}” is missing (schema drift?)` });
          continue;
        }
        // Type compatibility: a mismatch needs an explicit transform (no silent inference).
        if (!col.transform && !sameType(col.sourceType, col.targetType)) {
          const s = col.sourceType ? formatType(col.sourceType as never) : "untyped";
          const t = formatType(col.targetType as never);
          issues.push({
            severity: "warning",
            object: obj.targetObject,
            column: col.target,
            message: `${obj.sourceObject}.${col.source} (${s}) → ${col.target} (${t}) needs a type conversion; add a transform or align the type`,
          });
        }
      } else if (col.required && !col.transform) {
        // A required target column with no source and no transform is unresolved.
        issues.push({
          severity: "error",
          object: obj.targetObject,
          column: col.target,
          message: `Required target column “${obj.targetObject}.${col.target}” has no source mapping`,
        });
      }
    }
  }
  return issues;
}

/** A human-readable mapping + validation report (§5.2). Deterministic. */
export function pipelineReport(spec: PipelineSpec, issues: PipelineIssue[]): string {
  const lines: string[] = [
    `# Pipeline: ${spec.name}`,
    `source model: ${spec.source.modelName} (${spec.source.modelId})`,
    `target: ${DIALECTS[spec.target.platform as DialectId].label}${spec.target.schema ? ` schema ${spec.target.schema}` : ""}`,
    `load strategy: ${spec.loadStrategy}`,
    "",
  ];
  for (const obj of [...spec.objects].sort((a, b) => a.targetObject.localeCompare(b.targetObject))) {
    lines.push(`## ${obj.sourceObject} → ${obj.targetObject}`);
    for (const c of obj.columns) {
      const s = c.sourceType ? formatType(c.sourceType as never) : "—";
      const t = formatType(c.targetType as never);
      const arrow = c.transform ? `={${c.transform}}=>` : "→";
      const src = c.source || "(none)";
      lines.push(`  ${src} (${s}) ${arrow} ${c.target} (${t})${c.required ? " NOT NULL" : ""}`);
    }
    lines.push("");
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  lines.push(`## Validation: ${errors.length} error(s), ${warnings.length} warning(s)`);
  for (const i of issues) lines.push(`  [${i.severity}] ${i.message}`);
  return lines.join("\n") + "\n";
}

/** Target schema DDL for the spec, reusing the existing DDL generator (§5.3). */
export function targetDdl(spec: PipelineSpec): string {
  const model = newModel(`${spec.name}_target`, "1970-01-01T00:00:00.000Z", "Physical");
  for (const obj of spec.objects) {
    const entity = newEntity(obj.targetObject, { x: 0, y: 0 });
    entity.fields = obj.columns.map((c) =>
      newField(c.target, c.targetType.type as DataTypeKind, {
        length: c.targetType.length,
        precision: c.targetType.precision,
        scale: c.targetType.scale,
        nullable: !c.required,
      }),
    );
    model.entities.push(entity);
  }
  return exportModelDDL(model, DIALECTS[spec.target.platform as DialectId]);
}
