// Orchestrates one Copilot request (§14.6): privacy gate → context → provider →
// structured plan. No model mutation happens here — the returned plan is only
// applied after the user approves it (see execute.ts).

import { type CopilotPlan, parsePlan } from "./actions";
import { type BuiltContext } from "./context";
import { type Provider, extractJson } from "./provider";
import { type NoTrainingStatus, type PrivacyPolicy, enforcePrivacy, findContextLeaks } from "./privacy";

export const SYSTEM_PROMPT = `You are a data-modeling copilot embedded in an ER modeling tool. You NEVER mutate anything directly; you return a JSON PLAN of actions that the app validates and the user approves.

Return ONLY a JSON object with this shape:
{
  "summary": string,
  "assumptions": string[],   // list any guesses (cardinality, types, constraints)
  "actions": Action[]
}

A type is one of: string|text|integer|bigint|decimal|boolean|date|timestamp|uuid|json.

Action is one of:
- { "kind": "create_entity", "name": string, "description"?: string, "fields"?: [{ "name": string, "type"?: type, "primaryKey"?: boolean, "nullable"?: boolean }] }
- { "kind": "update_description", "entity": string, "field"?: string, "text": string }
- { "kind": "create_relationship", "parent": string, "child": string, "cardinality": "one-to-one"|"one-to-many"|"many-to-many", "foreignKeyFieldName"?: string }
- { "kind": "create_attribute", "entity": string, "name": string, "type"?: type, "primaryKey"?: boolean, "unique"?: boolean, "nullable"?: boolean }   // add a column/attribute to an EXISTING entity
- { "kind": "update_attribute", "entity": string, "field": string, "newName"?: string, "type"?: type, "primaryKey"?: boolean, "unique"?: boolean, "nullable"?: boolean }   // change/rename a column
- { "kind": "rename_entity", "entity": string, "newName": string }
- { "kind": "delete_entity", "entity": string }
- { "kind": "delete_attribute", "entity": string, "field": string }
- { "kind": "delete_relationship", "parent": string, "child": string }

Rules:
- Reference existing objects by their exact name from the context.
- Entity/field names must be valid identifiers (letters, digits, underscore; not starting with a digit).
- Do NOT invent uniqueness/mandatory/business rules unless the user asked or it is an obvious key; put any guess in "assumptions".
- Only use the modeling terminology shown in the context's level.
- Keep the plan minimal and grounded in the given model; do not reference objects that are not in the context.`;

export interface PlanRequestResult {
  plan?: CopilotPlan;
  error?: string;
  blocked?: string; // privacy policy blocked the request
}

export async function requestPlan(
  provider: Provider,
  userText: string,
  context: BuiltContext,
  privacy: { policy: PrivacyPolicy; status: NoTrainingStatus },
  signal?: AbortSignal,
): Promise<PlanRequestResult> {
  // 1. Privacy gate (§14.4) — never send confidential context under a policy the
  //    provider can't satisfy.
  const gate = enforcePrivacy(privacy.policy, privacy.status, context.hasSensitive);
  if (!gate.ok) return { blocked: gate.reason };

  // 2. Hard secret-leak guard — no credential may ever reach the provider.
  const leaks = findContextLeaks(context.raw);
  if (leaks.length) return { error: `Refusing to send: context contains secret-like fields (${leaks.join(", ")}).` };

  // 3. Call the provider for a structured plan.
  let text: string;
  try {
    text = await provider.complete({
      json: true,
      signal,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `MODEL CONTEXT:\n${context.text}\n\nREQUEST:\n${userText}` },
      ],
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  // 4. Parse + validate the plan with Zod (never trust free-form text).
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { error: `Could not read a plan from the response: ${(e as Error).message}` };
  }
  const parsed = parsePlan(raw);
  if (!parsed.ok) return { error: `Invalid plan: ${parsed.error}` };
  return { plan: parsed.value };
}
