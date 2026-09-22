// Deterministic DDL generation (FR-8). Emits a CREATE TABLE per entity with
// NOT NULL / DEFAULT / PRIMARY KEY / UNIQUE, a FOREIGN KEY per relationship,
// tables ordered so referenced tables come first, circular refs as ALTER TABLE
// at the end (FR-8.3), and COMMENTs (FR-8.4). The same model always produces a
// byte-identical file (FR-8.6). Parameterised by dialect.

import {
  type Entity,
  type Model,
  type RiAction,
  findEntity,
  primaryKeyFields,
} from "../model/model";
import type { Dialect } from "./dialects";
import type { Link } from "../links/links";

interface FkCol {
  fk: string; // child field name
  pk: string; // parent field name
}
interface Fk {
  child: Entity;
  parent: Entity;
  cols: FkCol[];
  onDelete?: RiAction;
  onUpdate?: RiAction;
}

/** Referential-integrity clause for a foreign key (Postgres only; other engines
 *  treat FKs as informational). */
function riClause(d: Dialect, fk: Fk): string {
  if (d.id !== "postgres") return "";
  const word = (a?: RiAction) => (!a || a === "no action" ? null : a.toUpperCase());
  const parts: string[] = [];
  const del = word(fk.onDelete);
  const upd = word(fk.onUpdate);
  if (del) parts.push(` ON DELETE ${del}`);
  if (upd) parts.push(` ON UPDATE ${upd}`);
  return parts.join("");
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function fieldName(entity: Entity, id: string): string | undefined {
  return entity.fields.find((f) => f.id === id)?.name;
}

/** Foreign keys implied by a model's relationships. */
export function foreignKeys(model: Model): Fk[] {
  const fks: Fk[] = [];
  for (const rel of model.relationships) {
    const parent = findEntity(model, rel.parentEntity);
    if (!parent) continue;
    if (rel.cardinality !== "many-to-many") {
      const child = findEntity(model, rel.childEntity);
      if (!child) continue;
      const parentPks = primaryKeyFields(parent);
      const cols: FkCol[] = [];
      rel.foreignKeyFields.forEach((fkId, i) => {
        const pk = parentPks[i] ?? parentPks[0];
        const fkName = fieldName(child, fkId);
        if (pk && fkName) cols.push({ fk: fkName, pk: pk.name });
      });
      if (cols.length) {
        fks.push({ child, parent, cols, onDelete: rel.onDelete, onUpdate: rel.onUpdate });
      }
    } else if (rel.junctionEntity) {
      const junction = findEntity(model, rel.junctionEntity);
      const child = findEntity(model, rel.childEntity);
      if (!junction || !child) continue;
      const parentPks = primaryKeyFields(parent);
      const childPks = primaryKeyFields(child);
      const junctionPks = junction.fields.filter((f) => f.primaryKey);
      const parentCols: FkCol[] = parentPks
        .map((pk, i) => ({ fk: junctionPks[i]?.name, pk: pk.name }))
        .filter((c): c is FkCol => !!c.fk);
      const childCols: FkCol[] = childPks
        .map((pk, i) => ({ fk: junctionPks[parentPks.length + i]?.name, pk: pk.name }))
        .filter((c): c is FkCol => !!c.fk);
      if (parentCols.length) fks.push({ child: junction, parent, cols: parentCols });
      if (childCols.length) fks.push({ child: junction, parent: child, cols: childCols });
    }
  }
  return fks;
}

/**
 * Order entities so every referenced table is created before the table that
 * references it. Stable (by name) and deterministic; edges that would form a
 * cycle (including self-references) are returned as `deferred`.
 */
export function orderTables(entities: Entity[], fks: Fk[]): { order: Entity[]; deferred: Fk[] } {
  const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name));
  const deps = new Map<string, Set<string>>();
  for (const e of sorted) deps.set(e.id, new Set());
  for (const fk of fks) {
    if (fk.parent.id !== fk.child.id) deps.get(fk.child.id)!.add(fk.parent.id);
  }

  const order: Entity[] = [];
  const emitted = new Set<string>();
  while (order.length < sorted.length) {
    let next = sorted.find(
      (e) => !emitted.has(e.id) && [...deps.get(e.id)!].every((p) => emitted.has(p)),
    );
    if (!next) next = sorted.find((e) => !emitted.has(e.id))!; // break a cycle
    order.push(next);
    emitted.add(next.id);
  }

  const index = new Map(order.map((e, i) => [e.id, i]));
  const deferred = fks.filter(
    (fk) => fk.parent.id === fk.child.id || index.get(fk.child.id)! < index.get(fk.parent.id)!,
  );
  return { order, deferred };
}

function tableRef(d: Dialect, name: string, schema?: string): string {
  return schema ? `${d.quote(schema)}.${d.quote(name)}` : d.quote(name);
}

function tableDDL(
  d: Dialect,
  entity: Entity,
  inlineFks: Fk[],
  schema: string | undefined,
): string {
  const q = d.quote;
  const ref = tableRef(d, entity.name, schema);
  const lines: string[] = [];
  for (const f of entity.fields) {
    let line = `  ${q(f.name)} ${d.type(f)}`;
    if (!f.nullable) line += " NOT NULL";
    if (f.default) line += ` DEFAULT ${f.default}`;
    if (d.commentStyle === "inline" && f.description) line += ` COMMENT ${sqlString(f.description)}`;
    lines.push(line);
  }
  const pks = primaryKeyFields(entity);
  if (pks.length) lines.push(`  PRIMARY KEY (${pks.map((p) => q(p.name)).join(", ")})`);
  for (const f of entity.fields) {
    if (f.unique && !f.primaryKey) lines.push(`  UNIQUE (${q(f.name)})`);
  }
  for (const fk of inlineFks.filter((x) => x.child.id === entity.id)) {
    const parentRef = tableRef(d, fk.parent.name, schema);
    lines.push(
      `  FOREIGN KEY (${fk.cols.map((c) => q(c.fk)).join(", ")}) REFERENCES ${parentRef} (${fk.cols
        .map((c) => q(c.pk))
        .join(", ")})${riClause(d, fk)}`,
    );
  }
  let ddl = `CREATE TABLE ${ref} (\n${lines.join(",\n")}\n)`;
  if (d.commentStyle === "inline" && entity.description) ddl += ` COMMENT ${sqlString(entity.description)}`;
  return ddl + ";";
}

function commentStatements(d: Dialect, entity: Entity, schema?: string): string[] {
  if (d.commentStyle !== "commentOn") return [];
  const ref = tableRef(d, entity.name, schema);
  const out: string[] = [];
  if (entity.description) out.push(`COMMENT ON TABLE ${ref} IS ${sqlString(entity.description)};`);
  for (const f of entity.fields) {
    if (f.description) {
      out.push(`COMMENT ON COLUMN ${ref}.${d.quote(f.name)} IS ${sqlString(f.description)};`);
    }
  }
  return out;
}

function alterFk(d: Dialect, fk: Fk, schema?: string): string {
  const childRef = tableRef(d, fk.child.name, schema);
  const parentRef = tableRef(d, fk.parent.name, schema);
  return `ALTER TABLE ${childRef} ADD FOREIGN KEY (${fk.cols
    .map((c) => d.quote(c.fk))
    .join(", ")}) REFERENCES ${parentRef} (${fk.cols
    .map((c) => d.quote(c.pk))
    .join(", ")})${riClause(d, fk)};`;
}

// ---- other database objects (dialect-aware) ---------------------------------

function sequenceDDL(
  d: Dialect,
  s: NonNullable<Model["sequences"]>[number],
  schema?: string,
): string {
  if (d.id === "databricks") {
    return `-- sequence ${s.name}: Databricks has no CREATE SEQUENCE; use GENERATED ALWAYS AS IDENTITY on the column.`;
  }
  return `CREATE SEQUENCE ${tableRef(d, s.name, schema)} START WITH ${s.start ?? 1} INCREMENT BY ${s.increment ?? 1};`;
}

function indexDDL(
  d: Dialect,
  idx: NonNullable<Model["indexes"]>[number],
  model: Model,
  schema?: string,
): string | null {
  const entity = findEntity(model, idx.entity);
  if (!entity) return null;
  const cols = idx.fields
    .map((fid) => entity.fields.find((f) => f.id === fid))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => d.quote(f.name));
  if (cols.length === 0) return null;
  const tbl = tableRef(d, entity.name, schema);
  const list = cols.join(", ");
  if (d.id === "postgres") {
    return `CREATE ${idx.unique ? "UNIQUE " : ""}INDEX ${d.quote(idx.name)} ON ${tbl} (${list});`;
  }
  if (d.id === "snowflake") {
    return `ALTER TABLE ${tbl} CLUSTER BY (${list}); -- Snowflake has no indexes; using a clustering key`;
  }
  return `-- Databricks: OPTIMIZE ${tbl} ZORDER BY (${list});`;
}

function viewDDL(d: Dialect, v: NonNullable<Model["views"]>[number], schema?: string): string {
  const ref = tableRef(d, v.name, schema);
  const body = v.definition.trim().replace(/;+\s*$/, "");
  if (v.materialized) {
    if (d.id === "databricks") {
      return `-- Databricks materialized views are limited; created as a regular view\nCREATE OR REPLACE VIEW ${ref} AS\n${body};`;
    }
    return `CREATE MATERIALIZED VIEW ${ref} AS\n${body};`;
  }
  return `CREATE OR REPLACE VIEW ${ref} AS\n${body};`;
}

function rawObjectDDL(d: Dialect, o: NonNullable<Model["rawObjects"]>[number]): string | null {
  if (o.dialect !== d.id || !o.sql.trim()) return null;
  return `-- ${o.name}${o.kind ? ` (${o.kind})` : ""}\n${o.sql.trim()}`;
}

/** Sequences, indexes, views and raw objects for a model, as DDL blocks. */
function objectBlocks(model: Model, d: Dialect, schema?: string): { pre: string[]; post: string[] } {
  const pre: string[] = [];
  const post: string[] = [];
  const seqs = (model.sequences ?? []).map((s) => sequenceDDL(d, s, schema));
  if (seqs.length) pre.push(seqs.join("\n"));
  const idxs = (model.indexes ?? [])
    .map((i) => indexDDL(d, i, model, schema))
    .filter((x): x is string => !!x);
  if (idxs.length) post.push(idxs.join("\n"));
  const views = (model.views ?? []).map((v) => viewDDL(d, v, schema));
  if (views.length) post.push(views.join("\n\n"));
  const raws = (model.rawObjects ?? [])
    .map((o) => rawObjectDDL(d, o))
    .filter((x): x is string => !!x);
  if (raws.length) post.push(raws.join("\n\n"));
  return { pre, post };
}

/** Export a single model as DDL. */
export function exportModelDDL(model: Model, d: Dialect): string {
  const fks = foreignKeys(model);
  const { order, deferred } = orderTables(model.entities, fks);
  const deferredSet = new Set(deferred);
  const inlineFks = fks.filter((fk) => !deferredSet.has(fk));
  const { pre, post } = objectBlocks(model, d);

  const blocks: string[] = [`-- DaMod DDL export: ${model.name} (${d.label})`];
  blocks.push(...pre); // sequences first (defaults may reference them)
  const tables = order.map((e) => tableDDL(d, e, inlineFks, undefined));
  blocks.push(tables.join("\n\n"));

  const comments = order.flatMap((e) => commentStatements(d, e));
  if (comments.length) blocks.push(comments.join("\n"));

  if (deferred.length) blocks.push(deferred.map((fk) => alterFk(d, fk)).join("\n"));
  blocks.push(...post); // indexes, views, raw objects

  return blocks.join("\n\n") + "\n";
}

/**
 * Export a whole workspace: a schema per model, tables inside their schema, and
 * cross-model `references` links as foreign keys at the end (FR-8.5).
 */
export function exportWorkspaceDDL(
  models: { id: string; name: string; model: Model }[],
  links: Link[],
  d: Dialect,
): string {
  const sortedModels = [...models].sort((a, b) => a.name.localeCompare(b.name));
  const blocks: string[] = [`-- DaMod workspace DDL export (${d.label})`];

  blocks.push(
    sortedModels.map((m) => `CREATE SCHEMA IF NOT EXISTS ${d.quote(m.name)};`).join("\n"),
  );

  for (const { model } of sortedModels) {
    const fks = foreignKeys(model);
    const { order, deferred } = orderTables(model.entities, fks);
    const deferredSet = new Set(deferred);
    const inlineFks = fks.filter((fk) => !deferredSet.has(fk));
    const { pre, post } = objectBlocks(model, d, model.name);
    const tables = order.map((e) => tableDDL(d, e, inlineFks, model.name));
    const parts = [`-- schema: ${model.name}`, ...pre, tables.join("\n\n")];
    const comments = order.flatMap((e) => commentStatements(d, e, model.name));
    if (comments.length) parts.push(comments.join("\n"));
    if (deferred.length) parts.push(deferred.map((fk) => alterFk(d, fk, model.name)).join("\n"));
    parts.push(...post);
    blocks.push(parts.join("\n\n"));
  }

  // Cross-model references links as foreign keys at the end.
  const byId = new Map(models.map((m) => [m.id, m.model]));
  const crossFks: string[] = [];
  const refLinks = links
    .filter((l) => l.type === "references")
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const l of refLinks) {
    const fromModel = byId.get(l.from.model);
    const toModel = byId.get(l.to.model);
    if (!fromModel || !toModel || !l.from.field) continue;
    const fromEntity = fromModel.entities.find((e) => e.id === l.from.entity);
    const toEntity = toModel.entities.find((e) => e.id === l.to.entity);
    if (!fromEntity || !toEntity) continue;
    const fromField = fieldName(fromEntity, l.from.field);
    const toPk = primaryKeyFields(toEntity)[0];
    if (!fromField || !toPk) continue;
    const childRef = `${d.quote(fromModel.name)}.${d.quote(fromEntity.name)}`;
    const parentRef = `${d.quote(toModel.name)}.${d.quote(toEntity.name)}`;
    crossFks.push(
      `ALTER TABLE ${childRef} ADD FOREIGN KEY (${d.quote(fromField)}) REFERENCES ${parentRef} (${d.quote(
        toPk.name,
      )});`,
    );
  }
  if (crossFks.length) blocks.push(["-- cross-model links", crossFks.join("\n")].join("\n"));

  return blocks.join("\n\n") + "\n";
}
