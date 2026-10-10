// Connector capabilities. A connector declares which operations it supports;
// unsupported operations are represented explicitly (see errors.ts) rather than
// silently returning empty or success. Not every source supports every one.

export const CAPABILITIES = [
  "testConnection",
  "listSchemas",
  "discoverTables",
  "discoverViews",
  "discoverColumns",
  "discoverPrimaryKeys",
  "discoverForeignKeys",
  "discoverIndexes",
  "discoverConstraints",
  "detectSchemaChanges",
  "fullExtract",
  "incrementalExtract",
  "cancel",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** True when the capability list declares support for `cap`. */
export function supports(caps: readonly Capability[], cap: Capability): boolean {
  return caps.includes(cap);
}
