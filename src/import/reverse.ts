// Reverse-engineering: parse a .sql file into a Model (the inverse of the DDL
// export in ../export). Handles CREATE TABLE with column definitions, table-level
// PRIMARY KEY / UNIQUE / FOREIGN KEY constraints, inline column REFERENCES, and
// standalone ALTER TABLE ... ADD FOREIGN KEY statements. SQL types are mapped
// back to the fixed DaMod type set (FR-2.3); anything unknown becomes `text` with
// a warning. The result is always a Physical model.

import {
  type Field,
  type Model,
  type Relationship,
  newEntity,
  newField,
  newModel,
} from "../model/model";
import type { DataTypeKind } from "../model/dataTypes";
import { newId } from "../lib/ids";

export interface ReverseResult {
  model: Model;
  warnings: string[];
}

// ---- lexical helpers --------------------------------------------------------

/** Strip `--` line comments and `/* *​/` block comments (outside string literals). */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Split SQL into statements on top-level `;` (respecting quotes and parens). */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Split a string on top-level occurrences of `sep` (respecting quotes/parens). */
function splitTopLevel(s: string, sep = ","): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === sep && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Remove surrounding quotes (", `, []) and the schema qualifier from a name. */
function unquote(raw: string): string {
  let s = raw.trim();
  // Drop a schema/catalog qualifier: keep the last dotted segment.
  const parts = splitTopLevel(s, ".");
  s = parts[parts.length - 1].trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    return s.slice(1, -1).replace(/""/g, '"').replace(/``/g, "`");
  }
  if (s.startsWith("[") && s.endsWith("]")) return s.slice(1, -1);
  return s;
}

/** Match the identifier list inside `(...)` and return the unquoted names. */
function parenNames(s: string): string[] {
  const m = s.match(/\(([\s\S]*)\)/);
  if (!m) return [];
  return splitTopLevel(m[1]).map(unquote).filter(Boolean);
}

// ---- type mapping (SQL -> DaMod) --------------------------------------------

interface TypeSpec {
  type: DataTypeKind;
  length?: number;
  precision?: number;
  scale?: number;
}

/** Map a SQL type string (any supported dialect) back to the fixed type set. */
export function mapSqlType(raw: string): { spec: TypeSpec; warning?: string } {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const num = (re: RegExp) => t.match(re);

  let m: RegExpMatchArray | null;
  if ((m = num(/^(?:varchar|character varying|nvarchar|varchar2|char varying)\s*\(\s*(\d+)/))) {
    return { spec: { type: "string", length: Number(m[1]) } };
  }
  if ((m = num(/^(?:char|character|nchar|bpchar)\s*\(\s*(\d+)/))) {
    return { spec: { type: "string", length: Number(m[1]) } };
  }
  if (/^(?:varchar|character varying|nvarchar|char|character|string)$/.test(t)) {
    // Bare string-ish type with no length → text is the safe choice.
    return { spec: { type: t === "string" ? "text" : "string", length: t === "string" ? undefined : 255 } };
  }
  if (/^(?:text|clob|ntext|longtext|mediumtext|tinytext)$/.test(t)) {
    return { spec: { type: "text" } };
  }
  if ((m = num(/^(?:numeric|decimal|number|dec)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/))) {
    return { spec: { type: "decimal", precision: Number(m[1]), scale: Number(m[2]) } };
  }
  if ((m = num(/^(?:numeric|decimal|number|dec)\s*\(\s*(\d+)\s*\)/))) {
    // Precision only → scale 0, which is an integer-like number. Keep as decimal.
    return { spec: { type: "decimal", precision: Number(m[1]), scale: 0 } };
  }
  if (/^(?:numeric|decimal|number|dec|money)$/.test(t)) {
    return { spec: { type: "decimal", precision: 12, scale: 2 } };
  }
  if (/^(?:bigint|int8|bigserial|serial8)$/.test(t)) return { spec: { type: "bigint" } };
  if (/^(?:smallint|int2|int4|integer|int|serial|serial4|mediumint|tinyint)$/.test(t)) {
    return { spec: { type: "integer" } };
  }
  if (/^(?:boolean|bool|bit)$/.test(t)) return { spec: { type: "boolean" } };
  if (/^date$/.test(t)) return { spec: { type: "date" } };
  if (/^(?:timestamp|timestamptz|datetime|datetime2|timestamp_tz|timestamp_ntz|timestamp_ltz)\b/.test(t) ||
      /^timestamp(\s*\(\d+\))?(\s+with(out)?\s+time\s+zone)?$/.test(t)) {
    return { spec: { type: "timestamp" } };
  }
  if (/^time\b/.test(t)) {
    return { spec: { type: "string", length: 32 }, warning: `time type “${raw.trim()}” mapped to string(32)` };
  }
  if (/^uuid$/.test(t) || /^uniqueidentifier$/.test(t)) return { spec: { type: "uuid" } };
  if (/^(?:json|jsonb|variant|object|array|super)$/.test(t)) return { spec: { type: "json" } };
  if (/^(?:double precision|double|real|float\d*|float)$/.test(t)) {
    return { spec: { type: "decimal", precision: 20, scale: 6 }, warning: `float type “${raw.trim()}” mapped to decimal(20,6)` };
  }
  if (/^(?:bytea|blob|binary|varbinary)$/.test(t)) {
    return { spec: { type: "text" }, warning: `binary type “${raw.trim()}” mapped to text` };
  }
  return { spec: { type: "text" }, warning: `unknown type “${raw.trim()}” mapped to text` };
}

// ---- parsing ----------------------------------------------------------------

interface ParsedFk {
  childTable: string;
  childCols: string[];
  parentTable: string;
  parentCols: string[];
}

interface ParsedTable {
  name: string;
  fields: Field[];
  pkCols: string[];
}

const CONSTRAINT_START =
  /^(?:constraint\s+\S+\s+)?(primary\s+key|unique|foreign\s+key|check|exclude)\b/i;

/** Parse one CREATE TABLE statement. Collects FK constraints into `fks`. */
function parseCreateTable(
  stmt: string,
  fks: ParsedFk[],
  warnings: string[],
): ParsedTable | null {
  const head = stmt.match(/create\s+(?:global\s+|local\s+|temporary\s+|temp\s+)*table\s+(?:if\s+not\s+exists\s+)?([\s\S]+?)\s*\(/i);
  if (!head) return null;
  const name = unquote(head[1]);
  const open = stmt.indexOf("(", head.index! + head[0].length - 1);
  if (open < 0) return null;
  // Find the matching close paren for the table body.
  let depth = 0;
  let close = -1;
  let quote: string | null = null;
  for (let i = open; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;
  const body = stmt.slice(open + 1, close);

  const fields: Field[] = [];
  const pkCols: string[] = [];
  const uniqueCols = new Set<string>();

  for (const item of splitTopLevel(body)) {
    if (!item) continue;
    if (CONSTRAINT_START.test(item)) {
      if (/^(?:constraint\s+\S+\s+)?primary\s+key/i.test(item)) {
        parenNames(item).forEach((c) => pkCols.push(c));
      } else if (/^(?:constraint\s+\S+\s+)?unique/i.test(item)) {
        parenNames(item).forEach((c) => uniqueCols.add(c));
      } else if (/^(?:constraint\s+\S+\s+)?foreign\s+key/i.test(item)) {
        const fk = parseFkClause(item, name);
        if (fk) fks.push(fk);
      }
      // CHECK / EXCLUDE are ignored (no model representation).
      continue;
    }
    // Column definition: first token is the name.
    const colMatch = item.match(/^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[A-Za-z_][\w$]*)\s+([\s\S]+)$/);
    if (!colMatch) {
      warnings.push(`Skipped unparseable item in ${name}: ${item.slice(0, 40)}`);
      continue;
    }
    const colName = unquote(colMatch[1]);
    let rest = colMatch[2].trim();

    // Leading type: a word (possibly multi-word) with an optional (...) parameter.
    const typeMatch = rest.match(/^([A-Za-z_][\w]*(?:\s+(?:precision|varying|with(?:out)?\s+time\s+zone|time\s+zone))*)\s*(\([^)]*\))?/i);
    const typeRaw = typeMatch ? `${typeMatch[1]}${typeMatch[2] ?? ""}` : rest;
    const { spec, warning } = mapSqlType(typeRaw);
    if (warning) warnings.push(`${name}.${colName}: ${warning}`);
    rest = typeMatch ? rest.slice(typeMatch[0].length) : "";

    const field = newField(colName, spec.type, {
      nullable: true,
      length: spec.length,
      precision: spec.precision,
      scale: spec.scale,
    });
    if (/\bnot\s+null\b/i.test(rest)) field.nullable = false;
    if (/\bprimary\s+key\b/i.test(rest)) { pkCols.push(colName); }
    if (/\bunique\b/i.test(rest)) uniqueCols.add(colName);
    const def = rest.match(/\bdefault\s+(.+?)(?=\s+(?:not\s+null|primary\s+key|unique|references|check|generated|collate)\b|$)/i);
    if (def) field.default = def[1].trim();
    // Inline column REFERENCES -> a foreign key.
    const refs = rest.match(/\breferences\s+("(?:[^"]|"")*"|`[^`]*`|[\w.$]+)\s*(\([^)]*\))?/i);
    if (refs) {
      const parentCols = refs[2] ? parenNames(refs[2]) : [];
      fks.push({ childTable: name, childCols: [colName], parentTable: unquote(refs[1]), parentCols });
    }
    fields.push(field);
  }

  // Apply collected PK / UNIQUE flags.
  const pkSet = new Set(pkCols);
  for (const f of fields) {
    if (pkSet.has(f.name)) { f.primaryKey = true; f.nullable = false; }
    if (uniqueCols.has(f.name) && !f.primaryKey) f.unique = true;
  }
  return { name, fields, pkCols };
}

/** Parse a `FOREIGN KEY (cols) REFERENCES parent (cols)` clause. */
function parseFkClause(clause: string, childTable: string): ParsedFk | null {
  const m = clause.match(
    /foreign\s+key\s*(\([^)]*\))\s*references\s+("(?:[^"]|"")*"|`[^`]*`|[\w.$]+)\s*(\([^)]*\))?/i,
  );
  if (!m) return null;
  return {
    childTable,
    childCols: parenNames(m[1]),
    parentTable: unquote(m[2]),
    parentCols: m[3] ? parenNames(m[3]) : [],
  };
}

/** Parse `ALTER TABLE child ADD [CONSTRAINT x] FOREIGN KEY (...) REFERENCES ...`. */
function parseAlterFk(stmt: string): ParsedFk | null {
  const head = stmt.match(/alter\s+table\s+(?:only\s+)?("(?:[^"]|"")*"|`[^`]*`|[\w.$]+)/i);
  if (!head) return null;
  if (!/add\s+(?:constraint\s+\S+\s+)?foreign\s+key/i.test(stmt)) return null;
  return parseFkClause(stmt, unquote(head[1]));
}

/**
 * Parse SQL DDL into a Physical model. `modelName` names the result. Tables that
 * cannot be resolved as FK endpoints are reported in `warnings`.
 */
export function parseDdl(sql: string, modelName: string, now: string): ReverseResult {
  const warnings: string[] = [];
  const clean = stripComments(sql);
  const statements = splitStatements(clean);

  const fks: ParsedFk[] = [];
  const tables: ParsedTable[] = [];
  for (const stmt of statements) {
    if (/^\s*create\s+(?:global\s+|local\s+|temporary\s+|temp\s+)*table\b/i.test(stmt)) {
      const t = parseCreateTable(stmt, fks, warnings);
      if (t) tables.push(t);
    } else if (/^\s*alter\s+table\b/i.test(stmt)) {
      const fk = parseAlterFk(stmt);
      if (fk) fks.push(fk);
    }
    // Other statements (CREATE VIEW/INDEX/SEQUENCE/SCHEMA, INSERT, etc.) are ignored.
  }

  const model = newModel(modelName, now, "Physical");

  // Lay entities out on a grid; map name -> entity for FK wiring.
  const byName = new Map<string, { id: string; fields: Field[] }>();
  tables.forEach((t, i) => {
    const entity = newEntity(t.name, {
      x: 80 + (i % 4) * 300,
      y: 80 + Math.floor(i / 4) * 240,
    });
    entity.fields = t.fields;
    model.entities.push(entity);
    byName.set(t.name.toLowerCase(), { id: entity.id, fields: t.fields });
  });

  const relationships: Relationship[] = [];
  for (const fk of fks) {
    const child = byName.get(fk.childTable.toLowerCase());
    const parent = byName.get(fk.parentTable.toLowerCase());
    if (!child || !parent) {
      warnings.push(
        `Foreign key ${fk.childTable}(${fk.childCols.join(", ")}) → ${fk.parentTable} references an unknown table; skipped`,
      );
      continue;
    }
    const fieldByName = new Map(child.fields.map((f) => [f.name.toLowerCase(), f]));
    const fkFields = fk.childCols
      .map((c) => fieldByName.get(c.toLowerCase()))
      .filter((f): f is Field => !!f);
    if (fkFields.length === 0) {
      warnings.push(`Foreign key on ${fk.childTable} names no known column; skipped`);
      continue;
    }
    const childPkNames = new Set(child.fields.filter((f) => f.primaryKey).map((f) => f.name));
    const fkIsChildPk =
      fkFields.length > 0 &&
      fkFields.length === childPkNames.size &&
      fkFields.every((f) => childPkNames.has(f.name));
    const fkNullable = fkFields.some((f) => f.nullable);
    relationships.push({
      id: newId("relationship"),
      cardinality: fkIsChildPk ? "one-to-one" : "one-to-many",
      identifying: fkIsChildPk,
      parentEntity: parent.id,
      childEntity: child.id,
      parentOptional: fkNullable,
      childOptional: true,
      foreignKeyFields: fkFields.map((f) => f.id),
    });
  }
  model.relationships = relationships;

  if (tables.length === 0) warnings.push("No CREATE TABLE statements found.");
  return { model, warnings };
}
