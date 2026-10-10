// Map canonical metadata into the existing `.model.json` representation (Phase 3).
// This is the single bridge from "discovered source" to "editable model": it
// reuses the model factories, the fixed type set, and the same FK→relationship
// logic as the SQL reverse-engineering parser — there is no second model engine.
//
// Pure and DB-free so it is fully unit-testable.

import {
  type Field,
  type Index,
  type Model,
  type Relationship,
  newEntity,
  newField,
  newModel,
} from "../model/model";
import type { DataTypeKind } from "../model/dataTypes";
import { newId } from "../lib/ids";
import type { CanonicalMetadata, CanonicalObject } from "./metadata";

export interface ToModelResult {
  model: Model;
  warnings: string[];
}

/** Build a Physical model from discovered metadata. */
export function metadataToModel(
  md: CanonicalMetadata,
  modelName: string,
  now: string,
): ToModelResult {
  const warnings: string[] = [];
  const model = newModel(modelName, now, "Physical");

  // Flatten objects, remembering their schema for FK resolution and layout.
  const flat: { schema: string; object: CanonicalObject }[] = [];
  for (const cat of md.catalogs) {
    for (const sch of cat.schemas) {
      for (const obj of sch.objects) flat.push({ schema: sch.name, object: obj });
    }
  }

  // Build entities. Resolve FK targets by "schema.name" first, then bare name.
  const byQualified = new Map<string, { id: string; fields: Field[] }>();
  const byName = new Map<string, { id: string; fields: Field[] }>();
  const indexes: Index[] = [];

  flat.forEach(({ schema, object }, i) => {
    const entity = newEntity(object.name, { x: 80 + (i % 4) * 300, y: 80 + Math.floor(i / 4) * 240 });
    if (object.kind === "view" || object.kind === "materialized-view") entity.tags = ["view"];
    if (object.comment) entity.description = object.comment;

    const pk = new Set(object.primaryKey ?? []);
    // A unique single-column index expresses column uniqueness on the model;
    // everything else becomes a model index for fidelity.
    const uniqueSingle = new Set(
      object.indexes.filter((ix) => ix.unique && ix.columns.length === 1).map((ix) => ix.columns[0]),
    );

    const fields: Field[] = [...object.columns]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((col) => {
        let type = col.normalizedType?.type as DataTypeKind | undefined;
        if (!type) {
          warnings.push(`${schema}.${object.name}.${col.name}: native type “${col.nativeType}” has no mapping; set to text`);
          type = "text";
        }
        return newField(col.name, type, {
          length: col.normalizedType?.length,
          precision: col.normalizedType?.precision,
          scale: col.normalizedType?.scale,
          nullable: pk.has(col.name) ? false : col.nullable,
          primaryKey: pk.has(col.name),
          unique: uniqueSingle.has(col.name) && !pk.has(col.name),
          default: col.default,
          description: col.comment,
        });
      });
    entity.fields = fields;
    model.entities.push(entity);

    const ref = { id: entity.id, fields };
    byQualified.set(`${schema}.${object.name}`.toLowerCase(), ref);
    byName.set(object.name.toLowerCase(), ref);

    // Carry non-unique / multi-column indexes onto the model.
    for (const ix of object.indexes) {
      if (ix.unique && ix.columns.length === 1) continue; // expressed as field.unique
      const fieldIds = ix.columns
        .map((c) => fields.find((f) => f.name.toLowerCase() === c.toLowerCase())?.id)
        .filter((x): x is string => !!x);
      if (fieldIds.length) {
        indexes.push({ id: newId("index"), name: ix.name, entity: entity.id, fields: fieldIds, unique: ix.unique });
      }
    }
  });

  // Build relationships from foreign keys (second pass, like reverse.ts).
  const relationships: Relationship[] = [];
  for (const { schema, object } of flat) {
    const child = byQualified.get(`${schema}.${object.name}`.toLowerCase());
    if (!child) continue;
    for (const fk of object.foreignKeys) {
      const parent =
        (fk.refSchema && byQualified.get(`${fk.refSchema}.${fk.refObject}`.toLowerCase())) ||
        byName.get(fk.refObject.toLowerCase());
      if (!parent) {
        warnings.push(`FK ${object.name}(${fk.columns.join(", ")}) → ${fk.refObject} targets an object not in the import; skipped`);
        continue;
      }
      const fkFields = fk.columns
        .map((c) => child.fields.find((f) => f.name.toLowerCase() === c.toLowerCase()))
        .filter((f): f is Field => !!f);
      if (fkFields.length === 0) {
        warnings.push(`FK on ${object.name} names no known column; skipped`);
        continue;
      }
      const childPk = new Set(child.fields.filter((f) => f.primaryKey).map((f) => f.name));
      const fkIsWholePk =
        fkFields.length === childPk.size && fkFields.every((f) => childPk.has(f.name));
      relationships.push({
        id: newId("relationship"),
        cardinality: fkIsWholePk ? "one-to-one" : "one-to-many",
        identifying: fkIsWholePk,
        parentEntity: parent.id,
        childEntity: child.id,
        parentOptional: fkFields.some((f) => f.nullable),
        childOptional: true,
        foreignKeyFields: fkFields.map((f) => f.id),
        onDelete: fk.onDelete as Relationship["onDelete"],
        onUpdate: fk.onUpdate as Relationship["onUpdate"],
      });
    }
  }
  model.relationships = relationships;
  if (indexes.length) model.indexes = indexes;

  if (model.entities.length === 0) warnings.push("No objects were discovered to import.");
  return { model, warnings };
}
