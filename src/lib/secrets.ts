// Thin wrappers over the Rust OS-keychain commands. Secrets (DB passwords, LLM
// API keys) live in the keychain only — never in JSON, localStorage, or logs.
// `secretGet` is for just-in-time retrieval right before an authenticated request;
// callers must not persist the returned value.

import { invoke } from "@tauri-apps/api/core";

export function secretStore(reference: string, secret: string): Promise<void> {
  return invoke("secret_store", { reference, secret });
}

export function secretGet(reference: string): Promise<string | null> {
  return invoke<string | null>("secret_get", { reference });
}

export function secretDelete(reference: string): Promise<void> {
  return invoke("secret_delete", { reference });
}
