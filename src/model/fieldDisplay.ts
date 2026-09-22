// Level-aware field rendering helpers (FR-11). What a field shows depends on the
// model's level: physical type, generic logical type, both, or nothing.

import { formatType } from "./dataTypes";
import type { Field } from "./model";
import { type ModelLevel, usesLogicalTypes, usesPhysicalTypes } from "./levels";

export function physicalText(f: Field): string | null {
  return f.type
    ? formatType({ type: f.type, length: f.length, precision: f.precision, scale: f.scale })
    : null;
}

export function logicalText(f: Field): string | null {
  return f.logicalType ?? null;
}

/** The type label to show on a field row for a model at the given level. */
export function fieldTypeLabel(f: Field, level: ModelLevel): string {
  if (level === "Physical/Logical") {
    return [physicalText(f), logicalText(f)].filter(Boolean).join(" · ");
  }
  if (usesPhysicalTypes(level)) return physicalText(f) ?? "—";
  if (usesLogicalTypes(level)) return logicalText(f) ?? "—";
  return ""; // Conceptual: no type
}
