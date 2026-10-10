// Copilot configuration (§14.3). Non-secret config lives in localStorage; the API
// key lives only in the OS keychain under `secretRef`. Copilot is optional — when
// disabled or unconfigured, all deterministic modeling still works.

import type { NoTrainingStatus, PrivacyPolicy } from "./privacy";

export interface CopilotConfig {
  enabled: boolean;
  providerType: "openai-compatible";
  baseUrl: string;
  model: string;
  /** Whether the provider/account's no-training terms are verified by the user. */
  noTraining: NoTrainingStatus;
  privacyPolicy: PrivacyPolicy;
  /** Keychain reference for the API key (never the key itself). */
  secretRef: string;
}

const KEY = "damod.copilot";
export const COPILOT_SECRET_REF = "copilot:default";

export function defaultCopilotConfig(): CopilotConfig {
  return {
    enabled: false,
    providerType: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    noTraining: "unverified",
    privacyPolicy: "require-verified",
    secretRef: COPILOT_SECRET_REF,
  };
}

export function mergeConfig(raw: unknown): CopilotConfig {
  const d = defaultCopilotConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<CopilotConfig>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    providerType: "openai-compatible",
    baseUrl: typeof r.baseUrl === "string" ? r.baseUrl : d.baseUrl,
    model: typeof r.model === "string" ? r.model : d.model,
    noTraining:
      r.noTraining === "verified" || r.noTraining === "unverified" || r.noTraining === "unsupported"
        ? r.noTraining
        : d.noTraining,
    privacyPolicy: r.privacyPolicy === "allow-unverified" ? "allow-unverified" : "require-verified",
    secretRef: typeof r.secretRef === "string" ? r.secretRef : d.secretRef,
  };
}

export function loadCopilotConfig(): CopilotConfig {
  if (typeof localStorage === "undefined") return defaultCopilotConfig();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? mergeConfig(JSON.parse(raw)) : defaultCopilotConfig();
  } catch {
    return defaultCopilotConfig();
  }
}

export function saveCopilotConfig(cfg: CopilotConfig): void {
  if (typeof localStorage === "undefined") return;
  // Defensive: the config object has no key field, but never serialize anything
  // that looks like a secret.
  try {
    localStorage.setItem(KEY, JSON.stringify(mergeConfig(cfg)));
  } catch {
    /* storage unavailable */
  }
}
