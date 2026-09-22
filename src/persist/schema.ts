// Validate and migrate model files on open (FR-5.6, FR-5.7). Every file carries a
// `formatVersion`; older versions are migrated, newer ones refused with a clear
// message. A file that fails validation returns a readable error (path + reason)
// and is never written back.

import { z } from "zod";
import { DATA_TYPE_KINDS } from "../model/dataTypes";
import { LOGICAL_TYPE_KINDS, MODEL_LEVELS } from "../model/levels";
import type { Entity, Model } from "../model/model";

export const CURRENT_FORMAT_VERSION = 1;

const zField = z.object({
  id: z.string(),
  name: z.string(),
  // Physical type is optional (absent at Conceptual/Logical levels); logicalType
  // is present at Logical/Physical-Logical levels (FR-11).
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
  length: z.number().int().positive().optional(),
  precision: z.number().int().positive().optional(),
  scale: z.number().int().nonnegative().optional(),
  logicalType: z.enum(LOGICAL_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
  logicalName: z.string().optional(),
  nullable: z.boolean().optional().default(true),
  primaryKey: z.boolean().optional().default(false),
  unique: z.boolean().optional().default(false),
  default: z.string().optional(),
  description: z.string().optional(),
});

const zEntity = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  fields: z.array(zField),
});

const zRelationship = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
  parentEntity: z.string(),
  childEntity: z.string(),
  parentOptional: z.boolean(),
  childOptional: z.boolean(),
  foreignKeyFields: z.array(z.string()).optional().default([]),
  junctionEntity: z.string().optional(),
});

const zModel = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Models written before levels existed default to Physical (FR-5.6 migration).
  level: z.enum(MODEL_LEVELS as unknown as [string, ...string[]]).optional().default("Physical"),
  derivedFrom: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  entities: z.array(zEntity),
  relationships: z.array(zRelationship),
});

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Read the formatVersion from parsed JSON, or throw a readable error. */
function checkVersion(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "File is not a JSON object" };
  }
  const version = (raw as Record<string, unknown>).formatVersion;
  if (typeof version !== "number") {
    return { ok: false, error: "Missing or invalid formatVersion" };
  }
  if (version > CURRENT_FORMAT_VERSION) {
    return {
      ok: false,
      error: `File format version ${version} is newer than this app supports (${CURRENT_FORMAT_VERSION}). Update DaMod to open it.`,
    };
  }
  return { ok: true };
}

/** Migrate a raw model object up to the current format version. No-op for v1. */
function migrateModel(raw: Record<string, unknown>): Record<string, unknown> {
  // Future migrations switch on raw.formatVersion here.
  return raw;
}

/** Recompute in-memory-only fields (the derived `junction` flag) after parsing. */
function hydrate(model: Model): Model {
  const junctionIds = new Set(
    model.relationships.map((r) => r.junctionEntity).filter((x): x is string => !!x),
  );
  const entities: Entity[] = model.entities.map((e) =>
    junctionIds.has(e.id) ? { ...e, junction: true } : e,
  );
  return { ...model, entities };
}

/** Parse model file text into a Model, or return a readable error (FR-5.7). */
export function parseModelFile(text: string): ParseResult<Model> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const version = checkVersion(raw);
  if (!version.ok) return version;

  const migrated = migrateModel(raw as Record<string, unknown>);
  const parsed = zModel.safeParse(migrated);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  return { ok: true, value: hydrate(parsed.data as Model) };
}
