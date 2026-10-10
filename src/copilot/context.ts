// Copilot context engine (§14.5). Assembles the MINIMAL model context a request
// needs, from the existing in-memory model — never credentials, source rows, or
// unrelated workspaces. Output is compact text for the LLM plus the category list
// and a raw object used for the no-secret leak check.

import type { Model, Entity } from "../model/model";
import { fieldTypeLabel } from "../model/fieldDisplay";
import { levelTerms } from "../model/levels";

export type ContextScope = "selection" | "model";

export interface BuiltContext {
  text: string;
  categories: string[];
  hasSensitive: boolean;
  objectCount: number;
  /** The raw structure, scanned for accidental secret leakage before sending. */
  raw: unknown;
}

function entityLine(model: Model, e: Entity): string {
  const cols = e.fields
    .map((f) => {
      const t = fieldTypeLabel(f, model.level);
      const marks = [f.primaryKey ? "PK" : "", f.unique ? "UNIQUE" : "", f.nullable ? "" : "NOT NULL"]
        .filter(Boolean)
        .join(" ");
      return `${f.name}${t ? ` ${t}` : ""}${marks ? ` [${marks}]` : ""}`;
    })
    .join(", ");
  const desc = e.description ? `  // ${e.description}` : "";
  return `- ${e.name}: ${cols || "(no fields)"}${desc}`;
}

function relLine(model: Model, rId: string): string | null {
  const r = model.relationships.find((x) => x.id === rId);
  if (!r) return null;
  const p = model.entities.find((e) => e.id === r.parentEntity)?.name ?? "?";
  const c = model.entities.find((e) => e.id === r.childEntity)?.name ?? "?";
  const card = r.cardinality === "one-to-one" ? "1:1" : r.cardinality === "many-to-many" ? "N:M" : "1:N";
  return `- ${p} ${card} ${c}`;
}

/** Build context for a scope. `selectedEntityId` narrows "selection" scope. */
export function buildContext(
  model: Model,
  scope: ContextScope,
  selectedEntityId?: string | null,
): BuiltContext {
  const terms = levelTerms(model.level);
  const inScope: Entity[] =
    scope === "selection" && selectedEntityId
      ? model.entities.filter(
          (e) =>
            e.id === selectedEntityId ||
            model.relationships.some(
              (r) =>
                (r.parentEntity === selectedEntityId && r.childEntity === e.id) ||
                (r.childEntity === selectedEntityId && r.parentEntity === e.id),
            ),
        )
      : model.entities;

  const relIds = model.relationships
    .filter((r) => inScope.some((e) => e.id === r.parentEntity) && inScope.some((e) => e.id === r.childEntity))
    .map((r) => r.id);

  const lines: string[] = [
    `Model: ${model.name}  (level: ${model.level}; terminology: ${terms.entity}/${terms.field})`,
    `${terms.entityPlural} (${inScope.length}):`,
    ...inScope.map((e) => entityLine(model, e)),
  ];
  if (relIds.length) {
    lines.push(`Relationships (${relIds.length}):`, ...relIds.map((id) => relLine(model, id)).filter(Boolean) as string[]);
  }
  if (model.domains?.length) {
    lines.push(
      `Domains (${model.domains.length}):`,
      ...model.domains.map((d) => `- ${d.name}: ${d.type}`),
    );
  }

  const categories = ["objectNames", "dataTypes", "relationships"];
  const hasSensitive = inScope.some((e) => e.description) || true; // names are sensitive
  if (inScope.some((e) => e.description || e.fields.some((f) => f.description))) categories.push("descriptions");
  if (model.domains?.length) categories.push("domains");

  return {
    text: lines.join("\n"),
    categories,
    hasSensitive,
    objectCount: inScope.length,
    raw: { level: model.level, entities: inScope, relationshipIds: relIds, domains: model.domains ?? [] },
  };
}
