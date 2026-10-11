// Table-level browse filter for reverse-engineering (§6.B). Given a discovered
// CanonicalMetadata and the set of objects the user chose to keep (by "schema.name"
// key), return a pruned metadata. Foreign keys that point at a dropped object are left
// in place — toModel skips them with a warning — so no FK rewriting is needed here.

import type { CanonicalMetadata } from "./metadata";

/** Stable key for a discovered object, unique across schemas. */
export const tableKey = (schema: string, name: string): string => `${schema}.${name}`;

/** Keep only the chosen objects within each schema; everything else is dropped. */
export function filterMetadataToTables(
  md: CanonicalMetadata,
  keep: Set<string>,
): CanonicalMetadata {
  return {
    ...md,
    catalogs: md.catalogs.map((cat) => ({
      ...cat,
      schemas: cat.schemas.map((sch) => ({
        ...sch,
        objects: sch.objects.filter((o) => keep.has(tableKey(sch.name, o.name))),
      })),
    })),
  };
}
