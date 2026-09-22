// Pure model transforms. Each takes a Model and returns a *new* Model (via
// structuredClone) plus any metadata the UI needs. Keeping these pure makes them
// unit-testable and makes the store's history a simple stack of snapshots.
//
// All of this is level-aware (FR-11): foreign keys copy the physical type, the
// generic logical type, or nothing at all, depending on the model's level.

import {
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
import { copyTypeSpec } from "./dataTypes";
import {
  type LogicalTypeKind,
  type ModelLevel,
  type PhysicalMapping,
  isConceptual,
  logicalToPhysical,
  physicalToLogical,
  usesLogicalTypes,
  usesPhysicalTypes,
} from "./levels";
import { toSnakeCase } from "./identifiers";
import { newId } from "../lib/ids";

function clone(model: Model): Model {
  return structuredClone(model);
}

/** A field whose type was realigned to the key it references. */
export interface TypeChange {
  entityId: string;
  entityName: string;
  fieldId: string;
  fieldName: string;
  from: string;
  to: string;
}

/** Human label for whatever type a field currently carries. */
function typeLabel(field: Field, level: ModelLevel): string {
  if (usesPhysicalTypes(level) && field.type) {
    if (field.type === "string") return `string(${field.length})`;
    if (field.type === "decimal") return `decimal(${field.precision},${field.scale})`;
    return field.type;
  }
  if (usesLogicalTypes(level) && field.logicalType) return field.logicalType;
  return field.type ?? field.logicalType ?? "untyped";
}

/** The type-carrying props a foreign key should adopt from a primary key, per level. */
function fkTypeProps(pk: Field | undefined, level: ModelLevel): Partial<Field> {
  if (isConceptual(level)) return {};
  const props: Partial<Field> = {};
  if (usesPhysicalTypes(level)) {
    if (pk?.type) {
      const spec = copyTypeSpec({ type: pk.type, length: pk.length, precision: pk.precision, scale: pk.scale });
      props.type = spec.type;
      props.length = spec.length;
      props.precision = spec.precision;
      props.scale = spec.scale;
    } else {
      props.type = "uuid";
    }
  }
  if (usesLogicalTypes(level)) {
    props.logicalType =
      pk?.logicalType ?? (pk?.type ? physicalToLogical(pk.type) : "Identifier");
  }
  return props;
}

function applyTypeProps(target: Field, props: Partial<Field>): void {
  // Clear then set, so realigning never leaves stale params.
  target.length = undefined;
  target.precision = undefined;
  target.scale = undefined;
  if ("type" in props) target.type = props.type;
  if ("length" in props) target.length = props.length;
  if ("precision" in props) target.precision = props.precision;
  if ("scale" in props) target.scale = props.scale;
  if ("logicalType" in props) target.logicalType = props.logicalType;
}

function fieldMatchesProps(field: Field, props: Partial<Field>): boolean {
  return (
    field.type === props.type &&
    field.length === props.length &&
    field.precision === props.precision &&
    field.scale === props.scale &&
    (props.logicalType === undefined || field.logicalType === props.logicalType)
  );
}

/**
 * Realign every foreign-key field to the type of the primary key it references
 * (FR-3.7), following the model's level. Junction id fields are mapped
 * positionally (parent keys first, then child keys). Mutates `model`, returns
 * the changed fields for the visible notice.
 */
export function reconcileForeignKeyTypes(model: Model): TypeChange[] {
  const changes: TypeChange[] = [];
  if (isConceptual(model.level)) return changes;

  const record = (entity: { id: string; name: string }, field: Field, before: string) => {
    changes.push({
      entityId: entity.id,
      entityName: entity.name,
      fieldId: field.id,
      fieldName: field.name,
      from: before,
      to: typeLabel(field, model.level),
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
        if (!pk || !fk) return;
        const props = fkTypeProps(pk, model.level);
        if (fieldMatchesProps(fk, props)) return;
        const before = typeLabel(fk, model.level);
        applyTypeProps(fk, props);
        record(child, fk, before);
      });
    } else if (rel.junctionEntity) {
      const junction = findEntity(model, rel.junctionEntity);
      if (!junction || !child) continue;
      const ordered = [...primaryKeyFields(parent), ...primaryKeyFields(child)];
      const junctionPks = junction.fields.filter((f) => f.primaryKey);
      ordered.forEach((pk, i) => {
        const jf = junctionPks[i];
        if (!jf) return;
        const props = fkTypeProps(pk, model.level);
        if (fieldMatchesProps(jf, props)) return;
        const before = typeLabel(jf, model.level);
        applyTypeProps(jf, props);
        record(junction, jf, before);
      });
    }
  }

  return changes;
}

export interface CreateRelationshipInput {
  cardinality: Relationship["cardinality"];
  parentEntity: string;
  childEntity: string;
  parentOptional?: boolean;
  childOptional?: boolean;
  label?: string;
  description?: string;
  foreignKeyFieldName?: string;
  existingForeignKeyFieldId?: string;
  junctionName?: string;
  /** Identifying relationship: the FK becomes part of the child's primary key. */
  identifying?: boolean;
  /** Subtype/category: the child shares the parent (supertype) primary key. */
  subtype?: boolean;
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

export function suggestForeignKeyName(parentName: string, pk: Field | undefined): string {
  const base = toSnakeCase(parentName);
  if (!pk) return `${base}_id`;
  return pk.name === "id" ? `${base}_id` : `${base}_${pk.name}`;
}

export function suggestJunctionName(parentName: string, childName: string): string {
  return `${parentName}${childName}`;
}

/**
 * Create a relationship (FR-3.1–3.4), level-aware. Conceptual models draw the
 * line only (no typed foreign keys, an empty junction). Logical/Physical models
 * create foreign-key fields carrying the appropriate type. M:N always
 * materialises a junction entity. Self-references are allowed (FR-3.6).
 */
export function createRelationship(
  input: Model,
  params: CreateRelationshipInput,
): CreateRelationshipResult {
  const model = clone(input);
  const level = model.level;
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
    if (!isConceptual(level)) {
      const parentPks = primaryKeyFields(parent);
      const childPks = primaryKeyFields(child);
      const usedNames = new Set<string>();
      const addJunctionFk = (fromName: string, pk: Field | undefined) => {
        let name = suggestForeignKeyName(fromName, pk);
        while (usedNames.has(name)) name = `${name}_2`;
        usedNames.add(name);
        junction.fields.push(
          newField(name, undefined, {
            ...fkTypeProps(pk, level),
            nullable: false,
            primaryKey: true,
            unique: false,
          }),
        );
      };
      (parentPks.length ? parentPks : [undefined]).forEach((pk) => addJunctionFk(parent.name, pk));
      (childPks.length ? childPks : [undefined]).forEach((pk) => addJunctionFk(child.name, pk));
    }
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

  // one-to-one / one-to-many
  // Identifying (or subtype) relationships put the foreign key into the child's
  // primary key; non-identifying keep it as a plain (optionally unique) column.
  const identifying = params.subtype ? true : params.identifying ?? false;
  if (params.subtype) rel.subtype = true;
  if (identifying) rel.identifying = true;

  if (!isConceptual(level)) {
    const parentPks = primaryKeyFields(parent);
    const unique = params.cardinality === "one-to-one" && !identifying;
    if (params.existingForeignKeyFieldId) {
      const existing = findField(child, params.existingForeignKeyFieldId);
      if (existing) {
        applyTypeProps(existing, fkTypeProps(parentPks[0], level));
        if (identifying) {
          existing.primaryKey = true;
          existing.nullable = false;
        }
        existing.unique = unique || existing.unique;
        rel.foreignKeyFields.push(existing.id);
      }
    } else {
      const pks = parentPks.length ? parentPks : [undefined];
      pks.forEach((pk) => {
        // A subtype's key mirrors the supertype key name (e.g. id); otherwise use
        // the offered or generated foreign-key name.
        const name = params.subtype
          ? pk?.name ?? suggestForeignKeyName(parent.name, pk)
          : params.foreignKeyFieldName && pks.length === 1
            ? params.foreignKeyFieldName
            : suggestForeignKeyName(parent.name, pk);
        const field = newField(name, undefined, {
          ...fkTypeProps(pk, level),
          nullable: identifying ? false : parentOptional,
          primaryKey: identifying,
          unique,
        });
        child.fields.push(field);
        rel.foreignKeyFields.push(field.id);
        createdFieldIds.push(field.id);
      });
    }
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

  return { model, removedRelationshipIds, removedEntityIds: [...removedEntityIds] };
}

export interface AmbiguousField {
  entityId: string;
  entityName: string;
  fieldId: string;
  fieldName: string;
  logicalType: LogicalTypeKind;
  chosen: PhysicalMapping;
}

export interface RelevelResult {
  model: Model;
  ambiguous: AmbiguousField[];
}

/**
 * Change a model's level (FR-11.6). Raising synthesises physical types from
 * generic ones (flagging ambiguous choices for the UI to confirm); lowering
 * keeps physical detail stored but hidden, so the change is reversible.
 */
export function relevelModel(input: Model, to: ModelLevel): RelevelResult {
  const model = clone(input);
  model.level = to;
  const ambiguous: AmbiguousField[] = [];
  const wantPhysical = usesPhysicalTypes(to);
  const wantLogical = usesLogicalTypes(to);

  for (const e of model.entities) {
    for (const f of e.fields) {
      if (wantPhysical && !f.type) {
        const logical: LogicalTypeKind = f.logicalType ?? "Text";
        const mapping = logicalToPhysical(logical);
        f.type = mapping.type;
        f.length = mapping.length;
        f.precision = mapping.precision;
        f.scale = mapping.scale;
        if (mapping.ambiguous || !f.logicalType) {
          ambiguous.push({
            entityId: e.id,
            entityName: e.name,
            fieldId: f.id,
            fieldName: f.name,
            logicalType: logical,
            chosen: mapping,
          });
        }
      }
      if (wantLogical && !f.logicalType) {
        f.logicalType = f.type ? physicalToLogical(f.type) : "Text";
      }
      // Lowering keeps both representations (reversible) — nothing to strip.
    }
  }

  return { model, ambiguous };
}
