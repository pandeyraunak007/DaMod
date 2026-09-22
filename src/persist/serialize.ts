// Canonical, deterministic serialization of model files (FR-5.5). The same model
// always produces byte-identical JSON: keys in a fixed order, arrays kept in their
// stored order, optional keys omitted when empty (never null or []), 2-space
// indent. We build plain objects with keys inserted in canonical order and let
// JSON.stringify preserve that order.
//
// The in-memory `junction` flag on entities is derived from relationships, so it
// is NOT written to disk — the file format has no such key.

import type { Entity, Field, Model, Relationship } from "../model/model";
import { paramShape } from "../model/dataTypes";

// A field is serialized with whatever type information it carries, regardless of
// the model's level. This preserves the reversibility of level changes (FR-11.6)
// across save/reload: a physical type hidden by lowering to Logical is kept on
// disk, so raising the level back restores it.
function serializeField(f: Field): Record<string, unknown> {
  const out: Record<string, unknown> = { id: f.id, name: f.name };
  if (f.type) {
    out.type = f.type;
    const shape = paramShape(f.type);
    if (shape === "length") out.length = f.length;
    if (shape === "decimal") {
      out.precision = f.precision;
      out.scale = f.scale;
    }
  }
  if (f.logicalType) out.logicalType = f.logicalType;
  if (f.logicalName) out.logicalName = f.logicalName;
  out.nullable = f.nullable;
  if (f.primaryKey) out.primaryKey = true;
  if (f.unique) out.unique = true;
  if (f.default != null && f.default !== "") out.default = f.default;
  if (f.description) out.description = f.description;
  return out;
}

function serializeEntity(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = { id: e.id, name: e.name };
  if (e.description) out.description = e.description;
  if (e.tags && e.tags.length) out.tags = [...e.tags];
  out.position = { x: e.position.x, y: e.position.y };
  out.fields = e.fields.map(serializeField);
  return out;
}

function serializeRelationship(r: Relationship): Record<string, unknown> {
  const out: Record<string, unknown> = { id: r.id };
  if (r.label) out.label = r.label;
  if (r.description) out.description = r.description;
  out.cardinality = r.cardinality;
  out.parentEntity = r.parentEntity;
  out.childEntity = r.childEntity;
  out.parentOptional = r.parentOptional;
  out.childOptional = r.childOptional;
  if (r.foreignKeyFields.length) out.foreignKeyFields = [...r.foreignKeyFields];
  if (r.junctionEntity) out.junctionEntity = r.junctionEntity;
  return out;
}

/** Build the canonical plain object for a model (used by serializeModel). */
export function modelToPlain(model: Model): Record<string, unknown> {
  const out: Record<string, unknown> = {
    formatVersion: model.formatVersion,
    id: model.id,
    name: model.name,
  };
  if (model.description) out.description = model.description;
  out.level = model.level;
  if (model.derivedFrom) out.derivedFrom = model.derivedFrom;
  out.createdAt = model.createdAt;
  out.updatedAt = model.updatedAt;
  out.entities = model.entities.map(serializeEntity);
  out.relationships = model.relationships.map(serializeRelationship);
  return out;
}

/** Deterministic JSON text for a model file, with a trailing newline. */
export function serializeModel(model: Model): string {
  return JSON.stringify(modelToPlain(model), null, 2) + "\n";
}
