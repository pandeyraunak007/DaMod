// Validation rules (FR-10). Each rule is one function over the whole workspace
// (all models + links), so a rule can be added or switched off without touching
// the rest (FR-10.5). Validation never blocks saving — only export checks it.

import type { Field, Model } from "../model/model";
import { validateIdentifier } from "../model/identifiers";
import { isConceptual, physicalToLogical, usesPhysicalTypes } from "../model/levels";
import { formatType } from "../model/dataTypes";
import {
  type ConceptGroup,
  type Link,
  entityKey,
  sameAsComponents,
} from "../links/links";

export type Severity = "error" | "warning";

export interface IssueTarget {
  model?: string;
  entity?: string;
  field?: string;
  relationship?: string;
  link?: string;
  conceptGroup?: string;
}

export interface Issue {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  target: IssueTarget;
}

export interface NamedModel {
  id: string;
  name: string;
  model: Model;
}

export interface ValidationContext {
  models: NamedModel[];
  links: Link[];
  conceptGroups: ConceptGroup[];
}

// ---- helpers ----------------------------------------------------------------

function findModel(ctx: ValidationContext, id: string): Model | undefined {
  return ctx.models.find((m) => m.id === id)?.model;
}

/** A field's generic type, for cross-level comparison. */
function generic(f: Field): string | null {
  if (f.logicalType) return f.logicalType;
  if (f.type) return physicalToLogical(f.type);
  return null;
}

/** True when two fields carry meaningfully different types. */
function typesDiffer(a: Field, b: Field): boolean {
  if (a.type && b.type) {
    return (
      formatType({ type: a.type, length: a.length, precision: a.precision, scale: a.scale }) !==
      formatType({ type: b.type, length: b.length, precision: b.precision, scale: b.scale })
    );
  }
  const ga = generic(a);
  const gb = generic(b);
  if (ga && gb) return ga !== gb;
  return false; // not enough type info to judge
}

// ---- rules ------------------------------------------------------------------

function duplicateEntityNames(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    const seen = new Map<string, number>();
    for (const e of model.entities) seen.set(e.name, (seen.get(e.name) ?? 0) + 1);
    for (const e of model.entities) {
      if ((seen.get(e.name) ?? 0) > 1) {
        issues.push({
          id: `dupEntity:${id}:${e.id}`,
          rule: "duplicateEntityNames",
          severity: "error",
          message: `Duplicate entity name “${e.name}” in ${model.name}`,
          target: { model: id, entity: e.id },
        });
      }
    }
  }
  return issues;
}

function duplicateFieldNames(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    for (const e of model.entities) {
      const seen = new Map<string, number>();
      for (const f of e.fields) seen.set(f.name, (seen.get(f.name) ?? 0) + 1);
      for (const f of e.fields) {
        if ((seen.get(f.name) ?? 0) > 1) {
          issues.push({
            id: `dupField:${id}:${e.id}:${f.id}`,
            rule: "duplicateFieldNames",
            severity: "error",
            message: `Duplicate field name “${f.name}” in ${model.name}.${e.name}`,
            target: { model: id, entity: e.id, field: f.id },
          });
        }
      }
    }
  }
  return issues;
}

function invalidIdentifiers(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    for (const e of model.entities) {
      if (validateIdentifier(e.name)) {
        issues.push({
          id: `badId:${id}:${e.id}`,
          rule: "invalidIdentifiers",
          severity: "error",
          message: `Invalid identifier “${e.name}” in ${model.name}`,
          target: { model: id, entity: e.id },
        });
      }
      for (const f of e.fields) {
        if (validateIdentifier(f.name)) {
          issues.push({
            id: `badId:${id}:${e.id}:${f.id}`,
            rule: "invalidIdentifiers",
            severity: "error",
            message: `Invalid identifier “${f.name}” in ${model.name}.${e.name}`,
            target: { model: id, entity: e.id, field: f.id },
          });
        }
      }
    }
  }
  return issues;
}

function foreignKeyTypeMismatch(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    if (isConceptual(model.level)) continue;
    for (const rel of model.relationships) {
      if (rel.cardinality === "many-to-many") continue;
      const parent = model.entities.find((e) => e.id === rel.parentEntity);
      const child = model.entities.find((e) => e.id === rel.childEntity);
      if (!parent || !child) continue;
      const pks = parent.fields.filter((f) => f.primaryKey);
      rel.foreignKeyFields.forEach((fkId, i) => {
        const pk = pks[i] ?? pks[0];
        const fk = child.fields.find((f) => f.id === fkId);
        if (pk && fk && typesDiffer(pk, fk)) {
          issues.push({
            id: `fkType:${id}:${rel.id}:${fkId}`,
            rule: "foreignKeyTypeMismatch",
            severity: "error",
            message: `${child.name}.${fk.name} type differs from ${parent.name}.${pk.name}`,
            target: { model: id, entity: child.id, field: fk.id },
          });
        }
      });
    }
  }
  return issues;
}

function danglingReferences(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  // Relationship endpoints within a model.
  for (const { id, model } of ctx.models) {
    const ids = new Set(model.entities.map((e) => e.id));
    for (const rel of model.relationships) {
      const missing =
        !ids.has(rel.parentEntity) ||
        !ids.has(rel.childEntity) ||
        (rel.junctionEntity && !ids.has(rel.junctionEntity));
      if (missing) {
        issues.push({
          id: `dangRel:${id}:${rel.id}`,
          rule: "danglingReferences",
          severity: "error",
          message: `Relationship in ${model.name} points to a missing entity`,
          target: { model: id, relationship: rel.id },
        });
      }
    }
  }
  // Link endpoints across models.
  for (const link of ctx.links) {
    for (const end of [link.from, link.to]) {
      const m = findModel(ctx, end.model);
      const e = m?.entities.find((x) => x.id === end.entity);
      const missing = !m || !e || (end.field && !e.fields.some((f) => f.id === end.field));
      if (missing) {
        issues.push({
          id: `dangLink:${link.id}`,
          rule: "danglingReferences",
          severity: "error",
          message: `A ${link.type} link points to a deleted item`,
          target: { link: link.id },
        });
        break;
      }
    }
  }
  return issues;
}

function mappedFieldTypeMismatch(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const link of ctx.links) {
    if (link.type !== "same-as" || !link.fieldMappings) continue;
    const fromModel = findModel(ctx, link.from.model);
    const toModel = findModel(ctx, link.to.model);
    const fromEntity = fromModel?.entities.find((e) => e.id === link.from.entity);
    const toEntity = toModel?.entities.find((e) => e.id === link.to.entity);
    if (!fromEntity || !toEntity) continue;
    for (const m of link.fieldMappings) {
      const a = fromEntity.fields.find((f) => f.id === m.from);
      const b = toEntity.fields.find((f) => f.id === m.to);
      if (a && b && typesDiffer(a, b)) {
        issues.push({
          id: `mapType:${link.id}:${m.from}:${m.to}`,
          rule: "mappedFieldTypeMismatch",
          severity: "error",
          message: `Mapped fields differ in type: ${fromEntity.name}.${a.name} ↔ ${toEntity.name}.${b.name}`,
          target: { model: link.from.model, entity: fromEntity.id, field: a.id },
        });
      }
    }
  }
  return issues;
}

function referencesToEntityWithoutPk(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const link of ctx.links) {
    if (link.type !== "references") continue;
    const toModel = findModel(ctx, link.to.model);
    const toEntity = toModel?.entities.find((e) => e.id === link.to.entity);
    if (toEntity && !toEntity.fields.some((f) => f.primaryKey)) {
      issues.push({
        id: `refNoPk:${link.id}`,
        rule: "referencesToEntityWithoutPk",
        severity: "error",
        message: `A references link points to ${toEntity.name}, which has no primary key`,
        target: { link: link.id, model: link.to.model, entity: toEntity.id },
      });
    }
  }
  return issues;
}

function sameAsGroupWithoutCanonical(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const comps = sameAsComponents(ctx.links);
  for (const comp of comps) {
    const keys = new Set(comp.map((r) => entityKey(r.model, r.entity)));
    const hasCanonical = ctx.conceptGroups.some((g) =>
      keys.has(entityKey(g.canonical.model, g.canonical.entity)),
    );
    if (!hasCanonical) {
      const first = comp[0];
      issues.push({
        id: `noCanonical:${[...keys].sort().join(",")}`,
        rule: "sameAsGroupWithoutCanonical",
        severity: "error",
        message: `A same-as group has no canonical entity`,
        target: { model: first.model, entity: first.entity },
      });
    }
  }
  return issues;
}

function entityWithoutPrimaryKey(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    if (isConceptual(model.level)) continue; // Conceptual has no keys (FR-11.9)
    for (const e of model.entities) {
      if (e.fields.length && !e.fields.some((f) => f.primaryKey)) {
        issues.push({
          id: `noPk:${id}:${e.id}`,
          rule: "entityWithoutPrimaryKey",
          severity: "warning",
          message: `${model.name}.${e.name} has no primary key`,
          target: { model: id, entity: e.id },
        });
      }
    }
  }
  return issues;
}

function entityWithoutRelationships(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    const connected = new Set<string>();
    for (const r of model.relationships) {
      connected.add(r.parentEntity);
      connected.add(r.childEntity);
      if (r.junctionEntity) connected.add(r.junctionEntity);
    }
    for (const e of model.entities) {
      if (!e.junction && !connected.has(e.id) && model.entities.length > 1) {
        issues.push({
          id: `noRel:${id}:${e.id}`,
          rule: "entityWithoutRelationships",
          severity: "warning",
          message: `${model.name}.${e.name} has no relationships`,
          target: { model: id, entity: e.id },
        });
      }
    }
  }
  return issues;
}

function physicalFieldWithoutType(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  for (const { id, model } of ctx.models) {
    if (!usesPhysicalTypes(model.level)) continue; // FR-11.9
    for (const e of model.entities) {
      for (const f of e.fields) {
        if (!f.type) {
          issues.push({
            id: `noType:${id}:${e.id}:${f.id}`,
            rule: "physicalFieldWithoutType",
            severity: "error",
            message: `${model.name}.${e.name}.${f.name} has no physical type`,
            target: { model: id, entity: e.id, field: f.id },
          });
        }
      }
    }
  }
  return issues;
}

const RULES: ((ctx: ValidationContext) => Issue[])[] = [
  duplicateEntityNames,
  duplicateFieldNames,
  invalidIdentifiers,
  foreignKeyTypeMismatch,
  danglingReferences,
  mappedFieldTypeMismatch,
  referencesToEntityWithoutPk,
  sameAsGroupWithoutCanonical,
  entityWithoutPrimaryKey,
  entityWithoutRelationships,
  physicalFieldWithoutType,
];

/** Run every rule over the workspace and return all issues (FR-10.1). */
export function validateWorkspace(ctx: ValidationContext): Issue[] {
  return RULES.flatMap((rule) => rule(ctx));
}
