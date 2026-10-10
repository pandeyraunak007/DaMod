// Idempotent re-discovery (Req 21 Phase 2, §6/§11). `computeDrift` tells you WHAT
// changed between two snapshots; this merges a fresh discovery INTO an existing model
// in place: objects are matched by their stable source identifier (ObjectSource),
// so repeated imports update rather than duplicate, and manual modeling decisions
// (logical names, descriptions, canvas layout, stereotypes, notes, tags) are
// preserved — fresh discovery is the source of truth only for physical STRUCTURE.
//
// Pure + DB-free: fully unit-testable.

import type { Entity, Field, Model, Relationship } from "../model/model";

export interface ReconcileResult {
  model: Model;
  added: string[]; // entity names newly discovered
  updated: string[]; // entity names matched + refreshed in place
  removed: string[]; // entity names previously present, no longer discovered
}

/** The stable match key for an entity: its source nativeId, else schema.name, else name. */
function entityKey(e: Entity): string {
  const s = e.source;
  if (s?.nativeId) return s.nativeId.toLowerCase();
  if (s?.schema) return `${s.schema}.${e.name}`.toLowerCase();
  return e.name.toLowerCase();
}

function mergeTags(manual: string[] | undefined, fresh: string[] | undefined): string[] | undefined {
  const out = [...(manual ?? [])];
  for (const t of fresh ?? []) if (!out.includes(t)) out.push(t);
  return out.length ? out : undefined;
}

function relKey(r: Pick<Relationship, "parentEntity" | "childEntity" | "foreignKeyFields">): string {
  return `${r.parentEntity}>${r.childEntity}:${[...r.foreignKeyFields].sort().join(",")}`;
}

/**
 * Merge `fresh` (a just-discovered model) into `existing`, preserving stable IDs and
 * manual edits. `removed` entities are reported but NOT deleted — removal of modeled
 * structure requires review (§11), so the caller decides.
 */
export function reconcileDiscoveredModel(existing: Model, fresh: Model): ReconcileResult {
  const existingByKey = new Map(existing.entities.map((e) => [entityKey(e), e]));
  const entityIdMap = new Map<string, string>(); // fresh entity id -> reconciled id
  const fieldIdMap = new Map<string, string>(); // fresh field id -> reconciled id
  const added: string[] = [];
  const updated: string[] = [];

  const entities: Entity[] = fresh.entities.map((fe) => {
    const match = existingByKey.get(entityKey(fe));
    if (!match) {
      added.push(fe.name);
      entityIdMap.set(fe.id, fe.id);
      for (const f of fe.fields) fieldIdMap.set(f.id, f.id);
      return fe;
    }
    updated.push(fe.name);
    entityIdMap.set(fe.id, match.id);

    // Fields: structure from fresh; keep existing field id + manual logical name /
    // description by matching on column name.
    const existingFieldByName = new Map(match.fields.map((f) => [f.name.toLowerCase(), f]));
    const fields: Field[] = fe.fields.map((ff) => {
      const ef = existingFieldByName.get(ff.name.toLowerCase());
      if (!ef) {
        fieldIdMap.set(ff.id, ff.id);
        return ff;
      }
      fieldIdMap.set(ff.id, ef.id);
      return { ...ff, id: ef.id, logicalName: ef.logicalName ?? ff.logicalName, description: ef.description ?? ff.description };
    });

    const merged: Entity = {
      ...fe, // fresh structure + latest source provenance
      id: match.id,
      position: match.position, // manual layout
      logicalName: match.logicalName ?? fe.logicalName,
      description: match.description ?? fe.description,
      note: match.note ?? fe.note,
      udps: match.udps ?? fe.udps,
      stereotype: match.stereotype ?? fe.stereotype,
      tags: mergeTags(match.tags, fe.tags),
      fields,
    };
    return merged;
  });

  // Entities no longer discovered are KEPT (removal is a structural change that
  // needs review, §11) and merely reported. Their stable ids are preserved, so any
  // edges that still touch them stay valid.
  const freshKeys = new Set(fresh.entities.map(entityKey));
  const removedEntities = existing.entities.filter((e) => !freshKeys.has(entityKey(e)));
  const removed = removedEntities.map((e) => e.name);
  const removedIds = new Set(removedEntities.map((e) => e.id));

  // Relationships: remap fresh endpoints onto reconciled ids, preserving the existing
  // relationship id + manual verb phrases/label/note when the same edge already
  // existed; then keep existing edges that touch a kept-but-undiscovered entity.
  const existingRelByKey = new Map(existing.relationships.map((r) => [relKey(r), r]));
  const relationships: Relationship[] = fresh.relationships.map((fr) => {
    const remapped: Relationship = {
      ...fr,
      parentEntity: entityIdMap.get(fr.parentEntity) ?? fr.parentEntity,
      childEntity: entityIdMap.get(fr.childEntity) ?? fr.childEntity,
      foreignKeyFields: fr.foreignKeyFields.map((f) => fieldIdMap.get(f) ?? f),
      junctionEntity: fr.junctionEntity ? entityIdMap.get(fr.junctionEntity) ?? fr.junctionEntity : undefined,
    };
    const prev = existingRelByKey.get(relKey(remapped));
    if (!prev) return remapped;
    return {
      ...remapped,
      id: prev.id,
      label: prev.label ?? remapped.label,
      childVerbPhrase: prev.childVerbPhrase ?? remapped.childVerbPhrase,
      note: prev.note ?? remapped.note,
    };
  });
  for (const r of existing.relationships) {
    if (removedIds.has(r.parentEntity) || removedIds.has(r.childEntity) || (r.junctionEntity && removedIds.has(r.junctionEntity))) {
      relationships.push(r); // edge to a kept-undiscovered entity
    }
  }

  // Indexes reference entity/field ids — remap fresh ones; keep existing indexes on
  // kept-undiscovered entities.
  const indexes = [
    ...(fresh.indexes ?? []).map((ix) => ({
      ...ix,
      entity: entityIdMap.get(ix.entity) ?? ix.entity,
      fields: ix.fields.map((f) => fieldIdMap.get(f) ?? f),
    })),
    ...(existing.indexes ?? []).filter((ix) => removedIds.has(ix.entity)),
  ];

  const model: Model = {
    ...existing, // keep model id/name/level/notation/dialect/createdAt + manual domains
    entities: [...entities, ...removedEntities],
    relationships,
    indexes: indexes.length ? indexes : undefined,
    views: fresh.views,
    sequences: fresh.sequences,
    schemas: fresh.schemas ?? existing.schemas,
  };
  return { model, added, updated, removed };
}
