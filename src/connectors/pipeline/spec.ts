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

/** Source-side filter operators (Req 22 §8.6). */
export const FILTER_OPS = ["=", "!=", "<", "<=", ">", ">=", "in", "is null", "is not null"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
const VALUELESS_OPS = new Set<FilterOp>(["is null", "is not null"]);
export function filterNeedsValue(op: FilterOp): boolean {
  return !VALUELESS_OPS.has(op);
}

const zFilter = z.object({
  column: z.string(), // source column name
  op: z.enum(FILTER_OPS),
  value: z.string().optional(),
});
export type PipelineFilter = z.infer<typeof zFilter>;

const zPipelineObject = z.object({
  sourceObject: z.string(),
  targetObject: z.string(),
  columns: z.array(zColumnMapping),
  /** Source-side row filters applied before load (Req 22 §8.6). */
  filters: z.array(zFilter).default([]),
});
export type PipelineObject = z.infer<typeof zPipelineObject>;

/** A cross-object join relating two source objects on key columns (Req 22 §8.6). */
export const JOIN_KINDS = ["inner", "left"] as const;
export type JoinKind = (typeof JOIN_KINDS)[number];
const zJoin = z.object({
  leftObject: z.string(),
  leftColumn: z.string(),
  rightObject: z.string(),
  rightColumn: z.string(),
  kind: z.enum(JOIN_KINDS),
});
export type PipelineJoin = z.infer<typeof zJoin>;

/** Optional canvas layout for the visual designer (Phase 3): node positions keyed by
 *  stable node id. Purely presentational — absent layouts auto-arrange. Approach-
 *  agnostic (works whether the canvas is a projection of the flat spec or a DAG). */
const zLayoutNode = z.object({ id: z.string(), x: z.number(), y: z.number() });
const zLayout = z.object({ nodes: z.array(zLayoutNode).default([]) });
export type PipelineLayout = z.infer<typeof zLayout>;

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
  /** Cross-object joins describing how the source objects relate (Req 22 §8.6). */
  joins: z.array(zJoin).default([]),
  /** Optional visual-designer layout (Phase 3). Additive; absent for older specs. */
  layout: zLayout.optional(),
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
      .map((o) => {
        const obj: Record<string, unknown> = {
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
        };
        if (o.filters.length) {
          obj.filters = o.filters.map((f) => {
            const out: Record<string, unknown> = { column: f.column, op: f.op };
            if (f.value !== undefined) out.value = f.value;
            return out;
          });
        }
        return obj;
      }),
    ...(spec.joins.length
      ? {
          joins: [...spec.joins]
            .sort((a, b) => `${a.leftObject}.${a.leftColumn}`.localeCompare(`${b.leftObject}.${b.leftColumn}`))
            .map((j) => ({ leftObject: j.leftObject, leftColumn: j.leftColumn, rightObject: j.rightObject, rightColumn: j.rightColumn, kind: j.kind })),
        }
      : {}),
    // Layout last; emitted only when it has nodes, sorted by id (deterministic).
    ...(spec.layout && spec.layout.nodes.length
      ? {
          layout: {
            nodes: [...spec.layout.nodes]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((n) => ({ id: n.id, x: n.x, y: n.y })),
          },
        }
      : {}),
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
