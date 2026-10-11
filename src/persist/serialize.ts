// Canonical, deterministic serialization of model files (FR-5.5). The same model
// always produces byte-identical JSON: keys in a fixed order, arrays kept in their
// stored order, optional keys omitted when empty (never null or []), 2-space
// indent. We build plain objects with keys inserted in canonical order and let
// JSON.stringify preserve that order.
//
// The in-memory `junction` flag on entities is derived from relationships, so it
// is NOT written to disk — the file format has no such key.

import type {
  Domain,
  Entity,
  Field,
  Index,
  Model,
  RawObject,
  Relationship,
  SchemaObj,
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
// Discovery provenance (ObjectSource), fixed key order, omit-empty. Shared by
// entity + field serialization.
function sourceToPlain(s: NonNullable<Field["source"]>): Record<string, unknown> | null {
  const src: Record<string, unknown> = {};
  if (s.system) src.system = s.system;
  if (s.schema) src.schema = s.schema;
  if (s.nativeId) src.nativeId = s.nativeId;
  if (s.nativeType) src.nativeType = s.nativeType;
  if (s.product) src.product = s.product;
  if (s.provenance) src.provenance = s.provenance;
  if (s.confidence !== undefined) src.confidence = s.confidence;
  if (s.apiPath) src.apiPath = s.apiPath;
  if (s.apiVersion) src.apiVersion = s.apiVersion;
  return Object.keys(src).length ? src : null;
}

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
  if (f.domainId) out.domainId = f.domainId;
  if (f.role) out.role = f.role;
  if (f.description) out.description = f.description;
  if (f.source) {
    const src = sourceToPlain(f.source);
    if (src) out.source = src;
  }
  udpsOut(out, f.note, f.udps);
  return out;
}

function serializeDomain(d: Domain): Record<string, unknown> {
  const out: Record<string, unknown> = { id: d.id, name: d.name, type: d.type };
  const shape = paramShape(d.type);
  if (shape === "length") out.length = d.length;
  if (shape === "decimal") {
    out.precision = d.precision;
    out.scale = d.scale;
  }
  if (d.logicalType) out.logicalType = d.logicalType;
  if (d.default != null && d.default !== "") out.default = d.default;
  if (d.description) out.description = d.description;
  return out;
}

function serializeEntity(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = { id: e.id, name: e.name };
  if (e.logicalName) out.logicalName = e.logicalName;
  if (e.description) out.description = e.description;
  if (e.tags && e.tags.length) out.tags = [...e.tags];
  if (e.stereotype) out.stereotype = e.stereotype;
  if (e.schema) out.schema = e.schema;
  if (e.tableKind && e.tableKind !== "standard") out.tableKind = e.tableKind;
  out.position = { x: e.position.x, y: e.position.y };
  out.fields = e.fields.map(serializeField);
  if (e.checks && e.checks.length) {
    out.checks = e.checks.map((c) => ({ id: c.id, name: c.name, expression: c.expression }));
  }
  if (e.source) {
    const src = sourceToPlain(e.source);
    if (src) out.source = src;
  }
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
  if (r.enforced !== undefined) out.enforced = r.enforced;
  udpsOut(out, r.note, r.udps);
  return out;
}

function serializeView(v: View): Record<string, unknown> {
  const out: Record<string, unknown> = { id: v.id, name: v.name, definition: v.definition };
  if (v.materialized) out.materialized = true;
  if (v.withNoData) out.withNoData = true;
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

function serializeSchema(s: SchemaObj): Record<string, unknown> {
  const out: Record<string, unknown> = { id: s.id, name: s.name };
  if (s.owner) out.owner = s.owner;
  if (s.comment) out.comment = s.comment;
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
  if (model.dialect) out.dialect = model.dialect;
  if (model.notation && model.notation !== "IE") out.notation = model.notation;
  if (model.derivedFrom) out.derivedFrom = model.derivedFrom;
  out.createdAt = model.createdAt;
  out.updatedAt = model.updatedAt;
  out.entities = model.entities.map(serializeEntity);
  out.relationships = model.relationships.map(serializeRelationship);
  if (model.schemas && model.schemas.length) out.schemas = model.schemas.map(serializeSchema);
  if (model.subjectAreas && model.subjectAreas.length) {
    out.subjectAreas = model.subjectAreas.map((a) => {
      const sa: Record<string, unknown> = { id: a.id, name: a.name };
      if (a.description) sa.description = a.description;
      if (a.product) sa.product = a.product;
      sa.entities = [...a.entities];
      return sa;
    });
  }
  if (model.views && model.views.length) out.views = model.views.map(serializeView);
  if (model.indexes && model.indexes.length) out.indexes = model.indexes.map(serializeIndex);
  if (model.sequences && model.sequences.length) {
    out.sequences = model.sequences.map(serializeSequence);
  }
  if (model.rawObjects && model.rawObjects.length) {
    out.rawObjects = model.rawObjects.map(serializeRawObject);
  }
  if (model.domains && model.domains.length) {
    out.domains = model.domains.map(serializeDomain);
  }
  return out;
}

/** Deterministic JSON text for a model file, with a trailing newline. */
export function serializeModel(model: Model): string {
  return JSON.stringify(modelToPlain(model), null, 2) + "\n";
}
