// Modeling levels (FR-11). A model's level fixes what its fields hold, what the
// canvas shows, and whether it can export DDL.
//
//   Conceptual       — entities + relationships, names only; fields typeless
//   Logical          — generic types (Text, Number, …), keys, relationships
//   Physical/Logical — hybrid: generic type + name beside physical column + type
//   Physical         — the fixed Postgres-mapped type set (FR-2.3)
//
// A field can carry both a physical `type` and a `logicalType`. The level decides
// which is shown and which is authoritative. Lowering a level hides physical
// detail without deleting it (FR-11.6), so a field keeps both when it can.

import type { DataTypeKind } from "./dataTypes";

export const MODEL_LEVELS = [
  "Conceptual",
  "Logical",
  "Physical/Logical",
  "Physical",
] as const;
export type ModelLevel = (typeof MODEL_LEVELS)[number];

/** Generic logical types (FR-11.3). */
export const LOGICAL_TYPE_KINDS = [
  "Text",
  "Number",
  "Decimal",
  "Boolean",
  "Date",
  "Timestamp",
  "Identifier",
] as const;
export type LogicalTypeKind = (typeof LOGICAL_TYPE_KINDS)[number];

/** Does this level use generic logical types in its UI? */
export function usesLogicalTypes(level: ModelLevel): boolean {
  return level === "Logical" || level === "Physical/Logical";
}

/** Does this level use the physical (Postgres) type set? */
export function usesPhysicalTypes(level: ModelLevel): boolean {
  return level === "Physical" || level === "Physical/Logical";
}

/** Conceptual fields carry no type or keys (FR-11.2). */
export function isConceptual(level: ModelLevel): boolean {
  return level === "Conceptual";
}

/** DDL export is offered only for Physical and Physical/Logical (FR-11.8). */
export function canExportDdl(level: ModelLevel): boolean {
  return usesPhysicalTypes(level);
}

/** One-line reason the export action is disabled, or null when it is allowed. */
export function exportDisabledReason(level: ModelLevel): string | null {
  if (canExportDdl(level)) return null;
  return `${level} models have no physical types to export. Raise the level to Physical first.`;
}

export interface PhysicalMapping {
  type: DataTypeKind;
  length?: number;
  precision?: number;
  scale?: number;
  /** True when more than one physical type is reasonable and the user should confirm (FR-11.6). */
  ambiguous: boolean;
}

/** Map a generic logical type to a default physical type when raising a level. */
export function logicalToPhysical(logical: LogicalTypeKind): PhysicalMapping {
  switch (logical) {
    case "Text":
      return { type: "string", length: 255, ambiguous: true }; // string(n) vs text
    case "Number":
      return { type: "integer", ambiguous: true }; // integer vs bigint
    case "Decimal":
      return { type: "decimal", precision: 12, scale: 2, ambiguous: false };
    case "Boolean":
      return { type: "boolean", ambiguous: false };
    case "Date":
      return { type: "date", ambiguous: false };
    case "Timestamp":
      return { type: "timestamp", ambiguous: false };
    case "Identifier":
      return { type: "uuid", ambiguous: true }; // uuid vs integer/bigint
  }
}

/** Map a physical type down to its generic logical type when lowering a level. */
export function physicalToLogical(type: DataTypeKind): LogicalTypeKind {
  switch (type) {
    case "string":
    case "text":
    case "json":
      return "Text";
    case "integer":
    case "bigint":
      return "Number";
    case "decimal":
      return "Decimal";
    case "boolean":
      return "Boolean";
    case "date":
      return "Date";
    case "timestamp":
      return "Timestamp";
    case "uuid":
      return "Identifier";
  }
}
