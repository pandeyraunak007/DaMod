// Oracle → canonical type mapping (Req 21 §B / §4). Oracle's type spellings
// (NUMBER, VARCHAR2, CLOB, DATE, TIMESTAMP(6), …) differ from Postgres', so the
// EBS/Oracle connectors normalize them into DaMod's fixed modeling type set here.
// Unmappable types (BLOB, RAW, spatial, …) return undefined so the canonical
// column preserves its native spelling and metadataToModel falls back cleanly.
//
// Pure + DB-free: fully unit-testable without an Oracle instance.

import type { NormalizedType } from "../metadata";

function parseArgs(raw: string): number[] {
  const m = raw.match(/\(([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Map an Oracle native type spelling to the canonical modeling type, or undefined
 * when there is no faithful mapping (the caller then keeps the native spelling).
 */
export function mapOracleType(raw: string): NormalizedType | undefined {
  const t = raw.trim();
  const base = t.replace(/\(.*\)/, "").trim().toUpperCase();
  const args = parseArgs(t);

  switch (base) {
    // ---- numeric ----
    case "NUMBER":
    case "NUMERIC":
    case "DEC":
    case "DECIMAL": {
      const [precision, scale] = args;
      if (scale && scale > 0) return { type: "decimal", precision: precision ?? 38, scale };
      // Integer-valued NUMBER(p[,0]): pick the smallest fitting integer kind.
      if (precision === undefined) return { type: "decimal", precision: 38, scale: 0 };
      if (precision <= 9) return { type: "integer" };
      if (precision <= 18) return { type: "bigint" };
      return { type: "decimal", precision, scale: scale ?? 0 };
    }
    case "INTEGER":
    case "INT":
    case "SMALLINT":
      return { type: "integer" };
    case "FLOAT":
    case "REAL":
    case "BINARY_FLOAT":
    case "BINARY_DOUBLE":
    case "DOUBLE PRECISION":
      return { type: "decimal", precision: 38, scale: 6 };

    // ---- character ----
    case "VARCHAR2":
    case "VARCHAR":
    case "NVARCHAR2":
    case "CHAR":
    case "NCHAR":
    case "CHARACTER": {
      const [len] = args;
      return { type: "string", length: len ?? 255 };
    }
    case "CLOB":
    case "NCLOB":
    case "LONG":
      return { type: "text" };

    // ---- date / time ----
    case "DATE": // Oracle DATE carries a time component
      return { type: "timestamp" };
    case "TIMESTAMP":
      return { type: "timestamp" };

    // ---- json (12c+) ----
    case "JSON":
      return { type: "json" };

    default:
      // TIMESTAMP WITH [LOCAL] TIME ZONE, INTERVAL …, and other spellings:
      if (base.startsWith("TIMESTAMP")) return { type: "timestamp" };
      if (base.startsWith("INTERVAL")) return { type: "string", length: 30 };
      // BLOB, RAW, LONG RAW, ROWID, BFILE, XMLTYPE, SDO_GEOMETRY, user types: no
      // faithful fixed-set mapping — preserve the native spelling instead.
      return undefined;
  }
}
