// Canonical, deterministic serialization of model files (FR-5.5). The same model
// always produces byte-identical JSON: keys in a fixed order, arrays kept in their
// stored order, optional keys omitted when empty (never null or []), 2-space
// indent. We build plain objects with keys inserted in canonical order and let
// JSON.stringify preserve that order.
//
// The in-memory `junction` flag on entities is derived from relationships, so it
// is NOT written to disk — the file format has no such key.

import type {
  Entity,
  Field,
  Index,
  Model,
  RawObject,
  Relationship,
  Sequence,
  Udp,
  View,
} from "../model/model";
import { paramShape } from "../model/dataTypes";

function udpsOut(out: Record<string, unknown>, note: string | undefined, udps: Udp[] | undefined) {
  if (note) out.note = note;
  if (udps && udps.length) out.udps = udps.map((u) => ({ name: u.name, value: u.value }));
}

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
  udpsOut(out, f.note, f.udps);
  return out;
}

function serializeEntity(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = { id: e.id, name: e.name };
  if (e.description) out.description = e.description;
  if (e.tags && e.tags.length) out.tags = [...e.tags];
  if (e.stereotype) out.stereotype = e.stereotype;
  out.position = { x: e.position.x, y: e.position.y };
  out.fields = e.fields.map(serializeField);
  udpsOut(out, e.note, e.udps);
  return out;
}

function serializeRelationship(r: Relationship): Record<string, unknown> {
  const out: Record<string, unknown> = { id: r.id };
  if (r.label) out.label = r.label;
  if (r.description) out.description = r.description;
  out.cardinality = r.cardinality;
  if (r.identifying) out.identifying = true;
  if (r.subtype) out.subtype = true;
  out.parentEntity = r.parentEntity;
  out.childEntity = r.childEntity;
  out.parentOptional = r.parentOptional;
  out.childOptional = r.childOptional;
  if (r.foreignKeyFields.length) out.foreignKeyFields = [...r.foreignKeyFields];
  if (r.junctionEntity) out.junctionEntity = r.junctionEntity;
  if (r.childVerbPhrase) out.childVerbPhrase = r.childVerbPhrase;
  if (r.onDelete && r.onDelete !== "no action") out.onDelete = r.onDelete;
  if (r.onUpdate && r.onUpdate !== "no action") out.onUpdate = r.onUpdate;
  udpsOut(out, r.note, r.udps);
  return out;
}

function serializeView(v: View): Record<string, unknown> {
  const out: Record<string, unknown> = { id: v.id, name: v.name, definition: v.definition };
  if (v.materialized) out.materialized = true;
  if (v.sources && v.sources.length) out.sources = [...v.sources];
  out.position = { x: v.position.x, y: v.position.y };
  return out;
}

function serializeIndex(i: Index): Record<string, unknown> {
  const out: Record<string, unknown> = { id: i.id, name: i.name, entity: i.entity };
  if (i.unique) out.unique = true;
  out.fields = [...i.fields];
  return out;
}

function serializeSequence(s: Sequence): Record<string, unknown> {
  const out: Record<string, unknown> = { id: s.id, name: s.name };
  if (s.start !== undefined) out.start = s.start;
  if (s.increment !== undefined) out.increment = s.increment;
  return out;
}

function serializeRawObject(o: RawObject): Record<string, unknown> {
  const out: Record<string, unknown> = { id: o.id, name: o.name, dialect: o.dialect };
  if (o.kind) out.kind = o.kind;
  out.sql = o.sql;
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
  if (model.notation && model.notation !== "IE") out.notation = model.notation;
  if (model.derivedFrom) out.derivedFrom = model.derivedFrom;
  out.createdAt = model.createdAt;
  out.updatedAt = model.updatedAt;
  out.entities = model.entities.map(serializeEntity);
  out.relationships = model.relationships.map(serializeRelationship);
  if (model.views && model.views.length) out.views = model.views.map(serializeView);
  if (model.indexes && model.indexes.length) out.indexes = model.indexes.map(serializeIndex);
  if (model.sequences && model.sequences.length) {
    out.sequences = model.sequences.map(serializeSequence);
  }
  if (model.rawObjects && model.rawObjects.length) {
    out.rawObjects = model.rawObjects.map(serializeRawObject);
  }
  return out;
}

/** Deterministic JSON text for a model file, with a trailing newline. */
export function serializeModel(model: Model): string {
  return JSON.stringify(modelToPlain(model), null, 2) + "\n";
}
