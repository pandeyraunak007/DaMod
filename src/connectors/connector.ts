// The connector contract (§3.3). One interface every source adapter implements,
// independent of its underlying driver or language (a TS mock here; a Rust-backed
// PostgreSQL adapter over Tauri invoke next). Metadata discovery is kept separate
// from data extraction — reverse engineering must never read whole tables.

import type { Capability } from "./capabilities";
import type { ConnectionProfile } from "./connection";
import type { CanonicalMetadata, SourceSystemType } from "./metadata";
import type { Provenance } from "./snapshot";

export interface ConnectionTestResult {
  ok: boolean;
  /** Non-sensitive detail, e.g. server version or the reason for failure. */
  message: string;
  productVersion?: string;
}

export interface DiscoveryOptions {
  /** Restrict discovery to these schemas; omitted = connector default. */
  schemas?: string[];
  includeViews?: boolean;
  includeIndexes?: boolean;
  /** Per-operation deadline in ms. */
  timeoutMs?: number;
  /** Cooperative cancellation (connectors that declare the `cancel` capability). */
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  metadata: CanonicalMetadata;
  provenance: Provenance;
}

/**
 * A source connector. Optional capabilities (views, indexes, extraction, …) are
 * declared via `capabilities()`; calling an unsupported operation throws a typed
 * ConnectorError("unsupported") — never a silent empty success.
 */
export interface Connector {
  readonly id: string;
  readonly version: string;
  readonly systemType: SourceSystemType;

  capabilities(): readonly Capability[];

  /** Reachability + auth check. Must not read user data. */
  testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult>;

  /** List schema names visible to the connection. */
  listSchemas(profile: ConnectionProfile): Promise<string[]>;

  /** Discover metadata only (no row data) and normalize to the canonical model. */
  discover(profile: ConnectionProfile, options?: DiscoveryOptions): Promise<DiscoveryResult>;
}

/** A factory so the registry can create connectors by system type. */
export type ConnectorFactory = () => Connector;
