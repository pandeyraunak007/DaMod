// Pure model transforms. Each takes a Model and returns a *new* Model (via
// structuredClone) plus any metadata the UI needs (created IDs, change notices).
// Keeping these pure makes them unit-testable and makes the store's history a
// simple stack of immutable snapshots.

import {
  type Cardinality,
  type Field,
  type Model,
  type Position,
  type Relationship,
  findEntity,
  findField,
  newEntity,
  newField,
  primaryKeyFields,
} from "./model";
import { copyTypeSpec, sameType, type TypeSpec } from "./dataTypes";
import { toSnakeCase } from "./identifiers";
import { newId } from "../lib/ids";

function clone(model: Model): Model {
  return structuredClone(model);
}

/** A single foreign-key field whose type was realigned to its referenced key. */
export interface TypeChange {
  entityId: string;
  entityName: string;
  fieldId: string;
  fieldName: string;
  from: string;
  to: string;
}

function applyType(target: Field, source: TypeSpec): void {
  const spec = copyTypeSpec(source);
  target.type = spec.type;
  target.length = spec.length;
  target.precision = spec.precision;
  target.scale = spec.scale;
}

/**
 * Realign every foreign-key field to the type of the primary key it references
 * (FR-3.7). Junction id fields are mapped positionally: parent keys first, then
 * child keys, matching how createRelationship builds them. Mutates `model` and
 * returns the list of fields it changed, for the visible notice.
 */
export function reconcileForeignKeyTypes(model: Model): TypeChange[] {
  const changes: TypeChange[] = [];

  const record = (entityId: string, entityName: string, field: Field, before: TypeSpec) => {
    changes.push({
      entityId,
      entityName,
      fieldId: field.id,
      fieldName: field.name,
      from: formatSpec(before),
      to: formatSpec(field),
    });
  };

  for (const rel of model.relationships) {
    const parent = findEntity(model, rel.parentEntity);
    const child = findEntity(model, rel.childEntity);
    if (!parent) continue;

    if (rel.cardinality !== "many-to-many") {
      if (!child) continue;
      const parentPks = primaryKeyFields(parent);
      rel.foreignKeyFields.forEach((fkId, i) => {
        const pk = parentPks[i] ?? parentPks[0];
        const fk = findField(child, fkId);
        if (!pk || !fk || sameType(fk, pk)) return;
        const before = copyTypeSpec(fk);
        applyType(fk, pk);
        record(child.id, child.name, fk, before);
      });
    } else if (rel.junctionEntity) {
      const junction = findEntity(model, rel.junctionEntity);
      if (!junction || !child) continue;
      const ordered = [...primaryKeyFields(parent), ...primaryKeyFields(child)];
      const junctionPks = junction.fields.filter((f) => f.primaryKey);
      ordered.forEach((pk, i) => {
        const jf = junctionPks[i];
        if (!jf || sameType(jf, pk)) return;
        const before = copyTypeSpec(jf);
        applyType(jf, pk);
        record(junction.id, junction.name, jf, before);
      });
    }
  }

  return changes;
}

function formatSpec(spec: TypeSpec): string {
  // Local re-implementation to avoid importing formatType's default-filling,
  // so a notice shows exactly what was stored.
  if (spec.type === "string") return `string(${spec.length})`;
  if (spec.type === "decimal") return `decimal(${spec.precision},${spec.scale})`;
  return spec.type;
}

export interface CreateRelationshipInput {
  cardinality: Cardinality;
  parentEntity: string;
  childEntity: string;
  parentOptional?: boolean;
  childOptional?: boolean;
  label?: string;
  description?: string;
  /** Name to give the FK field created on the child (1:1 / 1:M). */
  foreignKeyFieldName?: string;
  /** Reuse an existing field on the child as the FK instead of creating one. */
  existingForeignKeyFieldId?: string;
  /** Override the generated junction entity name (M:N). */
  junctionName?: string;
}

export interface CreateRelationshipResult {
  model: Model;
  relationshipId: string;
  createdFieldIds: string[];
  junctionEntityId?: string;
}

function midpoint(a: Position, b: Position): Position {
  return { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
}

/** Default FK field name for a parent PK, e.g. Customer.id -> customer_id. */
export function suggestForeignKeyName(parentName: string, pk: Field | undefined): string {
  const base = toSnakeCase(parentName);
  if (!pk) return `${base}_id`;
  // Customer.id -> customer_id; Order.number -> order_number
  return pk.name === "id" ? `${base}_id` : `${base}_${pk.name}`;
}

export function suggestJunctionName(parentName: string, childName: string): string {
  return `${parentName}${childName}`;
}

/**
 * Create a relationship (FR-3.1–3.4). For 1:1 / 1:M it creates (or reuses) the
 * foreign-key field on the child with the referenced primary key's type. For
 * M:N it always materialises a junction entity carrying both keys (the project's
 * agreed rule). Self-references are allowed (FR-3.6).
 */
export function createRelationship(
  input: Model,
  params: CreateRelationshipInput,
): CreateRelationshipResult {
  const model = clone(input);
  const parent = findEntity(model, params.parentEntity);
  const child = findEntity(model, params.childEntity);
  if (!parent || !child) {
    throw new Error("createRelationship: parent or child entity not found");
  }

  const parentOptional = params.parentOptional ?? false;
  const childOptional = params.childOptional ?? true;
  const createdFieldIds: string[] = [];

  const rel: Relationship = {
    id: newId("relationship"),
    cardinality: params.cardinality,
    parentEntity: parent.id,
    childEntity: child.id,
    parentOptional,
    childOptional,
    foreignKeyFields: [],
  };
  if (params.label) rel.label = params.label;
  if (params.description) rel.description = params.description;

  if (params.cardinality === "many-to-many") {
    const junctionName = params.junctionName ?? suggestJunctionName(parent.name, child.name);
    const junction = newEntity(junctionName, midpoint(parent.position, child.position), {
      junction: true,
    });
    const parentPks = primaryKeyFields(parent);
    const childPks = primaryKeyFields(child);
    const usedNames = new Set<string>();
    const addJunctionFk = (fromName: string, pk: Field | undefined) => {
      let name = suggestForeignKeyName(fromName, pk);
      while (usedNames.has(name)) name = `${name}_2`;
      usedNames.add(name);
      const field = newField(name, pk?.type ?? "uuid", {
        ...(pk ? copyTypeSpec(pk) : {}),
        nullable: false,
        primaryKey: true,
        unique: false,
      });
      junction.fields.push(field);
    };
    if (parentPks.length) parentPks.forEach((pk) => addJunctionFk(parent.name, pk));
    else addJunctionFk(parent.name, undefined);
    if (childPks.length) childPks.forEach((pk) => addJunctionFk(child.name, pk));
    else addJunctionFk(child.name, undefined);

    model.entities.push(junction);
    rel.junctionEntity = junction.id;
    model.relationships.push(rel);
    return {
      model,
      relationshipId: rel.id,
      createdFieldIds: junction.fields.map((f) => f.id),
      junctionEntityId: junction.id,
    };
  }

  // one-to-one / one-to-many: FK on the child adopts the parent PK type.
  const parentPks = primaryKeyFields(parent);
  const unique = params.cardinality === "one-to-one";

  if (params.existingForeignKeyFieldId) {
    const existing = findField(child, params.existingForeignKeyFieldId);
    if (existing) {
      if (parentPks[0]) applyType(existing, parentPks[0]);
      existing.unique = unique || existing.unique;
      rel.foreignKeyFields.push(existing.id);
    }
  } else {
    const pks = parentPks.length ? parentPks : [undefined];
    pks.forEach((pk) => {
      const name =
        params.foreignKeyFieldName && pks.length === 1
          ? params.foreignKeyFieldName
          : suggestForeignKeyName(parent.name, pk);
      const field = newField(name, pk?.type ?? "uuid", {
        ...(pk ? copyTypeSpec(pk) : {}),
        nullable: parentOptional,
        primaryKey: false,
        unique,
      });
      child.fields.push(field);
      rel.foreignKeyFields.push(field.id);
      createdFieldIds.push(field.id);
    });
  }

  model.relationships.push(rel);
  return { model, relationshipId: rel.id, createdFieldIds };
}

export interface DeleteEntityResult {
  model: Model;
  removedRelationshipIds: string[];
  removedEntityIds: string[];
}

/**
 * Delete an entity and everything structurally dependent on it (FR-2.7): any
 * relationship touching it, and the junction entities of removed many-to-many
 * relationships. (Cross-model link warnings arrive with FR-6 in Phase 3.)
 */
export function deleteEntity(input: Model, entityId: string): DeleteEntityResult {
  const model = clone(input);
  const removedEntityIds = new Set<string>([entityId]);
  const removedRelationshipIds: string[] = [];

  const keptRelationships: Relationship[] = [];
  for (const rel of model.relationships) {
    const touches =
      rel.parentEntity === entityId ||
      rel.childEntity === entityId ||
      rel.junctionEntity === entityId;
    if (touches) {
      removedRelationshipIds.push(rel.id);
      if (rel.junctionEntity) removedEntityIds.add(rel.junctionEntity);
    } else {
      keptRelationships.push(rel);
    }
  }

  model.relationships = keptRelationships;
  model.entities = model.entities.filter((e) => !removedEntityIds.has(e.id));

  return {
    model,
    removedRelationshipIds,
    removedEntityIds: [...removedEntityIds],
  };
}
