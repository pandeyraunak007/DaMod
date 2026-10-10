import { describe, it, expect, beforeEach } from "vitest";
import { useCopilotSession } from "./session";

const s = () => useCopilotSession.getState();

beforeEach(() => useCopilotSession.setState({ draft: "", messages: [] }));

describe("copilot session (survives panel collapse)", () => {
  it("keeps a draft prompt", () => {
    s().setDraft("describe all tables");
    expect(s().draft).toBe("describe all tables");
  });

  it("appends chat messages in order", () => {
    s().push({ id: "u1", role: "user", text: "hi" });
    s().push({ id: "a1", role: "assistant", kind: "answer", text: "hello" });
    expect(s().messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("updates a pending plan message to applied", () => {
    s().push({ id: "p1", role: "assistant", kind: "plan", summary: "x", assumptions: [], actions: [], planBase: "t", status: "pending" });
    s().update("p1", { status: "applied" });
    const m = s().messages[0];
    expect(m.role === "assistant" && m.kind === "plan" && m.status).toBe("applied");
  });

  it("clears the thread without touching the draft", () => {
    s().setDraft("keep me");
    s().push({ id: "u1", role: "user", text: "x" });
    s().clear();
    expect(s().messages).toEqual([]);
    expect(s().draft).toBe("keep me");
  });
});
