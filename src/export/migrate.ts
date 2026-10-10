// Forward-engineering: generate an ALTER migration that turns a baseline schema
// into the current model. The baseline is another model — typically one
// reverse-engineered from a live database's DDL (see ../import/reverse), so the
// pairing is: dump DB → RE as baseline → diff against the edited model → apply.
//
// Matching is by NAME (the SQL identifier), not by internal id, because a
// reverse-engineered baseline has different ids from the hand-built model. The
// ALTER syntax targets Postgres (the reference dialect); other dialects differ on
// ALTER COLUMN and are emitted best-effort with a note.

import { type Entity, type Field, type Model } from "../model/model";
import { formatType } from "../model/dataTypes";
import type { Dialect } from "./dialects";
import { type Fk, alterFk, dropTableSql, foreignKeys, tableDDL } from "./ddl";

export interface FieldChange {
  field: string;
  changes: string[]; // human-readable summary, e.g. "type decimal(12,2) → numeric..."
  statements: string[]; // the ALTER COLUMN statements
}

export interface EntityDiff {
  name: string;
  addedFields: Field[];
  removedFields: Field[];
  changedFields: FieldChange[];
}

export interface ModelDiff {
  addedEntities: Entity[];
  removedEntities: Entity[];
  changedEntities: EntityDiff[];
  addedFks: Fk[];
  removedFks: Fk[];
}

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.name.toLowerCase(), i]));
}

function typeString(f: Field): string {
  if (!f.type) return f.logicalType ?? "untyped";
  return formatType({ type: f.type, length: f.length, precision: f.precision, scale: f.scale });
}

/** A stable name-based signature for a foreign key (ignores internal ids). */
function fkSignature(fk: Fk): string {
  return `${fk.child.name}(${fk.cols.map((c) => c.fk).join(",")})->${fk.parent.name}(${fk.cols
    .map((c) => c.pk)
    .join(",")})`;
}

/** Diff a baseline model against the target (current) model, matched by name. */
export function diffModels(baseline: Model, target: Model): ModelDiff {
  const baseEntities = byName(baseline.entities);
  const targetEntities = byName(target.entities);

  const addedEntities = target.entities.filter((e) => !baseEntities.has(e.name.toLowerCase()));
  const removedEntities = baseline.entities.filter((e) => !targetEntities.has(e.name.toLowerCase()));

  const changedEntities: EntityDiff[] = [];
  for (const t of target.entities) {
    const b = baseEntities.get(t.name.toLowerCase());
    if (!b) continue;
    const baseFields = byName(b.fields);
    const targetFields = byName(t.fields);
    const addedFields = t.fields.filter((f) => !baseFields.has(f.name.toLowerCase()));
    const removedFields = b.fields.filter((f) => !targetFields.has(f.name.toLowerCase()));
    const changedFields: FieldChange[] = [];
    for (const tf of t.fields) {
      const bf = baseFields.get(tf.name.toLowerCase());
      if (!bf) continue;
      const change: FieldChange = { field: tf.name, changes: [], statements: [] };
      if (typeString(bf) !== typeString(tf)) {
        change.changes.push(`type ${typeString(bf)} → ${typeString(tf)}`);
      }
      if (bf.nullable !== tf.nullable) {
        change.changes.push(tf.nullable ? "now nullable" : "now NOT NULL");
      }
      if ((bf.default ?? "") !== (tf.default ?? "")) {
        change.changes.push(tf.default ? `default → ${tf.default}` : "default removed");
      }
      if (bf.primaryKey !== tf.primaryKey) {
        change.changes.push(tf.primaryKey ? "now primary key" : "no longer primary key");
      }
      if (bf.unique !== tf.unique) {
        change.changes.push(tf.unique ? "now unique" : "no longer unique");
      }
      if (change.changes.length) changedFields.push(change);
    }
    if (addedFields.length || removedFields.length || changedFields.length) {
      changedEntities.push({ name: t.name, addedFields, removedFields, changedFields });
    }
  }

  const baseFks = foreignKeys(baseline);
  const targetFks = foreignKeys(target);
  const baseSig = new Set(baseFks.map(fkSignature));
  const targetSig = new Set(targetFks.map(fkSignature));
  const addedFks = targetFks.filter((fk) => !baseSig.has(fkSignature(fk)));
  const removedFks = baseFks.filter((fk) => !targetSig.has(fkSignature(fk)));

  return { addedEntities, removedEntities, changedEntities, addedFks, removedFks };
}

/** A column definition fragment for ADD COLUMN (type + NOT NULL + DEFAULT). */
function columnSql(d: Dialect, f: Field): string {
  let s = `${d.quote(f.name)} ${d.type(f)}`;
  if (!f.nullable) s += " NOT NULL";
  if (f.default) s += ` DEFAULT ${f.default}`;
  return s;
}

/** True when the diff contains no changes at all. */
export function diffIsEmpty(diff: ModelDiff): boolean {
  return (
    diff.addedEntities.length === 0 &&
    diff.removedEntities.length === 0 &&
    diff.changedEntities.length === 0 &&
    diff.addedFks.length === 0 &&
    diff.removedFks.length === 0
  );
}

/** Render the diff as an ALTER-based migration script for the dialect. */
export function generateMigration(baseline: Model, target: Model, d: Dialect): string {
  const diff = diffModels(baseline, target);
  const q = d.quote;
  // Resolve a target field by entity+field name for rendering its new type.
  const findField = (entityName: string, fieldName: string): Field | undefined => {
    const e = target.entities.find((x) => x.name.toLowerCase() === entityName.toLowerCase());
    return e?.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
  };
  const blocks: string[] = [
    `-- DaMod migration: ${baseline.name} → ${target.name} (${d.label})`,
  ];
  if (d.id !== "postgres") {
    blocks.push(
      `-- Note: ALTER syntax targets Postgres; review for ${d.label} before running.`,
    );
  }
  if (diffIsEmpty(diff)) {
    blocks.push("-- No differences: the baseline already matches the model.");
    return blocks.join("\n\n") + "\n";
  }

  // New tables (without FKs; those are added afterwards once all tables exist).
  for (const e of diff.addedEntities) {
    blocks.push(tableDDL(d, e, [], undefined));
  }

  // Dropped tables.
  if (diff.removedEntities.length) {
    blocks.push(
      diff.removedEntities.map((e) => dropTableSql(d, e.name)).join("\n"),
    );
  }

  // Column-level changes on surviving tables.
  for (const ce of diff.changedEntities) {
    const ref = q(ce.name);
    const stmts: string[] = [];
    for (const f of ce.addedFields) {
      stmts.push(`ALTER TABLE ${ref} ADD COLUMN ${columnSql(d, f)};`);
    }
    for (const f of ce.removedFields) {
      stmts.push(`ALTER TABLE ${ref} DROP COLUMN ${q(f.name)};`);
    }
    for (const cf of ce.changedFields) {
      const tf = findField(ce.name, cf.field);
      stmts.push(`-- ${ce.name}.${cf.field}: ${cf.changes.join("; ")}`);
      if (tf) {
        if (cf.changes.some((c) => c.startsWith("type "))) {
          stmts.push(`ALTER TABLE ${ref} ALTER COLUMN ${q(cf.field)} TYPE ${d.type(tf)};`);
        }
        if (cf.changes.includes("now NOT NULL")) {
          stmts.push(`ALTER TABLE ${ref} ALTER COLUMN ${q(cf.field)} SET NOT NULL;`);
        }
        if (cf.changes.includes("now nullable")) {
          stmts.push(`ALTER TABLE ${ref} ALTER COLUMN ${q(cf.field)} DROP NOT NULL;`);
        }
        const defChange = cf.changes.find((c) => c.startsWith("default"));
        if (defChange === "default removed") {
          stmts.push(`ALTER TABLE ${ref} ALTER COLUMN ${q(cf.field)} DROP DEFAULT;`);
        } else if (defChange && tf.default) {
          stmts.push(`ALTER TABLE ${ref} ALTER COLUMN ${q(cf.field)} SET DEFAULT ${tf.default};`);
        }
        if (cf.changes.some((c) => c.includes("unique"))) {
          stmts.push(
            cf.changes.includes("now unique")
              ? `ALTER TABLE ${ref} ADD UNIQUE (${q(cf.field)});`
              : `-- drop the UNIQUE constraint on ${ce.name}.${cf.field} by name (unnamed here)`,
          );
        }
        if (cf.changes.some((c) => c.includes("primary key"))) {
          stmts.push(`-- primary-key change on ${ce.name}.${cf.field} needs a manual constraint edit`);
        }
      }
    }
    if (stmts.length) blocks.push(stmts.join("\n"));
  }

  // Foreign keys.
  if (diff.addedFks.length) {
    blocks.push(["-- added foreign keys", ...diff.addedFks.map((fk) => alterFk(d, fk))].join("\n"));
  }
  if (diff.removedFks.length) {
    blocks.push(
      [
        "-- removed foreign keys (drop by constraint name on the target database)",
        ...diff.removedFks.map(
          (fk) => `-- DROP: ${fk.child.name}(${fk.cols.map((c) => c.fk).join(", ")}) → ${fk.parent.name}`,
        ),
      ].join("\n"),
    );
  }

  return blocks.join("\n\n") + "\n";
}
