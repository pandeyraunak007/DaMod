// Deterministic DDL generation (FR-8). Emits a CREATE TABLE per entity with
// NOT NULL / DEFAULT / PRIMARY KEY / UNIQUE, a FOREIGN KEY per relationship,
// tables ordered so referenced tables come first, circular refs as ALTER TABLE
// at the end (FR-8.3), and COMMENTs (FR-8.4). The same model always produces a
// byte-identical file (FR-8.6). Parameterised by dialect.

import { type Entity, type Model, findEntity, primaryKeyFields } from "../model/model";
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
      if (cols.length) fks.push({ child, parent, cols });
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
        .join(", ")})`,
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
    .join(", ")}) REFERENCES ${parentRef} (${fk.cols.map((c) => d.quote(c.pk)).join(", ")});`;
}

/** Export a single model as DDL. */
export function exportModelDDL(model: Model, d: Dialect): string {
  const fks = foreignKeys(model);
  const { order, deferred } = orderTables(model.entities, fks);
  const deferredSet = new Set(deferred);
  const inlineFks = fks.filter((fk) => !deferredSet.has(fk));

  const blocks: string[] = [`-- DaMod DDL export: ${model.name} (${d.label})`];
  const tables = order.map((e) => tableDDL(d, e, inlineFks, undefined));
  blocks.push(tables.join("\n\n"));

  const comments = order.flatMap((e) => commentStatements(d, e));
  if (comments.length) blocks.push(comments.join("\n"));

  if (deferred.length) blocks.push(deferred.map((fk) => alterFk(d, fk)).join("\n"));

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
    const tables = order.map((e) => tableDDL(d, e, inlineFks, model.name));
    const parts = [`-- schema: ${model.name}`, tables.join("\n\n")];
    const comments = order.flatMap((e) => commentStatements(d, e, model.name));
    if (comments.length) parts.push(comments.join("\n"));
    if (deferred.length) parts.push(deferred.map((fk) => alterFk(d, fk, model.name)).join("\n"));
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
