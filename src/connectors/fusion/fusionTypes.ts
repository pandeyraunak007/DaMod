// Fusion Cloud REST attribute → canonical type mapping (Req 22 §5/§6). Fusion
// describe metadata uses JSON-schema-ish type spellings (string/number/integer/
// boolean/date/date-time/…), not SQL. Normalize them into DaMod's fixed modeling
// type set; unmappable spellings return undefined so the native spelling is kept.
//
// Pure + network-free: fully unit-testable without a Fusion tenant.

import type { NormalizedType } from "../metadata";

/** Map a Fusion REST attribute type to the canonical modeling type, or undefined. */
export function mapFusionType(raw: string): NormalizedType | undefined {
  const t = raw.trim().toLowerCase();
  switch (t) {
    case "string":
    case "varchar":
    case "text":
      return { type: "string", length: 255 };
    case "integer":
    case "int":
    case "short":
      return { type: "integer" };
    case "long":
      return { type: "bigint" };
    case "number":
    case "decimal":
    case "double":
    case "float":
    case "bigdecimal":
      return { type: "decimal", precision: 38, scale: 6 };
    case "boolean":
    case "bool":
      return { type: "boolean" };
    case "date":
      return { type: "date" };
    case "datetime":
    case "date-time":
    case "timestamp":
      return { type: "timestamp" };
    case "uuid":
    case "guid":
      return { type: "uuid" };
    case "object":
    case "array":
    case "json":
      return { type: "json" };
    default:
      return undefined; // attachments, binary, unknown custom types: preserve native
  }
}
