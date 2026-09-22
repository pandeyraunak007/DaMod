// SQL dialects for DDL export (FR-8). The project originally scoped one dialect
// (Postgres 16); the author later asked for Snowflake and Databricks as well, so
// export is parameterised by a Dialect. Postgres is the reference dialect the
// acceptance tests run against a real database.

import type { Field } from "../model/model";
import type { DataTypeKind } from "../model/dataTypes";

export type DialectId = "postgres" | "snowflake" | "databricks";

export interface Dialect {
  id: DialectId;
  label: string;
  /** Quote an identifier so reserved words like `Order` are safe. */
  quote: (name: string) => string;
  /** The dialect SQL type for a field's physical type. */
  type: (field: Field) => string;
  /** How comments are emitted. */
  commentStyle: "commentOn" | "inline";
}

function pgType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string":
      return `varchar(${f.length ?? 255})`;
    case "text":
      return "text";
    case "integer":
      return "integer";
    case "bigint":
      return "bigint";
    case "decimal":
      return `numeric(${f.precision ?? 12},${f.scale ?? 2})`;
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "timestamp":
      return "timestamp with time zone";
    case "uuid":
      return "uuid";
    case "json":
      return "jsonb";
    default:
      return "text";
  }
}

function sfType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string":
      return `VARCHAR(${f.length ?? 255})`;
    case "text":
      return "VARCHAR";
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "decimal":
      return `NUMBER(${f.precision ?? 12},${f.scale ?? 2})`;
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "timestamp":
      return "TIMESTAMP_TZ";
    case "uuid":
      return "VARCHAR(36)";
    case "json":
      return "VARIANT";
    default:
      return "VARCHAR";
  }
}

function dbxType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string":
    case "text":
      return "STRING";
    case "integer":
      return "INT";
    case "bigint":
      return "BIGINT";
    case "decimal":
      return `DECIMAL(${f.precision ?? 12},${f.scale ?? 2})`;
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "timestamp":
      return "TIMESTAMP";
    case "uuid":
      return "STRING";
    case "json":
      return "STRING";
    default:
      return "STRING";
  }
}

export const DIALECTS: Record<DialectId, Dialect> = {
  postgres: {
    id: "postgres",
    label: "Postgres 16",
    quote: (n) => `"${n.replace(/"/g, '""')}"`,
    type: pgType,
    commentStyle: "commentOn",
  },
  snowflake: {
    id: "snowflake",
    label: "Snowflake",
    quote: (n) => `"${n.replace(/"/g, '""')}"`,
    type: sfType,
    commentStyle: "commentOn",
  },
  databricks: {
    id: "databricks",
    label: "Databricks",
    quote: (n) => `\`${n.replace(/`/g, "``")}\``,
    type: dbxType,
    commentStyle: "inline",
  },
};

export const DIALECT_IDS: DialectId[] = ["postgres", "snowflake", "databricks"];
