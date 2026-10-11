// Copilot context engine (§14.5). Assembles the MINIMAL model context a request
// needs, from the existing in-memory model — never credentials, source rows, or
// unrelated workspaces. Output is compact text for the LLM plus the category list
// and a raw object used for the no-secret leak check.

import type { Model, Entity } from "../model/model";
import { checkNaming, checkTypes } from "../model/model";
import { fieldTypeLabel } from "../model/fieldDisplay";
import { levelTerms } from "../model/levels";
import type { SemanticDoc } from "../semantic/semantic";
import type { PipelineSpec } from "../connectors/pipeline/spec";

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
  semantic?: SemanticDoc,
  pipelines?: PipelineSpec[],
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
  if (model.subjectAreas?.length) {
    lines.push(`Subject areas (${model.subjectAreas.length}): ${model.subjectAreas.map((a) => a.name).join(", ")}`);
  }
  // Snowflake-specific objects (names only — bodies/credentials never go to the LLM).
  if (model.snowflakeObjects?.length) {
    lines.push(`Snowflake data-engineering objects (${model.snowflakeObjects.length}): ${model.snowflakeObjects.map((o) => `${o.name} [${o.kind}]`).join(", ")}`);
  }
  if (model.governanceObjects?.length) {
    lines.push(`Snowflake governance objects (${model.governanceObjects.length}): ${model.governanceObjects.map((o) => `${o.name} [${o.kind}]`).join(", ")}`);
  }
  // Governance standards + a live compliance summary so the AI can answer read-only
  // "what violates X?" questions and reference existing standards by name.
  for (const std of model.namingStandards ?? []) {
    const n = checkNaming(model, std).length;
    lines.push(`Naming standard “${std.name}” (${std.rules.length} rule(s)): ${n} object(s) off-standard`);
  }
  for (const std of model.typeStandards ?? []) {
    const n = checkTypes(model, std).length;
    lines.push(`Type standard “${std.name}” (${std.rules.length} rule(s)): ${n} column(s) off-standard`);
  }
  // Semantic layer is workspace-wide (always available regardless of level) — list
  // what exists so the AI references rather than duplicates it.
  if (semantic && (semantic.terms.length || semantic.dimensions.length || semantic.metrics.length)) {
    lines.push(
      `Semantic layer — terms: ${semantic.terms.map((t) => t.name).join(", ") || "none"}; ` +
        `dimensions: ${semantic.dimensions.map((d) => d.name).join(", ") || "none"}; ` +
        `metrics: ${semantic.metrics.map((m) => m.name).join(", ") || "none"}`,
    );
  }
  // ETL pipelines are workspace-wide; summarise names/source→target so the AI can
  // reference them (and not re-create an existing one). No credentials ever appear here.
  if (pipelines && pipelines.length) {
    lines.push(
      `ETL pipelines (${pipelines.length}):`,
      ...pipelines.map(
        (p) =>
          `- ${p.name}: ${p.source.modelName} → ${p.target.platform}` +
          ` (${p.objects.length} object(s)${p.nodes?.length ? `, ${p.nodes.length} graph node(s)` : ""})`,
      ),
    );
  }

  const categories = ["objectNames", "dataTypes", "relationships"];
  const hasSensitive = inScope.some((e) => e.description) || true; // names are sensitive
  if (inScope.some((e) => e.description || e.fields.some((f) => f.description))) categories.push("descriptions");
  if (model.domains?.length) categories.push("domains");
  if (model.namingStandards?.length) categories.push("namingStandards");
  if ((model.namingStandards?.length ?? 0) + (model.typeStandards?.length ?? 0) > 0) categories.push("validation");
  if (pipelines?.length) categories.push("pipelines");

  return {
    text: lines.join("\n"),
    categories,
    hasSensitive,
    objectCount: inScope.length,
    raw: { level: model.level, entities: inScope, relationshipIds: relIds, domains: model.domains ?? [] },
  };
}
