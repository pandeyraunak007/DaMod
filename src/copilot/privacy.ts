// Copilot privacy policy + redaction (§14.4). The product is local-first: model
// context goes to an LLM ONLY when the user enables Copilot and initiates a
// request, only the categories needed, and NEVER any credential/secret. We do not
// claim no-training/retention guarantees the provider can't substantiate.

import { findSecretLeaks } from "../connectors/connection";

/** Whether the configured provider+account's terms establish no-training. */
export type NoTrainingStatus = "verified" | "unverified" | "unsupported";

/** The organisation/user policy for sending confidential model context. */
export type PrivacyPolicy = "allow-unverified" | "require-verified";

export interface ContextCategory {
  key: string;
  label: string;
  /** Potentially confidential (business names/definitions) vs structural. */
  sensitive: boolean;
}

// The categories the context engine may include — shown to the user before a
// request so they can see what will be sent (§14.4).
export const CONTEXT_CATEGORIES: ContextCategory[] = [
  { key: "objectNames", label: "Table/column names", sensitive: true },
  { key: "dataTypes", label: "Data types", sensitive: false },
  { key: "relationships", label: "Relationships", sensitive: false },
  { key: "descriptions", label: "Business descriptions", sensitive: true },
  { key: "domains", label: "Reusable domains", sensitive: false },
  { key: "namingStandards", label: "Naming standards", sensitive: false },
  { key: "validation", label: "Validation findings", sensitive: false },
];

export function sensitiveCategories(): ContextCategory[] {
  return CONTEXT_CATEGORIES.filter((c) => c.sensitive);
}

/** Decide whether a request may be sent given the policy and provider status. */
export function enforcePrivacy(
  policy: PrivacyPolicy,
  status: NoTrainingStatus,
  contextHasSensitive: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (status === "unsupported") {
    return { ok: false, reason: "The selected provider's terms do not satisfy the privacy policy." };
  }
  if (policy === "require-verified" && status !== "verified" && contextHasSensitive) {
    return {
      ok: false,
      reason:
        "Privacy policy requires verified no-training protection, which isn't established for this provider — confidential model context (names/descriptions) is blocked. Mark the provider verified or switch policy to send.",
    };
  }
  return { ok: true };
}

/** Hard guard: no secret-like field may ever reach the provider. Returns leak paths. */
export function findContextLeaks(context: unknown): string[] {
  return findSecretLeaks(context);
}

/** Human-readable no-training label for the UI. */
export function noTrainingLabel(status: NoTrainingStatus): string {
  switch (status) {
    case "verified":
      return "No-training: verified for this provider/account";
    case "unverified":
      return "No-training: NOT verified — treat as if data may be retained";
    case "unsupported":
      return "No-training: unsupported by this provider";
  }
}
