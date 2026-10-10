// Typed connector errors (§3.3: "structured errors and diagnostics"). Every
// failure a connector surfaces carries a machine-readable code so the UI can
// react (retry, re-auth, show permissions) without string-matching messages.
// Unsupported operations throw `unsupported` — never a silent empty success.

import type { Capability } from "./capabilities";

export type ConnectorErrorCode =
  | "unsupported" // the connector does not implement this capability
  | "invalid_config" // the connection config is malformed or incomplete
  | "connection_failed" // could not reach the source (network/host/port)
  | "auth_failed" // credentials rejected
  | "permission_denied" // authenticated but not allowed to read the metadata
  | "timeout" // operation exceeded its deadline
  | "cancelled" // caller aborted the operation
  | "not_found" // a requested schema/object does not exist
  | "internal"; // unexpected connector/driver failure

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  /** Optional non-sensitive diagnostic detail (never credentials). */
  readonly detail?: string;

  constructor(code: ConnectorErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.detail = detail;
  }
}

/** Throw a standard "capability not supported" error for a connector. */
export function unsupported(connectorId: string, cap: Capability): never {
  throw new ConnectorError(
    "unsupported",
    `Connector “${connectorId}” does not support capability “${cap}”.`,
  );
}

export function isConnectorError(e: unknown): e is ConnectorError {
  return e instanceof ConnectorError;
}
