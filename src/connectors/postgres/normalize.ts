// Normalize the raw PostgreSQL discovery payload (from the Rust `pg_discover`
// command) into the canonical metadata contract. Kept PURE and separate from the
// Tauri invoke boundary so it is unit-testable without a database. Native types
// are mapped into the fixed modeling type set via the existing `mapSqlType`
// (reverse-engineering), so type normalization lives in exactly one place.

import { mapSqlType } from "../../import/reverse";
import type {
  CanonicalColumn,
  CanonicalForeignKey,
  CanonicalMetadata,
  CanonicalObject,
} from "../metadata";

// The shape returned by the Rust layer (snake_case, native types verbatim).
export interface PgDiscoveryPayload {
  server_version: string;
  database: string;
  schemas: {
    name: string;
    objects: {
      name: string;
      kind: string; // table | view | materialized-view
      columns: {
        name: string;
        ordinal: number;
        native_type: string;
        nullable: boolean;
        default: string | null;
        generated: boolean;
      }[];
      primary_key: string[];
      foreign_keys: {
        name: string | null;
        columns: string[];
        ref_schema: string;
        ref_object: string;
        ref_columns: string[];
        on_delete: string;
        on_update: string;
      }[];
      indexes: { name: string; columns: string[]; unique: boolean }[];
    }[];
  }[];
}

function objectKind(kind: string): CanonicalObject["kind"] {
  if (kind === "view") return "view";
  if (kind === "materialized-view") return "materialized-view";
  return "table";
}

/** "no action" is the default RI action and is dropped (matches the model). */
function riAction(a: string): string | undefined {
  return !a || a === "no action" ? undefined : a;
}

export function normalizePgDiscovery(
  payload: PgDiscoveryPayload,
  sourceName: string,
): CanonicalMetadata {
  const schemas = payload.schemas.map((sch) => ({
    name: sch.name,
    objects: sch.objects.map((obj): CanonicalObject => {
      const columns: CanonicalColumn[] = obj.columns.map((c, i) => {
        const mapped = mapSqlType(c.native_type);
        return {
          name: c.name,
          ordinal: typeof c.ordinal === "number" ? c.ordinal : i,
          nativeType: c.native_type,
          // Only attach a normalized type when the mapping is confident (no warning).
          normalizedType: mapped.warning ? undefined : mapped.spec,
          nullable: c.nullable,
          default: c.default ?? undefined,
          generated: c.generated || undefined,
        };
      });
      const foreignKeys: CanonicalForeignKey[] = obj.foreign_keys.map((fk) => ({
        name: fk.name ?? undefined,
        columns: fk.columns,
        refSchema: fk.ref_schema,
        refObject: fk.ref_object,
        refColumns: fk.ref_columns,
        onDelete: riAction(fk.on_delete),
        onUpdate: riAction(fk.on_update),
      }));
      return {
        name: obj.name,
        kind: objectKind(obj.kind),
        columns,
        primaryKey: obj.primary_key.length ? obj.primary_key : undefined,
        foreignKeys,
        indexes: obj.indexes.map((ix) => ({ name: ix.name, columns: ix.columns, unique: ix.unique })),
      };
    }),
  }));

  return {
    metadataVersion: 1,
    source: { systemType: "postgres", name: sourceName, productVersion: payload.server_version },
    capabilities: [
      "testConnection",
      "listSchemas",
      "discoverTables",
      "discoverViews",
      "discoverColumns",
      "discoverPrimaryKeys",
      "discoverForeignKeys",
      "discoverIndexes",
    ],
    catalogs: [{ name: payload.database, schemas }],
  };
}
