// Canonical metadata contract (§3.4). A versioned, Zod-validated representation
// of what a connector discovered in a source, normalized once so modeling,
// comparison, and pipeline planning all reuse it ("discover once, normalize
// once, reuse"). Native types/identifiers are preserved alongside the normalized
// view so round-trips and future schema comparison stay possible.
//
// The shape is deliberately object-centric rather than table-centric: a
// SourceObject has a `kind` (table/view/businessObject/apiResource/…), so the
// contract extends to application sources (e.g. Oracle Fusion) that are not
// directly-accessible database tables. Relational discovery uses table/view.

import { z } from "zod";
import { DATA_TYPE_KINDS } from "../model/dataTypes";
import { CAPABILITIES } from "./capabilities";

export const METADATA_VERSION = 1;

/** The kind of source system a metadata set came from. Extensible. */
export const SOURCE_SYSTEM_TYPES = [
  "postgres",
  "oracle",
  "oracle-ebs",
  "oracle-fusion",
  "snowflake",
  "databricks",
  "sql-file",
  "mock",
] as const;
export type SourceSystemType = (typeof SOURCE_SYSTEM_TYPES)[number];

/** The kind of a discovered object. Tables/views for DBs; the rest for apps. */
export const OBJECT_KINDS = [
  "table",
  "view",
  "materialized-view",
  "business-object",
  "api-resource",
  "other",
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

const zNormalizedType = z.object({
  // Reuses the application's fixed modeling type set — the bridge to the model.
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]),
  length: z.number().int().positive().optional(),
  precision: z.number().int().positive().optional(),
  scale: z.number().int().nonnegative().optional(),
});
export type NormalizedType = z.infer<typeof zNormalizedType>;

const zColumn = z.object({
  name: z.string(),
  ordinal: z.number().int().nonnegative(),
  /** The source's own type spelling, preserved verbatim (e.g. "timestamptz"). */
  nativeType: z.string(),
  /** The type mapped into the fixed modeling set; omitted if unmappable. */
  normalizedType: zNormalizedType.optional(),
  nullable: z.boolean(),
  default: z.string().optional(),
  generated: z.boolean().optional(),
  comment: z.string().optional(),
  nativeId: z.string().optional(),
});
export type CanonicalColumn = z.infer<typeof zColumn>;

/** Evidence hierarchy for a discovered relationship (Req 21 §7), strongest first.
 *  Application databases carry logical relationships not declared as DB FKs, so a
 *  relationship records WHERE it came from and (for weaker evidence) a confidence. */
export const RELATIONSHIP_PROVENANCE = [
  "declared-fk", // an actual database foreign key
  "ebs-metadata", // documented EBS/application dictionary relationship
  "etrm-import", // imported eTRM relationship/dependency metadata
  "user-mapping", // a mapping the user provided
  "ai-proposed", // inferred by the Copilot — must be reviewed before commit
] as const;
export type RelationshipProvenance = (typeof RELATIONSHIP_PROVENANCE)[number];

const zForeignKey = z.object({
  name: z.string().optional(),
  columns: z.array(z.string()).min(1),
  refSchema: z.string().optional(),
  refObject: z.string(),
  refColumns: z.array(z.string()).min(1),
  onDelete: z.string().optional(),
  onUpdate: z.string().optional(),
  /** Where this relationship came from (Req 21 §7). Defaults to a declared FK. */
  provenance: z.enum(RELATIONSHIP_PROVENANCE).optional(),
  /** 0..1 confidence for inferred (non-declared) relationships. */
  confidence: z.number().min(0).max(1).optional(),
});
export type CanonicalForeignKey = z.infer<typeof zForeignKey>;

const zIndex = z.object({
  name: z.string(),
  columns: z.array(z.string()).min(1),
  unique: z.boolean(),
});

const zObject = z.object({
  name: z.string(),
  kind: z.enum(OBJECT_KINDS),
  columns: z.array(zColumn),
  primaryKey: z.array(z.string()).optional(), // column names, in key order
  foreignKeys: z.array(zForeignKey).default([]),
  indexes: z.array(zIndex).default([]),
  comment: z.string().optional(),
  nativeId: z.string().optional(),
  /** Preserved source-native metadata that has no normalized representation. */
  native: z.record(z.string(), z.unknown()).optional(),
});
export type CanonicalObject = z.infer<typeof zObject>;

const zSchema = z.object({
  name: z.string(),
  objects: z.array(zObject),
});
export type CanonicalSchema = z.infer<typeof zSchema>;

const zCatalog = z.object({
  name: z.string(),
  schemas: z.array(zSchema),
});

const zSourceIdentity = z.object({
  systemType: z.enum(SOURCE_SYSTEM_TYPES),
  /** A stable, non-sensitive label for the source (e.g. host/db, never creds). */
  name: z.string(),
  /** The underlying database product version (e.g. the Oracle Database version). */
  productVersion: z.string().optional(),
  /** EBS application release (e.g. "12.2.9"), kept SEPARATE from the DB version
   *  (Req 21 §2/§11). Only present for an Oracle E-Business Suite source. */
  ebsRelease: z.string().optional(),
  /** EBS instance / environment identifier, where known (non-sensitive). */
  ebsInstance: z.string().optional(),
});

/** Kinds of Oracle program unit surfaced in EBS application metadata (Req 21 §3C). */
export const PROGRAM_UNIT_KINDS = [
  "package",
  "package-body",
  "procedure",
  "function",
  "trigger",
  "synonym",
  "type",
] as const;
export type ProgramUnitKind = (typeof PROGRAM_UNIT_KINDS)[number];

const zConcurrentProgram = z.object({
  shortName: z.string(),
  name: z.string(),
  product: z.string(),
  description: z.string().optional(),
});
const zLookup = z.object({
  type: z.string(),
  product: z.string(),
  description: z.string().optional(),
});
const zProgramUnit = z.object({
  name: z.string(),
  kind: z.enum(PROGRAM_UNIT_KINDS),
  schema: z.string(),
  product: z.string().optional(),
  description: z.string().optional(),
});

/** EBS application-dictionary metadata (Req 21 §3C/§4) — discovered from the FND
 *  dictionary / eTRM, NOT from standard Oracle catalog views. These are reference
 *  facts (not editable model objects), stored on the snapshot and shown read-only. */
export const zEbsApplication = z.object({
  concurrentPrograms: z.array(zConcurrentProgram).default([]),
  lookups: z.array(zLookup).default([]),
  programUnits: z.array(zProgramUnit).default([]),
});
export type EbsApplication = z.infer<typeof zEbsApplication>;
export type ConcurrentProgram = z.infer<typeof zConcurrentProgram>;
export type EbsLookup = z.infer<typeof zLookup>;
export type ProgramUnit = z.infer<typeof zProgramUnit>;

export const zCanonicalMetadata = z.object({
  metadataVersion: z.literal(METADATA_VERSION),
  source: zSourceIdentity,
  capabilities: z.array(z.enum(CAPABILITIES as unknown as [string, ...string[]])).default([]),
  catalogs: z.array(zCatalog),
  /** EBS application-dictionary metadata (optional; present for oracle-ebs sources). */
  application: zEbsApplication.optional(),
});
export type CanonicalMetadata = z.infer<typeof zCanonicalMetadata>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Validate an untrusted metadata object (e.g. from a connector or disk). */
export function parseMetadata(raw: unknown): ParseResult<CanonicalMetadata> {
  const parsed = zCanonicalMetadata.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: firstIssue(parsed.error) };
}

/** Every object across all catalogs/schemas, with its schema name. */
export function allObjects(
  md: CanonicalMetadata,
): { schema: string; object: CanonicalObject }[] {
  const out: { schema: string; object: CanonicalObject }[] = [];
  for (const cat of md.catalogs) {
    for (const sch of cat.schemas) {
      for (const obj of sch.objects) out.push({ schema: sch.name, object: obj });
    }
  }
  return out;
}
