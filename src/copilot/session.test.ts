import { describe, it, expect, beforeEach } from "vitest";
import { useCopilotSession } from "./session";

const s = () => useCopilotSession.getState();

beforeEach(() => useCopilotSession.setState({ draft: "", history: [] }));

describe("copilot session (survives panel collapse)", () => {
  it("keeps a draft prompt", () => {
    s().setDraft("describe all tables");
    expect(s().draft).toBe("describe all tables");
  });

  it("records conversation entries newest-first and caps the history", () => {
    for (let i = 0; i < 30; i++) {
      s().addEntry({ id: `e${i}`, prompt: `p${i}`, summary: `s${i}`, applied: i, skipped: 0, failed: 0 });
    }
    expect(s().history).toHaveLength(25); // capped
    expect(s().history[0].prompt).toBe("p29"); // newest first
  });

  it("clears the history without touching the draft", () => {
    s().setDraft("keep me");
    s().addEntry({ id: "a", prompt: "x", summary: "y", applied: 1, skipped: 0, failed: 0 });
    s().clear();
    expect(s().history).toEqual([]);
    expect(s().draft).toBe("keep me");
  });
});
