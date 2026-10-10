// ETL/ELT pipeline specification (Phase 5, §5.1). A versioned, Zod-validated,
// deterministically-serialized description of intended data movement — NOT an
// execution engine. It references the source model/snapshot version it was
// designed against, so a later schema change is detectable.
//
// It consumes canonical metadata already discovered by the connector framework;
// it never re-runs discovery.

import { z } from "zod";
import { DATA_TYPE_KINDS } from "../../model/dataTypes";
import { DIALECT_IDS } from "../../export/dialects";
import type { ParseResult } from "../metadata";

export const PIPELINE_SPEC_VERSION = 1;

/** Only full-load for the first milestone (§5.2). */
export const LOAD_STRATEGIES = ["full"] as const;
export type LoadStrategy = (typeof LOAD_STRATEGIES)[number];

const zType = z.object({
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]),
  length: z.number().int().positive().optional(),
  precision: z.number().int().positive().optional(),
  scale: z.number().int().nonnegative().optional(),
});
export type SpecType = z.infer<typeof zType>;

const zColumnMapping = z.object({
  source: z.string(), // source field name ("" when the target column has no source)
  target: z.string(), // target column name
  sourceType: zType.optional(),
  targetType: zType,
  /** Explicit transform expression/label; absent = identity copy. */
  transform: z.string().optional(),
  /** Target column is NOT NULL. */
  required: z.boolean(),
});
export type ColumnMapping = z.infer<typeof zColumnMapping>;

const zPipelineObject = z.object({
  sourceObject: z.string(),
  targetObject: z.string(),
  columns: z.array(zColumnMapping),
});
export type PipelineObject = z.infer<typeof zPipelineObject>;

const zSpec = z.object({
  specVersion: z.literal(PIPELINE_SPEC_VERSION),
  id: z.string(),
  name: z.string(),
  source: z.object({
    connectionRef: z.string().optional(),
    modelId: z.string(),
    modelName: z.string(),
    snapshotId: z.string().optional(),
  }),
  target: z.object({
    platform: z.enum(DIALECT_IDS as unknown as [string, ...string[]]),
    schema: z.string().optional(),
  }),
  loadStrategy: z.enum(LOAD_STRATEGIES),
  objects: z.array(zPipelineObject),
});
export type PipelineSpec = z.infer<typeof zSpec>;

function typeToPlain(t?: SpecType): Record<string, unknown> | undefined {
  if (!t) return undefined;
  const out: Record<string, unknown> = { type: t.type };
  if (t.length !== undefined) out.length = t.length;
  if (t.precision !== undefined) out.precision = t.precision;
  if (t.scale !== undefined) out.scale = t.scale;
  return out;
}

/** Canonical plain object with fixed key order (deterministic, §5.2). */
export function specToPlain(spec: PipelineSpec): Record<string, unknown> {
  return {
    specVersion: spec.specVersion,
    id: spec.id,
    name: spec.name,
    source: {
      ...(spec.source.connectionRef ? { connectionRef: spec.source.connectionRef } : {}),
      modelId: spec.source.modelId,
      modelName: spec.source.modelName,
      ...(spec.source.snapshotId ? { snapshotId: spec.source.snapshotId } : {}),
    },
    target: {
      platform: spec.target.platform,
      ...(spec.target.schema ? { schema: spec.target.schema } : {}),
    },
    loadStrategy: spec.loadStrategy,
    objects: [...spec.objects]
      .sort((a, b) => a.targetObject.localeCompare(b.targetObject))
      .map((o) => ({
        sourceObject: o.sourceObject,
        targetObject: o.targetObject,
        columns: o.columns.map((c) => {
          const out: Record<string, unknown> = { source: c.source, target: c.target };
          const st = typeToPlain(c.sourceType);
          if (st) out.sourceType = st;
          out.targetType = typeToPlain(c.targetType);
          if (c.transform) out.transform = c.transform;
          out.required = c.required;
          return out;
        }),
      })),
  };
}

export function serializePipeline(spec: PipelineSpec): string {
  return JSON.stringify(specToPlain(spec), null, 2) + "\n";
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function parsePipeline(raw: unknown): ParseResult<PipelineSpec> {
  const parsed = zSpec.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data as PipelineSpec }
    : { ok: false, error: firstIssue(parsed.error) };
}

export { zSpec };
