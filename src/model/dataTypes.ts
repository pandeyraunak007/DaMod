// The fixed set of data types the tool knows (FR-2.3). No free-text types.
// Postgres mapping lives in the export module (FR-8) and is added in Phase 4.

export const DATA_TYPE_KINDS = [
  "string",
  "text",
  "integer",
  "bigint",
  "decimal",
  "boolean",
  "date",
  "timestamp",
  "uuid",
  "json",
] as const;

export type DataTypeKind = (typeof DATA_TYPE_KINDS)[number];

/** How a type is parameterised: `string(n)`, `decimal(p,s)`, or nothing. */
export type TypeParamShape = "length" | "decimal" | "none";

export function paramShape(kind: DataTypeKind): TypeParamShape {
  if (kind === "string") return "length";
  if (kind === "decimal") return "decimal";
  return "none";
}

export const DEFAULT_STRING_LENGTH = 255;
export const DEFAULT_DECIMAL_PRECISION = 12;
export const DEFAULT_DECIMAL_SCALE = 2;

/** The type-carrying part of a field. */
export interface TypeSpec {
  type: DataTypeKind;
  length?: number;
  precision?: number;
  scale?: number;
}

/** Human/Postgres-style rendering, e.g. `string(255)`, `decimal(12,2)`, `uuid`. */
export function formatType(spec: TypeSpec): string {
  switch (spec.type) {
    case "string":
      return `string(${spec.length ?? DEFAULT_STRING_LENGTH})`;
    case "decimal":
      return `decimal(${spec.precision ?? DEFAULT_DECIMAL_PRECISION},${spec.scale ?? DEFAULT_DECIMAL_SCALE})`;
    default:
      return spec.type;
  }
}

/** Fill in default parameters for a kind, dropping params that no longer apply. */
export function withTypeDefaults(kind: DataTypeKind): TypeSpec {
  switch (paramShape(kind)) {
    case "length":
      return { type: kind, length: DEFAULT_STRING_LENGTH };
    case "decimal":
      return {
        type: kind,
        precision: DEFAULT_DECIMAL_PRECISION,
        scale: DEFAULT_DECIMAL_SCALE,
      };
    default:
      return { type: kind };
  }
}

/** Copy only the type-carrying fields from a spec (used when an FK adopts a PK's type). */
export function copyTypeSpec(spec: TypeSpec): TypeSpec {
  const out: TypeSpec = { type: spec.type };
  if (spec.length !== undefined) out.length = spec.length;
  if (spec.precision !== undefined) out.precision = spec.precision;
  if (spec.scale !== undefined) out.scale = spec.scale;
  return out;
}

/** True when two specs are the same type with the same parameters. */
export function sameType(a: TypeSpec, b: TypeSpec): boolean {
  return (
    a.type === b.type &&
    a.length === b.length &&
    a.precision === b.precision &&
    a.scale === b.scale
  );
}
