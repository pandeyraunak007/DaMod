// Snowflake → canonical type mapping (Req 23 §4.1 / §7). Snowflake's spellings
// (NUMBER(p,s), VARCHAR, TIMESTAMP_NTZ, VARIANT, GEOGRAPHY, …) are normalized into
// DaMod's fixed modeling type set here. Snowflake-specific semi-structured/spatial
// types (VARIANT/OBJECT/ARRAY → json; GEOGRAPHY/GEOMETRY/VECTOR/BINARY → unmappable)
// keep their verbatim spelling via the column's `nativeType` (preserved on the
// field's `source`), so nothing is lost even when normalized or unmapped.
//
// Pure + network-free: fully unit-testable without a Snowflake account.

import type { NormalizedType } from "../metadata";

function parseArgs(raw: string): number[] {
  const m = raw.match(/\(([^)]*)\)/);
  if (!m) return [];
  return m[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
}

export function mapSnowflakeType(raw: string): NormalizedType | undefined {
  const t = raw.trim();
  const base = t.replace(/\(.*\)/, "").trim().toUpperCase();
  const args = parseArgs(t);

  switch (base) {
    // ---- numeric (all are NUMBER aliases in Snowflake) ----
    case "NUMBER":
    case "NUMERIC":
    case "DECIMAL": {
      const [precision, scale] = args;
      if (scale && scale > 0) return { type: "decimal", precision: precision ?? 38, scale };
      if (precision === undefined) return { type: "decimal", precision: 38, scale: 0 };
      if (precision <= 9) return { type: "integer" };
      if (precision <= 18) return { type: "bigint" };
      return { type: "decimal", precision, scale: scale ?? 0 };
    }
    case "INT":
    case "INTEGER":
    case "SMALLINT":
    case "TINYINT":
    case "BYTEINT":
      return { type: "integer" };
    case "BIGINT":
      return { type: "bigint" };
    case "FLOAT":
    case "FLOAT4":
    case "FLOAT8":
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "REAL":
      return { type: "decimal", precision: 38, scale: 6 };

    // ---- string ----
    case "VARCHAR":
    case "CHAR":
    case "CHARACTER":
    case "STRING":
    case "TEXT":
    case "NVARCHAR":
    case "NVARCHAR2":
    case "NCHAR": {
      const [len] = args;
      return { type: "string", length: len ?? 255 };
    }

    // ---- boolean ----
    case "BOOLEAN":
      return { type: "boolean" };

    // ---- date / time ----
    case "DATE":
      return { type: "date" };
    case "TIME":
    case "DATETIME":
    case "TIMESTAMP":
    case "TIMESTAMP_NTZ":
    case "TIMESTAMP_LTZ":
    case "TIMESTAMP_TZ":
      return { type: "timestamp" };

    // ---- semi-structured → json ----
    case "VARIANT":
    case "OBJECT":
    case "ARRAY":
      return { type: "json" };

    default:
      if (base.startsWith("TIMESTAMP")) return { type: "timestamp" };
      // BINARY/VARBINARY, GEOGRAPHY, GEOMETRY, VECTOR, user types: no faithful
      // fixed-set mapping — preserve the native spelling instead.
      return undefined;
  }
}
