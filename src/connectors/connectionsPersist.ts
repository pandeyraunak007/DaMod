// Persistence for connection profiles (`connections.json`). Deterministic,
// versioned, and credential-free: a hard guard refuses to serialize or load any
// profile that carries a secret-like field (§7). Secrets live only in the OS
// keychain, referenced by `secretRef`.

import { z } from "zod";
import { type ConnectionProfile, findSecretLeaks, zConnectionProfile } from "./connection";
import type { ParseResult } from "./metadata";

export const CONNECTIONS_FORMAT_VERSION = 1;

const zConnectionsDoc = z.object({
  formatVersion: z.literal(CONNECTIONS_FORMAT_VERSION),
  connections: z.array(zConnectionProfile),
});

export interface ConnectionsDoc {
  formatVersion: 1;
  connections: ConnectionProfile[];
}

export function emptyConnectionsDoc(): ConnectionsDoc {
  return { formatVersion: 1, connections: [] };
}

function profileToPlain(p: ConnectionProfile): Record<string, unknown> {
  const out: Record<string, unknown> = { id: p.id, name: p.name, systemType: p.systemType };
  // params in sorted key order for a stable diff.
  const params: Record<string, string> = {};
  for (const k of Object.keys(p.params).sort()) params[k] = p.params[k];
  out.params = params;
  if (p.secretRef) out.secretRef = p.secretRef;
  if (p.description) out.description = p.description;
  return out;
}

/** Deterministic JSON for connections.json (profiles sorted by id). */
export function serializeConnections(doc: ConnectionsDoc): string {
  const leaks = findSecretLeaks(doc);
  if (leaks.length) {
    throw new Error(`Refusing to write credentials to connections.json: ${leaks.join(", ")}`);
  }
  const out = {
    formatVersion: doc.formatVersion,
    connections: [...doc.connections]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(profileToPlain),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function parseConnectionsFile(text: string): ParseResult<ConnectionsDoc> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const leaks = findSecretLeaks(raw);
  if (leaks.length) {
    return { ok: false, error: `connections.json contains credential-like fields: ${leaks.join(", ")}` };
  }
  const parsed = zConnectionsDoc.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data as ConnectionsDoc }
    : { ok: false, error: firstIssue(parsed.error) };
}
