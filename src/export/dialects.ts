// SQL dialects for DDL export (FR-8). The project originally scoped one dialect
// (Postgres 16); the author later asked for Snowflake and Databricks as well, so
// export is parameterised by a Dialect. Postgres is the reference dialect the
// acceptance tests run against a real database.

import type { Field } from "../model/model";
import type { DataTypeKind } from "../model/dataTypes";

export type DialectId = "postgres" | "snowflake" | "databricks" | "oracle" | "sqlserver" | "mysql" | "bigquery";

export interface Dialect {
  id: DialectId;
  label: string;
  /** Quote an identifier so reserved words like `Order` are safe. */
  quote: (name: string) => string;
  /** The dialect SQL type for a field's physical type. */
  type: (field: Field) => string;
  /** How comments are emitted ("none" for dialects with no simple column comment). */
  commentStyle: "commentOn" | "inline" | "none";
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

function oraType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string": return `VARCHAR2(${f.length ?? 255})`;
    case "text": return "CLOB";
    case "integer": return "NUMBER(10)";
    case "bigint": return "NUMBER(19)";
    case "decimal": return `NUMBER(${f.precision ?? 12},${f.scale ?? 2})`;
    case "boolean": return "NUMBER(1)";
    case "date": return "DATE";
    case "timestamp": return "TIMESTAMP";
    case "uuid": return "RAW(16)";
    case "json": return "CLOB";
    default: return "CLOB";
  }
}

function mssqlType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string": return `NVARCHAR(${f.length ?? 255})`;
    case "text": return "NVARCHAR(MAX)";
    case "integer": return "INT";
    case "bigint": return "BIGINT";
    case "decimal": return `DECIMAL(${f.precision ?? 12},${f.scale ?? 2})`;
    case "boolean": return "BIT";
    case "date": return "DATE";
    case "timestamp": return "DATETIME2";
    case "uuid": return "UNIQUEIDENTIFIER";
    case "json": return "NVARCHAR(MAX)";
    default: return "NVARCHAR(MAX)";
  }
}

function mysqlType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string": return `VARCHAR(${f.length ?? 255})`;
    case "text": return "TEXT";
    case "integer": return "INT";
    case "bigint": return "BIGINT";
    case "decimal": return `DECIMAL(${f.precision ?? 12},${f.scale ?? 2})`;
    case "boolean": return "TINYINT(1)";
    case "date": return "DATE";
    case "timestamp": return "DATETIME";
    case "uuid": return "CHAR(36)";
    case "json": return "JSON";
    default: return "TEXT";
  }
}

function bqType(f: Field): string {
  const t = f.type as DataTypeKind;
  switch (t) {
    case "string":
    case "text":
    case "uuid": return "STRING";
    case "integer":
    case "bigint": return "INT64";
    case "decimal": return "NUMERIC";
    case "boolean": return "BOOL";
    case "date": return "DATE";
    case "timestamp": return "TIMESTAMP";
    case "json": return "JSON";
    default: return "STRING";
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
  oracle: {
    id: "oracle",
    label: "Oracle",
    quote: (n) => `"${n.replace(/"/g, '""')}"`,
    type: oraType,
    commentStyle: "commentOn",
  },
  sqlserver: {
    id: "sqlserver",
    label: "SQL Server",
    quote: (n) => `[${n.replace(/]/g, "]]")}]`,
    type: mssqlType,
    commentStyle: "none",
  },
  mysql: {
    id: "mysql",
    label: "MySQL",
    quote: (n) => `\`${n.replace(/`/g, "``")}\``,
    type: mysqlType,
    commentStyle: "inline",
  },
  bigquery: {
    id: "bigquery",
    label: "BigQuery",
    quote: (n) => `\`${n.replace(/`/g, "``")}\``,
    type: bqType,
    commentStyle: "none",
  },
};

export const DIALECT_IDS: DialectId[] = ["postgres", "snowflake", "databricks", "oracle", "sqlserver", "mysql", "bigquery"];
