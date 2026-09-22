// Semantic layer export (FR-9): semantic.yaml with terms, dimensions and metrics.
// Every binding is written as a readable model.entity.field path, never an ID.
// Each metric carries a generated SQL snippet. Output is deterministic, ordered
// by name.

import { stringify as yamlStringify } from "yaml";
import type { Model } from "../model/model";
import type { ConceptGroup } from "../links/links";
import {
  type EntityRef,
  type FieldRef,
  type Metric,
  type SemanticDoc,
  type TermBinding,
  TIME_GRAINS,
} from "../semantic/semantic";

export interface NamedModel {
  id: string;
  name: string;
  model: Model;
}

export class Resolver {
  private models: Map<string, Model>;
  private names: Map<string, string>;
  private concepts: Map<string, string>;

  constructor(models: NamedModel[], conceptGroups: ConceptGroup[]) {
    this.models = new Map(models.map((m) => [m.id, m.model]));
    this.names = new Map(models.map((m) => [m.id, m.name]));
    this.concepts = new Map(conceptGroups.map((c) => [c.id, c.name]));
  }

  entityPath(ref: EntityRef): string {
    const model = this.models.get(ref.model);
    const entity = model?.entities.find((e) => e.id === ref.entity);
    return `${this.names.get(ref.model) ?? "?"}.${entity?.name ?? "?"}`;
  }

  fieldPath(ref: FieldRef): string {
    const model = this.models.get(ref.model);
    const entity = model?.entities.find((e) => e.id === ref.entity);
    const field = entity?.fields.find((f) => f.id === ref.field);
    return `${this.names.get(ref.model) ?? "?"}.${entity?.name ?? "?"}.${field?.name ?? "?"}`;
  }

  fieldName(ref: FieldRef): string {
    const entity = this.models.get(ref.model)?.entities.find((e) => e.id === ref.entity);
    return entity?.fields.find((f) => f.id === ref.field)?.name ?? "?";
  }

  entityName(ref: EntityRef): string {
    return this.models.get(ref.model)?.entities.find((e) => e.id === ref.entity)?.name ?? "?";
  }

  conceptName(id: string): string {
    return this.concepts.get(id) ?? "?";
  }

  bindingPath(b: TermBinding): string {
    if ("concept" in b) return `concept:${this.conceptName(b.concept)}`;
    if ("field" in b) return this.fieldPath(b);
    return this.entityPath(b);
  }
}

function quoteValue(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

/** The generated SQL snippet for a metric (FR-9.2). */
export function metricSql(metric: Metric, r: Resolver, semantic: SemanticDoc): string {
  if (metric.derived) {
    const left = semantic.metrics.find((m) => m.id === metric.derived!.left);
    const right = semantic.metrics.find((m) => m.id === metric.derived!.right);
    return `${left?.key ?? "?"} ${metric.derived.op} ${right?.key ?? "?"}`;
  }
  const agg = metric.aggregate ?? "count";
  const col = metric.field ? r.fieldName(metric.field) : "*";
  const aggExpr = agg === "count_distinct" ? `count(distinct ${col})` : `${agg}(${col})`;
  const from = metric.grain ? r.entityName(metric.grain) : "?";
  let where = "";
  if (metric.filters && metric.filters.length) {
    const clauses = metric.filters.map((f) => {
      const name = r.fieldName(f.field);
      if (f.op === "is null" || f.op === "is not null") return `${name} ${f.op}`;
      if (f.op === "in") return `${name} in (${f.value ?? ""})`;
      return `${name} ${f.op} ${quoteValue(f.value ?? "")}`;
    });
    where = ` WHERE ${clauses.join(" AND ")}`;
  }
  return `SELECT ${aggExpr} FROM ${from}${where}`;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Export the whole semantic layer as YAML text. */
export function exportSemanticYaml(
  semantic: SemanticDoc,
  models: NamedModel[],
  conceptGroups: ConceptGroup[],
): string {
  const r = new Resolver(models, conceptGroups);

  const terms = [...semantic.terms].sort(byName).map((t) => {
    const out: Record<string, unknown> = { name: t.name, definition: t.definition };
    if (t.synonyms && t.synonyms.length) out.synonyms = [...t.synonyms];
    if (t.bindings && t.bindings.length) out.bindings = t.bindings.map((b) => r.bindingPath(b));
    return out;
  });

  const dimensions = [...semantic.dimensions].sort(byName).map((d) => {
    const out: Record<string, unknown> = { name: d.name };
    if (d.description) out.description = d.description;
    if (d.concept) out.concept = r.conceptName(d.concept);
    else if (d.entity) out.entity = r.entityPath(d.entity);
    if (d.time) {
      out.time = true;
      out.grains = [...TIME_GRAINS];
    }
    if (d.field) out.field = r.fieldPath(d.field);
    if (d.attributes && d.attributes.length) {
      out.attributes = d.attributes.map((a) => ({ name: a.name, field: r.fieldPath(a.field) }));
    }
    if (d.hierarchies && d.hierarchies.length) {
      out.hierarchies = d.hierarchies.map((h) => ({ name: h.name, levels: [...h.levels] }));
    }
    return out;
  });

  const metrics = [...semantic.metrics].sort(byName).map((m) => {
    const out: Record<string, unknown> = { name: m.name, key: m.key };
    if (m.description) out.description = m.description;
    if (m.derived) {
      const left = semantic.metrics.find((x) => x.id === m.derived!.left);
      const right = semantic.metrics.find((x) => x.id === m.derived!.right);
      out.derived = { left: left?.key ?? "?", op: m.derived.op, right: right?.key ?? "?" };
    } else {
      if (m.aggregate) out.aggregate = m.aggregate;
      if (m.field) out.field = r.fieldPath(m.field);
      if (m.grain) out.grain = r.entityPath(m.grain);
      if (m.filters && m.filters.length) {
        out.filters = m.filters.map((f) => {
          const fo: Record<string, unknown> = { field: r.fieldPath(f.field), op: f.op };
          if (f.value !== undefined && f.value !== "") fo.value = f.value;
          return fo;
        });
      }
    }
    out.sql = metricSql(m, r, semantic);
    return out;
  });

  const cubes = [...(semantic.cubes ?? [])].sort(byName).map((c) => {
    const out: Record<string, unknown> = { name: c.name };
    if (c.description) out.description = c.description;
    out.measures = c.measures.map((id) => semantic.metrics.find((m) => m.id === id)?.name ?? "?");
    out.dimensions = c.dimensions.map(
      (id) => semantic.dimensions.find((d) => d.id === id)?.name ?? "?",
    );
    return out;
  });

  return yamlStringify({ terms, dimensions, metrics, cubes });
}
