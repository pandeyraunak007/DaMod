// BYOLLM provider abstraction (§14.3). The app does not hard-code a single
// provider: a Provider turns chat messages into assistant text. The concrete
// OpenAI-compatible adapter reads the API key from the OS keychain just before
// the request (never from React state/JSON/logs) and POSTs to the user's
// configured base URL. A MockProvider drives the automated tests with no network.

import { secretGet } from "../lib/secrets";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Ask the provider for JSON output when it supports it. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface Provider {
  readonly type: string;
  complete(req: CompletionRequest): Promise<string>;
}

export interface OpenAiCompatConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1
  model: string;
  /** Keychain reference for the API key (not the key itself). */
  secretRef: string;
}

/** Reject endpoints that could exfiltrate context to unsafe destinations (§14.3). */
export function validateEndpoint(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return "Base URL is not a valid URL.";
  }
  if (u.protocol === "https:") return null;
  // Allow plain http only for local providers (Ollama/LM Studio etc.).
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return null;
  return "Base URL must be https:// (http:// allowed only for localhost).";
}

export class OpenAiCompatProvider implements Provider {
  readonly type = "openai-compatible";
  constructor(private cfg: OpenAiCompatConfig) {}

  async complete(req: CompletionRequest): Promise<string> {
    const bad = validateEndpoint(this.cfg.baseUrl);
    if (bad) throw new Error(bad);
    const key = await secretGet(this.cfg.secretRef); // just-in-time; not persisted
    if (!key) throw new Error("No API key stored for this provider. Add one in Copilot settings.");

    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: req.messages,
        temperature: 0.2,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw new Error("Authentication failed — check the API key.");
      if (res.status === 429) throw new Error("Rate limited by the provider — try again shortly.");
      throw new Error(`Provider error ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Provider returned no content.");
    return content;
  }
}

/** In-memory provider for tests and offline development. */
export class MockProvider implements Provider {
  readonly type = "mock";
  constructor(private responder: (req: CompletionRequest) => string) {}
  async complete(req: CompletionRequest): Promise<string> {
    return this.responder(req);
  }
}

/** Extract a JSON object from assistant text (tolerates ```json fences / prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON object found in the model response.");
  return JSON.parse(body.slice(start, end + 1));
}
