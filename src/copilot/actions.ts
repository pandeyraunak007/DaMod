// Typed, Zod-validated Copilot actions (§14.6/§14.10). The LLM proposes a PLAN
// of these actions; nothing is applied until the plan validates and the user
// approves. Actions reference objects by NAME (what the model shows the LLM); the
// executor resolves names to stable ids against the live model and reuses the
// EXISTING domain operations — the AI never mutates state or JSON directly.

import { z } from "zod";
import { DATA_TYPE_KINDS } from "../model/dataTypes";
import { DIALECT_IDS } from "../export/dialects";

const zNewField = z.object({
  name: z.string(),
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
  primaryKey: z.boolean().optional(),
  nullable: z.boolean().optional(),
});

const zCreateEntity = z.object({
  kind: z.literal("create_entity"),
  name: z.string(),
  description: z.string().optional(),
  fields: z.array(zNewField).optional(),
});

const zUpdateDescription = z.object({
  kind: z.literal("update_description"),
  entity: z.string(), // entity/table name
  field: z.string().optional(), // attribute/column name; omit for the entity itself
  text: z.string(),
});

const zCreateRelationship = z.object({
  kind: z.literal("create_relationship"),
  parent: z.string(),
  child: z.string(),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
  foreignKeyFieldName: z.string().optional(),
});

const zCreateAttribute = z.object({
  kind: z.literal("create_attribute"),
  entity: z.string(),
  name: z.string(),
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional(),
});

const zUpdateAttribute = z.object({
  kind: z.literal("update_attribute"),
  entity: z.string(),
  field: z.string(),
  newName: z.string().optional(),
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional(),
});

const zRenameEntity = z.object({
  kind: z.literal("rename_entity"),
  entity: z.string(),
  newName: z.string(),
});

// Group tables into a named subject area (Req 21/22 §6). Members come from an
// explicit `tables` list and/or an EBS product / Fusion family `product` code.
// Level-agnostic: subject areas exist at every modeling level.
const zCreateSubjectArea = z.object({
  kind: z.literal("create_subject_area"),
  name: z.string(),
  description: z.string().optional(),
  tables: z.array(z.string()).optional(),
  product: z.string().optional(),
});

// ---- other physical/logical model objects (Req 19/21/22) -------------------
const zCreateSchema = z.object({
  kind: z.literal("create_schema"),
  name: z.string(),
  owner: z.string().optional(),
  comment: z.string().optional(),
});
const zCreateView = z.object({
  kind: z.literal("create_view"),
  name: z.string(),
  definition: z.string().optional(),
  materialized: z.boolean().optional(),
});
const zCreateIndex = z.object({
  kind: z.literal("create_index"),
  entity: z.string(),
  name: z.string().optional(),
  columns: z.array(z.string()).optional(), // column names on the entity
  unique: z.boolean().optional(),
});
const zCreateSequence = z.object({
  kind: z.literal("create_sequence"),
  name: z.string(),
  start: z.number().optional(),
  increment: z.number().optional(),
});
const zCreateDomain = z.object({
  kind: z.literal("create_domain"),
  name: z.string(),
  type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]).optional(),
});
// Bind an existing reusable domain onto columns (ERwin). A domain is NOT a data type —
// never put a domain name in an attribute's `type`; create_domain then bind_domain.
// Omit `entity` to bind across every entity; omit `attribute` to bind every column in
// the targeted entity/entities. Each bound column takes the domain's physical type.
const zBindDomain = z.object({
  kind: z.literal("bind_domain"),
  domain: z.string(),
  entity: z.string().optional(),
  attribute: z.string().optional(),
});
const zCreateCheckConstraint = z.object({
  kind: z.literal("create_check_constraint"),
  entity: z.string(),
  name: z.string().optional(),
  expression: z.string(),
});
const zSetStereotype = z.object({
  kind: z.literal("set_stereotype"),
  entity: z.string(),
  stereotype: z.enum(["fact", "dimension", "none"]),
});

// ---- semantic layer (FR-7 / Req 19) -----------------------------------------
const zCreateTerm = z.object({
  kind: z.literal("create_term"),
  name: z.string(),
  definition: z.string().optional(),
  synonyms: z.array(z.string()).optional(),
});
const zCreateDimension = z.object({
  kind: z.literal("create_dimension"),
  name: z.string(),
  description: z.string().optional(),
  entity: z.string().optional(), // bind to this entity when given
});
const zCreateMetric = z.object({
  kind: z.literal("create_metric"),
  name: z.string(),
  aggregate: z.enum(["sum", "count", "count_distinct", "avg", "min", "max"]).optional(),
  entity: z.string().optional(), // grain + field owner
  field: z.string().optional(), // measured column (with entity)
  description: z.string().optional(),
});

// ---- ETL pipeline (connector framework / G-AI) ------------------------------
// Create a full-load ETL pipeline from a source MODEL to a target platform. Design-time
// only — this plans a spec, it NEVER moves data. No credentials/secrets are fields here.
const zCreatePipeline = z.object({
  kind: z.literal("create_pipeline"),
  name: z.string(),
  /** Source model name; defaults to the active model when omitted. */
  sourceModel: z.string().optional(),
  /** Target database platform for the generated load. */
  target: z.enum(DIALECT_IDS as unknown as [string, ...string[]]),
  /** Target schema (optional). */
  schema: z.string().optional(),
  /** Tables to include; omitted/empty = every table in the source model. */
  entities: z.array(z.string()).optional(),
});

// ---- Snowflake data-engineering + governance objects (Req 23 Phase 4/5) ------
// Create-only, like the other object actions. A credential/secret is never a
// field here, so the Copilot can never set one.
const zCreateSnowflakeObject = z.object({
  kind: z.literal("create_snowflake_object"),
  objectKind: z.enum(["stage", "fileFormat", "pipe", "stream", "task", "dynamicTable"]),
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
const zCreateGovernanceObject = z.object({
  kind: z.literal("create_governance_object"),
  objectKind: z.enum(["role", "grant", "tag", "maskingPolicy", "rowAccessPolicy", "share"]),
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

// ---- Naming & Data Type Standards (Phase 4) ---------------------------------
// Create-only for definitions; apply operates by standard name. Apply mutates
// (renames / normalises params) → structural, reviewed + approved, one undo group.
const zCreateNamingStandard = z.object({
  kind: z.literal("create_naming_standard"),
  name: z.string(),
  description: z.string().optional(),
  mirrorForeignKeys: z.boolean().optional(),
  rules: z
    .array(
      z.object({
        target: z.enum(["entity", "attribute", "index"]),
        case: z.enum(["snake_case", "screaming_snake", "pascal", "camel", "preserve"]),
        prefix: z.string().optional(),
        suffix: z.string().optional(),
        maxLength: z.number().int().positive().optional(),
      }),
    )
    .default([]),
});
const zApplyNamingStandard = z.object({
  kind: z.literal("apply_naming_standard"),
  name: z.string(), // the standard's name
});
const zCreateTypeStandard = z.object({
  kind: z.literal("create_type_standard"),
  name: z.string(),
  description: z.string().optional(),
  rules: z
    .array(
      z.object({
        type: z.enum(DATA_TYPE_KINDS as unknown as [string, ...string[]]),
        length: z.number().int().positive().optional(),
        precision: z.number().int().positive().optional(),
        scale: z.number().int().nonnegative().optional(),
      }),
    )
    .default([]),
});
const zApplyTypeStandard = z.object({
  kind: z.literal("apply_type_standard"),
  name: z.string(),
});

const zDeleteEntity = z.object({ kind: z.literal("delete_entity"), entity: z.string() });
const zDeleteAttribute = z.object({
  kind: z.literal("delete_attribute"),
  entity: z.string(),
  field: z.string(),
});
const zDeleteRelationship = z.object({
  kind: z.literal("delete_relationship"),
  parent: z.string(),
  child: z.string(),
});

export const zAction = z.discriminatedUnion("kind", [
  zCreateEntity,
  zUpdateDescription,
  zCreateRelationship,
  zCreateAttribute,
  zUpdateAttribute,
  zRenameEntity,
  zCreateSubjectArea,
  zCreateSchema,
  zCreateView,
  zCreateIndex,
  zCreateSequence,
  zCreateDomain,
  zBindDomain,
  zCreateCheckConstraint,
  zSetStereotype,
  zCreateTerm,
  zCreateDimension,
  zCreateMetric,
  zCreatePipeline,
  zCreateSnowflakeObject,
  zCreateGovernanceObject,
  zCreateNamingStandard,
  zApplyNamingStandard,
  zCreateTypeStandard,
  zApplyTypeStandard,
  zDeleteEntity,
  zDeleteAttribute,
  zDeleteRelationship,
]);
export type CopilotAction = z.infer<typeof zAction>;

const DESTRUCTIVE = new Set(["delete_entity", "delete_attribute", "delete_relationship"]);
export function isDestructive(a: CopilotAction): boolean {
  return DESTRUCTIVE.has(a.kind);
}

export const zPlan = z.object({
  /** One-line human summary of the whole plan. */
  summary: z.string(),
  /** Assumptions / low-confidence choices to surface to the user (§14.8.D). */
  assumptions: z.array(z.string()).default([]),
  actions: z.array(zAction),
});
export type CopilotPlan = z.infer<typeof zPlan>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePlan(raw: unknown): ParseResult<CopilotPlan> {
  const parsed = zPlan.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const i = parsed.error.issues[0];
  const path = i.path.join(".");
  return { ok: false, error: path ? `${path}: ${i.message}` : i.message };
}

/** A read-only action (a question) needs no approval; the rest mutate the model. */
export function planMutates(plan: CopilotPlan): boolean {
  return plan.actions.length > 0;
}

/** Whether a plan needs explicit approval vs review-and-apply (§14.9). Bulk or
 *  structural changes require approval; a few description edits are low-risk. */
const STRUCTURAL = new Set([
  "create_entity",
  "create_relationship",
  "rename_entity",
  "create_subject_area",
  "create_schema",
  "create_view",
  "create_index",
  "create_sequence",
  "create_domain",
  "bind_domain",
  "create_check_constraint",
  "set_stereotype",
  "create_term",
  "create_dimension",
  "create_metric",
  "create_pipeline",
  "create_snowflake_object",
  "create_governance_object",
  "create_naming_standard",
  "apply_naming_standard",
  "create_type_standard",
  "apply_type_standard",
]);
export function requiresApproval(plan: CopilotPlan): boolean {
  const mutating = plan.actions.length;
  const structural = plan.actions.some((a) => STRUCTURAL.has(a.kind));
  return structural || plan.actions.some(isDestructive) || mutating > 5;
}

/** Destructive plans (any delete) always need explicit approval (§14.9). */
export function hasDestructive(plan: CopilotPlan): boolean {
  return plan.actions.some(isDestructive);
}
