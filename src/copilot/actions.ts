// Typed, Zod-validated Copilot actions (§14.6/§14.10). The LLM proposes a PLAN
// of these actions; nothing is applied until the plan validates and the user
// approves. Actions reference objects by NAME (what the model shows the LLM); the
// executor resolves names to stable ids against the live model and reuses the
// EXISTING domain operations — the AI never mutates state or JSON directly.

import { z } from "zod";
import { DATA_TYPE_KINDS } from "../model/dataTypes";

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
export function requiresApproval(plan: CopilotPlan): boolean {
  const mutating = plan.actions.length;
  const structural = plan.actions.some(
    (a) => a.kind === "create_entity" || a.kind === "create_relationship" || a.kind === "rename_entity",
  );
  return structural || plan.actions.some(isDestructive) || mutating > 5;
}

/** Destructive plans (any delete) always need explicit approval (§14.9). */
export function hasDestructive(plan: CopilotPlan): boolean {
  return plan.actions.some(isDestructive);
}
