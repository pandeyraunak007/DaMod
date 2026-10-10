// Copilot conversation session (Req 16 §3). A chat-style message thread + the
// composer draft, kept in a module-level store so they survive collapsing/
// reopening the panel. Deliberately IN-MEMORY only — not persisted to disk —
// because messages can contain model context and provider responses (§14.4).

import { create } from "zustand";
import type { CopilotAction } from "./actions";
import type { PlanResult } from "./execute";

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
}
export interface PlanMessage {
  id: string;
  role: "assistant";
  kind: "plan";
  summary: string;
  assumptions: string[];
  actions: CopilotAction[];
  /** model.updatedAt when generated, for conflict detection at apply time. */
  planBase: string;
  status: "pending" | "applied" | "rejected";
  result?: PlanResult;
}
export interface TextMessage {
  id: string;
  role: "assistant";
  kind: "answer" | "error" | "blocked";
  text: string;
}
export type Message = UserMessage | PlanMessage | TextMessage;

interface CopilotSession {
  draft: string;
  messages: Message[];
  setDraft: (draft: string) => void;
  push: (m: Message) => void;
  update: (id: string, patch: Partial<PlanMessage>) => void;
  clear: () => void;
}

export const useCopilotSession = create<CopilotSession>((set) => ({
  draft: "",
  messages: [],
  setDraft: (draft) => set({ draft }),
  push: (m) => set((s) => ({ messages: [...s.messages, m] })),
  update: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id && m.role === "assistant" && m.kind === "plan" ? { ...m, ...patch } : m)),
    })),
  clear: () => set({ messages: [] }),
}));
