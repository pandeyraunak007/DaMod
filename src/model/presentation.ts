// Level-aware NAME resolution (§4/§6). Entities and fields carry a physical
// identifier `name` and an optional logical/business `logicalName`. Which one the
// UI shows depends on the active level — but BOTH are always preserved on the
// object; this is presentation only.
//
//   Conceptual / Logical      → the business name (logicalName), else the name
//   Physical                  → the physical name
//   Physical/Logical (hybrid) → physical name, with the logical name as secondary
//                               when it differs (shows the mapping)

import type { ModelLevel } from "./levels";

export interface NameParts {
  primary: string;
  /** Shown muted beside the primary at the hybrid level to reveal the mapping. */
  secondary?: string;
}

export interface Named {
  name: string;
  logicalName?: string;
}

export function displayNameParts(obj: Named, level: ModelLevel): NameParts {
  const physical = obj.name;
  const logical = obj.logicalName?.trim() || undefined;
  switch (level) {
    case "Conceptual":
    case "Logical":
      return { primary: logical ?? physical };
    case "Physical/Logical":
      return { primary: physical, secondary: logical && logical !== physical ? logical : undefined };
    case "Physical":
      return { primary: physical };
  }
}

/** The single name to show for an object at the given level. */
export function displayName(obj: Named, level: ModelLevel): string {
  return displayNameParts(obj, level).primary;
}
