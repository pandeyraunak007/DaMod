import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";
import { buildContext } from "./context";
import { enforcePrivacy, findContextLeaks } from "./privacy";
import { MockProvider, validateEndpoint, extractJson } from "./provider";
import { requestPlan } from "./orchestrate";
import { mergeConfig, defaultCopilotConfig } from "./settings";
import { executePlan } from "./execute";

const s = () => useModelStore.getState();

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("sales", "2026-01-01T00:00:00Z", "Physical"));
  const c = s().createEntity();
  s().renameEntity(c, "Customer");
  const f = s().addField(c)!;
  s().updateField(c, f, { name: "email", type: "string", length: 320, nullable: false });
});

describe("privacy policy enforcement (§14.4)", () => {
  it("blocks confidential context when verified no-training can't be established", () => {
    const g = enforcePrivacy("require-verified", "unverified", true);
    expect(g.ok).toBe(false);
  });
  it("allows when provider is verified", () => {
    expect(enforcePrivacy("require-verified", "verified", true).ok).toBe(true);
  });
  it("allows non-sensitive context even when unverified", () => {
    expect(enforcePrivacy("require-verified", "unverified", false).ok).toBe(true);
  });
  it("blocks an unsupported provider outright", () => {
    expect(enforcePrivacy("allow-unverified", "unsupported", false).ok).toBe(false);
  });
});

describe("secret redaction + endpoint safety", () => {
  it("flags any secret-like field in context", () => {
    expect(findContextLeaks({ entities: [], password: "x" })).toContain("password");
    expect(findContextLeaks({ entities: [{ name: "Customer" }] })).toEqual([]);
  });
  it("rejects unsafe endpoints, allows https and localhost http", () => {
    expect(validateEndpoint("http://evil.example.com")).toBeTruthy();
    expect(validateEndpoint("https://api.openai.com/v1")).toBeNull();
    expect(validateEndpoint("http://localhost:11434/v1")).toBeNull();
  });
});

describe("context engine minimises and carries no secrets (§14.5)", () => {
  it("builds compact context with names/types/relationships and no leaks", () => {
    const ctx = buildContext(s().model, "model");
    expect(ctx.text).toContain("Customer");
    expect(ctx.text).toContain("email");
    expect(findContextLeaks(ctx.raw)).toEqual([]);
    expect(ctx.categories).toContain("objectNames");
  });
});

describe("settings never persist a key", () => {
  it("mergeConfig keeps only non-secret fields", () => {
    const merged = mergeConfig({ ...defaultCopilotConfig(), apiKey: "sk-secret", model: "gpt-4o" } as unknown);
    expect(JSON.stringify(merged)).not.toContain("sk-secret");
    expect(merged.model).toBe("gpt-4o");
  });
});

describe("requestPlan end-to-end with a mock provider", () => {
  it("returns a validated plan from mocked JSON", async () => {
    const provider = new MockProvider(() =>
      JSON.stringify({
        summary: "Document Customer",
        assumptions: ["Inferred a business definition"],
        actions: [{ kind: "update_description", entity: "Customer", text: "A person or organisation that buys." }],
      }),
    );
    const ctx = buildContext(s().model, "model");
    const res = await requestPlan(provider, "describe Customer", ctx, { policy: "allow-unverified", status: "verified" });
    expect(res.plan).toBeTruthy();
    expect(res.plan!.actions).toHaveLength(1);

    // Applying the plan uses the existing command layer.
    executePlan(res.plan!);
    expect(s().model.entities.find((e) => e.name === "Customer")!.description).toMatch(/buys/);
  });

  it("blocks the request under a privacy policy it can't satisfy (no provider call)", async () => {
    let called = false;
    const provider = new MockProvider(() => { called = true; return "{}"; });
    const ctx = buildContext(s().model, "model"); // has sensitive names
    const res = await requestPlan(provider, "x", ctx, { policy: "require-verified", status: "unverified" });
    expect(res.blocked).toBeTruthy();
    expect(called).toBe(false); // nothing was sent
  });

  it("surfaces an invalid plan instead of mutating", async () => {
    const provider = new MockProvider(() => JSON.stringify({ summary: "x", actions: [{ kind: "bogus" }] }));
    const ctx = buildContext(s().model, "model");
    const res = await requestPlan(provider, "x", ctx, { policy: "allow-unverified", status: "verified" });
    expect(res.error).toMatch(/Invalid plan/);
  });

  it("extractJson tolerates ```json fences and prose", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
