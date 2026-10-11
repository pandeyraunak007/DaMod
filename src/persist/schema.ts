// Validate and migrate model files on open (FR-5.6, FR-5.7). Every file carries a
// `formatVersion`; older versions are migrated, newer ones refused with a clear
// message. A file that fails validation returns a readable error (path + reason)
// and is never written back.

import { z } from "zod";
import { DATA_TYPE_KINDS } from "../model/dataTypes";
import { LOGICAL_TYPE_KINDS, MODEL_LEVELS } from "../model/levels";
import type { Entity, Model } from "../model/model";

export const CURRENT_FORMAT_VERSION = 1;

const zUdp = z.object({ name: z.string(), value: z.string() });
const zRiAction = z.enum(["no action", "cascade", "restrict", "set null", "set default"]);

const zObjectSource = z.object({
  system: z.string().optional(),
  schema: z.string().optional(),
  nativeId: z.string().optional(),
  nativeType: z.string().optional(),
  product: z.string().optional(),
  provenance: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  apiPath: z.string().optional(),
  apiVersion: z.string().optional(),
});

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
  domainId: z.string().optional(),
  role: z.enum(["measure", "degenerate"]).optional(),
  description: z.string().optional(),
  note: z.string().optional(),
  udps: z.array(zUdp).optional(),
  source: zObjectSource.optional(),
});

const zCheck = z.object({
  id: z.string(),
  name: z.string(),
  expression: z.string(),
});

const zEntity = z.object({
  id: z.string(),
  name: z.string(),
  logicalName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  stereotype: z.enum(["fact", "dimension"]).optional(),
  schema: z.string().optional(),
  tableKind: z.enum(["standard", "temporary", "transient", "external", "hybrid"]).optional(),
  note: z.string().optional(),
  udps: z.array(zUdp).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  fields: z.array(zField),
  checks: z.array(zCheck).optional(),
  source: zObjectSource.optional(),
});

const zRelationship = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
  identifying: z.boolean().optional(),
  subtype: z.boolean().optional(),
  parentEntity: z.string(),
  childEntity: z.string(),
  parentOptional: z.boolean(),
  childOptional: z.boolean(),
  foreignKeyFields: z.array(z.string()).optional().default([]),
  junctionEntity: z.string().optional(),
  childVerbPhrase: z.string().optional(),
  onDelete: zRiAction.optional(),
  onUpdate: zRiAction.optional(),
  enforced: z.boolean().optional(),
  note: z.string().optional(),
  udps: z.array(zUdp).optional(),
});

const zView = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.string(),
  materialized: z.boolean().optional(),
  withNoData: z.boolean().optional(),
  sources: z.array(z.string()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
});

const zSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  comment: z.string().optional(),
});

const zSubjectArea = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  product: z.string().optional(),
  entities: z.array(z.string()).default([]),
});

const zSnowflakeObject = z.object({
  id: z.string(),
  kind: z.enum(["stage", "fileFormat", "pipe", "stream", "task", "dynamicTable"]),
  name: z.string(),
  comment: z.string().optional(),
  stageType: z.enum(["internal", "external"]).optional(),
  url: z.string().optional(),
  fileFormat: z.string().optional(),
  formatType: z.string().optional(),
  options: z.string().optional(),
  copyStatement: z.string().optional(),
  autoIngest: z.boolean().optional(),
  sourceObject: z.string().optional(),
  streamType: z.enum(["standard", "append_only", "insert_only"]).optional(),
  warehouse: z.string().optional(),
  schedule: z.string().optional(),
  sql: z.string().optional(),
  after: z.string().optional(),
  targetLag: z.string().optional(),
});

const zNamingRule = z.object({
  target: z.enum(["entity", "attribute", "index"]),
  case: z.enum(["snake_case", "screaming_snake", "pascal", "camel", "preserve"]),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  maxLength: z.number().int().positive().optional(),
});

const zNamingStandard = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  rules: z.array(zNamingRule).default([]),
});

const zGovernanceObject = z.object({
  id: z.string(),
  kind: z.enum(["role", "grant", "tag", "maskingPolicy", "rowAccessPolicy", "share"]),
  name: z.string(),
  comment: z.string().optional(),
  grantedRoles: z.array(z.string()).optional(),
  privilege: z.string().optional(),
  onObject: z.string().optional(),
  toRole: z.string().optional(),
  allowedValues: z.array(z.string()).optional(),
  argType: z.string().optional(),
  returnType: z.string().optional(),
  signature: z.string().optional(),
  body: z.string().optional(),
  shareObjects: z.array(z.string()).optional(),
  accounts: z.array(z.string()).optional(),
});

const zIndex = z.object({
  id: z.string(),
  name: z.string(),
  entity: z.string(),
  fields: z.array(z.string()),
  unique: z.boolean().optional(),
});

const zSequence = z.object({
  id: z.string(),
  name: z.string(),
  start: z.number().optional(),
  increment: z.number().optional(),
});

const zRawObject = z.object({
  id: z.string(),
  name: z.string(),
  dialect: z.enum(["postgres", "snowflake", "databricks", "oracle", "sqlserver", "mysql", "bigquery"]),
  kind: z.string().optional(),
  sql: z.string(),
});

const zDomain = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]),
  length: z.number().int().positive().optional(),
  precision: z.number().int().positive().optional(),
  scale: z.number().int().nonnegative().optional(),
  logicalType: z.enum(LOGICAL_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
  default: z.string().optional(),
  description: z.string().optional(),
});

const zModel = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Models written before levels existed default to Physical (FR-5.6 migration).
  level: z.enum(MODEL_LEVELS as unknown as [string, ...string[]]).optional().default("Physical"),
  // Target database (Req 17). Optional: models written before Req 17 have none and
  // keep current behaviour (Postgres default applied at use via modelDialect).
  dialect: z.enum(["postgres", "snowflake", "databricks", "oracle", "sqlserver", "mysql", "bigquery"]).optional(),
  notation: z.enum(["IE", "IDEF1X"]).optional(),
  derivedFrom: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  entities: z.array(zEntity),
  relationships: z.array(zRelationship),
  schemas: z.array(zSchema).optional(),
  subjectAreas: z.array(zSubjectArea).optional(),
  snowflakeObjects: z.array(zSnowflakeObject).optional(),
  governanceObjects: z.array(zGovernanceObject).optional(),
  namingStandards: z.array(zNamingStandard).optional(),
  views: z.array(zView).optional(),
  indexes: z.array(zIndex).optional(),
  sequences: z.array(zSequence).optional(),
  rawObjects: z.array(zRawObject).optional(),
  domains: z.array(zDomain).optional(),
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
