// Connection profiles (§3.6, §6.A, §7). A profile is the *non-secret* description
// of how to reach a source. Credentials are NEVER stored here: the profile holds
// a `secretRef` — a key into the OS secure store (keychain) resolved in the Rust
// layer at connection time. Profiles are safe to persist in workspace JSON, to
// put in Git, and to hand to React components.

import { z } from "zod";
import type { SourceSystemType } from "./metadata";

export const zConnectionProfile = z.object({
  id: z.string(),
  name: z.string(),
  systemType: z.string(), // SourceSystemType; kept loose so new connectors validate
  /** Non-secret connection parameters (host, port, database, sslmode, …). */
  params: z.record(z.string(), z.string()).default({}),
  /** Opaque reference to the credential in the OS secure store. Never a secret. */
  secretRef: z.string().optional(),
  description: z.string().optional(),
});

export interface ConnectionProfile {
  id: string;
  name: string;
  systemType: SourceSystemType | string;
  params: Record<string, string>;
  secretRef?: string;
  description?: string;
}

// Keys that must never appear in a persisted/serialized profile. Used by the
// redaction guard in snapshot.ts and asserted in tests (§10: credential redaction).
export const SECRET_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "privateKey",
  "apiKey",
  "clientSecret",
  "connectionString",
] as const;

/** Deep-scan an object for anything that looks like a credential. */
export function findSecretLeaks(value: unknown, path = ""): string[] {
  const leaks: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (SECRET_KEYS.some((s) => k.toLowerCase() === s.toLowerCase())) {
          leaks.push(p ? `${p}.${k}` : k);
        }
        walk(val, p ? `${p}.${k}` : k);
      }
    }
  };
  walk(value, path);
  return leaks;
}
