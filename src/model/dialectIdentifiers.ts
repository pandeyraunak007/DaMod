// Per-dialect identifier constraints (Naming Standards hardening, gap G8). DaMod's
// base `validateIdentifier` enforces only the Postgres unquoted-identifier shape; this
// module adds the DIALECT-specific rules an erwin physical model needs: reserved-word
// detection and maximum identifier length. Pure + advisory — surfaced as validation
// warnings (reserved words are quoted on export; over-length is the target DB's limit),
// never blocking edits.

import type { DbDialect } from "./model";

// Classic/safe maximum unquoted identifier length per dialect. Oracle's 30 is the
// conservative pre-12.2 default (12.2+ allows 128); flagging early is the safer choice.
export const IDENTIFIER_MAX: Record<DbDialect, number> = {
  postgres: 63,
  oracle: 30,
  mysql: 64,
  sqlserver: 128,
  snowflake: 255,
  databricks: 255,
  bigquery: 300,
};

// A curated ANSI/common SQL reserved-word set shared by all dialects. Not exhaustive —
// it covers the keywords real models actually collide with. Case-insensitive.
const ANSI_RESERVED = [
  "select", "from", "where", "table", "order", "group", "by", "user", "column", "index",
  "view", "primary", "key", "foreign", "constraint", "default", "check", "unique", "null",
  "not", "and", "or", "join", "inner", "outer", "left", "right", "full", "on", "as",
  "distinct", "insert", "update", "delete", "create", "drop", "alter", "grant", "revoke",
  "values", "into", "set", "case", "when", "then", "else", "end", "union", "all", "any",
  "desc", "asc", "limit", "offset", "having", "exists", "in", "like", "between", "is",
  "count", "sum", "avg", "min", "max", "date", "time", "timestamp", "interval", "cast",
  "current_date", "current_time", "current_timestamp", "with", "cross", "using", "natural",
];

// Small per-dialect extras beyond the ANSI set.
const DIALECT_RESERVED: Partial<Record<DbDialect, string[]>> = {
  oracle: ["level", "rownum", "number", "session", "sysdate", "varchar2", "nvl", "dual", "access", "audit"],
  mysql: ["rank", "dense_rank", "lead", "lag", "change", "fulltext", "longtext", "unsigned", "zerofill"],
  sqlserver: ["identity", "rowguidcol", "clustered", "nonclustered", "nvarchar", "top", "merge"],
  snowflake: ["variant", "qualify", "ilike", "lateral", "connect"],
  databricks: ["lateral", "qualify", "cluster", "tablesample"],
  bigquery: ["array", "struct", "unnest", "qualify", "hash"],
  postgres: ["analyze", "concurrently", "freeze", "ilike", "offset", "returning"],
};

/** The reserved-word set for a dialect (ANSI ∪ dialect extras), lower-cased. */
function reservedFor(dialect: DbDialect): Set<string> {
  return new Set([...ANSI_RESERVED, ...(DIALECT_RESERVED[dialect] ?? [])]);
}

/** True when `name` is a reserved word in `dialect` (case-insensitive). Such names are
 *  still exportable — the DDL renderer quotes them — but flagging helps authors avoid
 *  surprises. */
export function isReservedWord(dialect: DbDialect, name: string): boolean {
  return reservedFor(dialect).has(name.toLowerCase());
}

/** The identifier length limit for a dialect. */
export function identifierMax(dialect: DbDialect): number {
  return IDENTIFIER_MAX[dialect];
}

/** True when `name` exceeds the dialect's unquoted identifier length limit. */
export function exceedsIdentifierLength(dialect: DbDialect, name: string): boolean {
  return name.length > IDENTIFIER_MAX[dialect];
}
