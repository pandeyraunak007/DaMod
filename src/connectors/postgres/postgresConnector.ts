// PostgreSQL connector (TypeScript side). Implements the driver-independent
// Connector contract by invoking the Rust commands in src-tauri/src/pg.rs, then
// normalizing their raw payload into canonical metadata. The TS layer never sees
// a password: credentials are stored in the OS keychain via `secretStore` and
// referenced by `secretRef` on the connection profile.

import { invoke } from "@tauri-apps/api/core";
import type { Capability } from "../capabilities";
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryOptions,
  DiscoveryResult,
} from "../connector";
import { ConnectorError } from "../errors";
import type { ConnectionProfile } from "../connection";
import { normalizePgDiscovery, type PgDiscoveryPayload } from "./normalize";

const CAPS: Capability[] = [
  "testConnection",
  "listSchemas",
  "discoverTables",
  "discoverViews",
  "discoverColumns",
  "discoverPrimaryKeys",
  "discoverForeignKeys",
  "discoverIndexes",
];

/** The non-secret config handed to the Rust layer; password is resolved there. */
interface PgRustConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  secret_ref?: string;
  /** Transient password for a pre-save test only (never persisted). */
  password?: string;
}

function toRustConfig(profile: ConnectionProfile, transientPassword?: string): PgRustConfig {
  const p = profile.params;
  if (!p.host || !p.database || !p.user) {
    throw new ConnectorError("invalid_config", "PostgreSQL needs host, database and user.");
  }
  return {
    host: p.host,
    port: p.port ? Number(p.port) : undefined,
    database: p.database,
    user: p.user,
    secret_ref: profile.secretRef,
    password: transientPassword,
  };
}

function sourceLabel(profile: ConnectionProfile): string {
  const p = profile.params;
  return `${p.host}:${p.port ?? 5432}/${p.database}`;
}

class PostgresConnector implements Connector {
  readonly id = "postgres";
  readonly version = "1.0.0";
  readonly systemType = "postgres" as const;

  capabilities(): readonly Capability[] {
    return CAPS;
  }

  testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    return pgTestConnection(profile);
  }

  async listSchemas(profile: ConnectionProfile): Promise<string[]> {
    return invoke<string[]>("pg_list_schemas", { config: toRustConfig(profile) });
  }

  async discover(profile: ConnectionProfile, options?: DiscoveryOptions): Promise<DiscoveryResult> {
    const payload = await invoke<PgDiscoveryPayload>("pg_discover", {
      config: toRustConfig(profile),
      options: {
        schemas: options?.schemas ?? null,
        include_views: options?.includeViews ?? true,
        include_indexes: options?.includeIndexes ?? true,
      },
    });
    const metadata = normalizePgDiscovery(payload, sourceLabel(profile));
    return {
      metadata,
      provenance: {
        connectorId: this.id,
        connectorVersion: this.version,
        discoveredAt: new Date().toISOString(),
        schemasDiscovered: payload.schemas.map((s) => s.name),
        capabilitiesUsed: ["listSchemas", "discoverTables", "discoverColumns", "discoverForeignKeys"],
      },
    };
  }
}

export function createPostgresConnector(): Connector {
  return new PostgresConnector();
}

/**
 * Test a PostgreSQL connection. `transientPassword` is sent once for a pre-save
 * test (before a secret is stored in the keychain); it is never persisted.
 */
export async function pgTestConnection(
  profile: ConnectionProfile,
  transientPassword?: string,
): Promise<ConnectionTestResult> {
  const res = await invoke<{ ok: boolean; message: string; product_version: string | null }>(
    "pg_test_connection",
    { config: toRustConfig(profile, transientPassword) },
  );
  return { ok: res.ok, message: res.message, productVersion: res.product_version ?? undefined };
}

/** Store a connection's password in the OS keychain under a reference. */
export function secretStore(reference: string, secret: string): Promise<void> {
  return invoke("secret_store", { reference, secret });
}

export function secretDelete(reference: string): Promise<void> {
  return invoke("secret_delete", { reference });
}
