// Schema refresh & drift (Phase 4, §3.7). Compares a previous source snapshot
// against a fresh discovery to find what changed *in the source*, then applies
// the changes the user approves onto their working model — preserving unrelated
// manual edits.
//
// Both sides are projected to models via `metadataToModel` and diffed with the
// existing `diffModels` (reuse, §3.7). Because both projections are pure views of
// the source, their differences are PURELY source drift — never the user's edits.
// Matching is by NAME (the SQL identifier). A removed+added pair with identical
// columns is surfaced as a *possible rename* for review, never auto-applied.

import type { Model, Relationship } from "../model/model";
import { newId } from "../lib/ids";
import { type ModelDiff, diffModels } from "../export/migrate";
import type { Fk } from "../export/ddl";
import type { CanonicalMetadata } from "./metadata";
import { metadataToModel } from "./toModel";

export interface DriftChange {
  key: string; // stable id used by the review UI and applyDrift's accepted set
  kind: "add-entity" | "remove-entity" | "add-field" | "remove-field" | "change-field" | "add-fk" | "remove-fk" | "possible-rename";
  label: string;
}

export interface DriftResult {
  changes: DriftChange[];
  diff: ModelDiff;
  /** The fresh source projected to a model — the source of truth for new structure. */
  nextModel: Model;
}

function fkSig(fk: Fk): string {
  return `${fk.child.name}(${fk.cols.map((c) => c.fk).join(",")})->${fk.parent.name}`;
}

/** Compute source drift between the previous snapshot and a fresh discovery. */
export function computeDrift(
  prev: CanonicalMetadata,
  next: CanonicalMetadata,
  now: string,
): DriftResult {
  const prevModel = metadataToModel(prev, "prev", now).model;
  const nextModel = metadataToModel(next, "next", now).model;
  const diff = diffModels(prevModel, nextModel);

  const changes: DriftChange[] = [];

  // Possible renames: a removed and an added entity with the same column-name set.
  const colSet = (m: Model, name: string) => {
    const e = m.entities.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return e ? e.fields.map((f) => f.name.toLowerCase()).sort().join(",") : "";
  };
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();
  for (const removed of diff.removedEntities) {
    const sig = colSet(prevModel, removed.name);
    // Require ≥2 shared columns before guessing a rename — a lone `id` column is
    // far too weak evidence (§3.7: don't claim renames on insufficient evidence).
    const match = diff.addedEntities.find(
      (a) => !renamedTo.has(a.name) && sig.includes(",") && colSet(nextModel, a.name) === sig,
    );
    if (match) {
      renamedFrom.add(removed.name);
      renamedTo.add(match.name);
      changes.push({
        key: `rename:${removed.name}->${match.name}`,
        kind: "possible-rename",
        label: `possible rename: ${removed.name} → ${match.name} (review; not applied automatically)`,
      });
    }
  }

  for (const e of diff.addedEntities) {
    if (renamedTo.has(e.name)) continue;
    changes.push({ key: `E+:${e.name}`, kind: "add-entity", label: `+ table ${e.name}` });
  }
  for (const e of diff.removedEntities) {
    if (renamedFrom.has(e.name)) continue;
    changes.push({ key: `E-:${e.name}`, kind: "remove-entity", label: `− table ${e.name}` });
  }
  for (const ce of diff.changedEntities) {
    for (const f of ce.addedFields) {
      changes.push({ key: `F+:${ce.name}.${f.name}`, kind: "add-field", label: `+ ${ce.name}.${f.name}` });
    }
    for (const f of ce.removedFields) {
      changes.push({ key: `F-:${ce.name}.${f.name}`, kind: "remove-field", label: `− ${ce.name}.${f.name}` });
    }
    for (const cf of ce.changedFields) {
      changes.push({
        key: `F~:${ce.name}.${cf.field}`,
        kind: "change-field",
        label: `~ ${ce.name}.${cf.field}: ${cf.changes.join("; ")}`,
      });
    }
  }
  for (const fk of diff.addedFks) {
    changes.push({ key: `K+:${fkSig(fk)}`, kind: "add-fk", label: `+ FK ${fkSig(fk)}` });
  }
  for (const fk of diff.removedFks) {
    changes.push({ key: `K-:${fkSig(fk)}`, kind: "remove-fk", label: `− FK ${fkSig(fk)}` });
  }

  return { changes, diff, nextModel };
}

function entityByName(model: Model, name: string) {
  return model.entities.find((e) => e.name.toLowerCase() === name.toLowerCase());
}

/**
 * Apply the accepted drift changes onto the user's model, preserving everything
 * not named in an accepted change. Returns a new Model (does not mutate input).
 */
export function applyDrift(
  userModel: Model,
  nextModel: Model,
  diff: ModelDiff,
  accepted: Set<string>,
): Model {
  const model: Model = structuredClone(userModel);
  const has = (key: string) => accepted.has(key);

  // Removed entities (and their relationships).
  for (const e of diff.removedEntities) {
    if (!has(`E-:${e.name}`)) continue;
    const target = entityByName(model, e.name);
    if (!target) continue;
    model.entities = model.entities.filter((x) => x.id !== target.id);
    model.relationships = model.relationships.filter(
      (r) => r.parentEntity !== target.id && r.childEntity !== target.id && r.junctionEntity !== target.id,
    );
  }

  // Added entities (cloned from the fresh projection, keeping their fresh ids).
  for (const e of diff.addedEntities) {
    if (!has(`E+:${e.name}`)) continue;
    if (entityByName(model, e.name)) continue;
    model.entities.push(structuredClone(e));
  }

  // Field-level changes on surviving entities.
  for (const ce of diff.changedEntities) {
    const userEntity = entityByName(model, ce.name);
    const nextEntity = entityByName(nextModel, ce.name);
    if (!userEntity) continue;
    for (const f of ce.addedFields) {
      if (!has(`F+:${ce.name}.${f.name}`)) continue;
      if (!userEntity.fields.some((x) => x.name.toLowerCase() === f.name.toLowerCase())) {
        userEntity.fields.push({ ...structuredClone(f), id: newId("field") });
      }
    }
    for (const f of ce.removedFields) {
      if (!has(`F-:${ce.name}.${f.name}`)) continue;
      const gone = userEntity.fields.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
      if (gone) {
        userEntity.fields = userEntity.fields.filter((x) => x.id !== gone.id);
        for (const r of model.relationships) {
          r.foreignKeyFields = r.foreignKeyFields.filter((id) => id !== gone.id);
        }
      }
    }
    for (const cf of ce.changedFields) {
      if (!has(`F~:${ce.name}.${cf.field}`)) continue;
      const target = userEntity.fields.find((x) => x.name.toLowerCase() === cf.field.toLowerCase());
      const source = nextEntity?.fields.find((x) => x.name.toLowerCase() === cf.field.toLowerCase());
      if (target && source) {
        target.type = source.type;
        target.length = source.length;
        target.precision = source.precision;
        target.scale = source.scale;
        target.nullable = source.nullable;
        target.default = source.default;
        target.primaryKey = source.primaryKey;
        target.unique = source.unique;
      }
    }
  }

  // Removed foreign keys.
  for (const fk of diff.removedFks) {
    if (!has(`K-:${fkSig(fk)}`)) continue;
    const child = entityByName(model, fk.child.name);
    const parent = entityByName(model, fk.parent.name);
    if (!child || !parent) continue;
    const cols = fk.cols.map((c) => c.fk.toLowerCase());
    model.relationships = model.relationships.filter((r) => {
      if (r.parentEntity !== parent.id || r.childEntity !== child.id) return true;
      const names = r.foreignKeyFields
        .map((id) => child.fields.find((f) => f.id === id)?.name.toLowerCase())
        .filter(Boolean)
        .sort();
      return names.join(",") !== [...cols].sort().join(","); // keep if not this FK
    });
  }

  // Added foreign keys (resolved by name onto the user model's ids).
  for (const fk of diff.addedFks) {
    if (!has(`K+:${fkSig(fk)}`)) continue;
    const child = entityByName(model, fk.child.name);
    const parent = entityByName(model, fk.parent.name);
    if (!child || !parent) continue;
    const fkFields = fk.cols
      .map((c) => child.fields.find((f) => f.name.toLowerCase() === c.fk.toLowerCase()))
      .filter((f): f is NonNullable<typeof f> => !!f);
    if (fkFields.length === 0) continue;
    const childPk = new Set(child.fields.filter((f) => f.primaryKey).map((f) => f.name));
    const whole = fkFields.length === childPk.size && fkFields.every((f) => childPk.has(f.name));
    const rel: Relationship = {
      id: newId("relationship"),
      cardinality: whole ? "one-to-one" : "one-to-many",
      identifying: whole,
      parentEntity: parent.id,
      childEntity: child.id,
      parentOptional: fkFields.some((f) => f.nullable),
      childOptional: true,
      foreignKeyFields: fkFields.map((f) => f.id),
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    };
    model.relationships.push(rel);
  }

  return model;
}
