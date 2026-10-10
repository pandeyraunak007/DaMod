// Copilot conversation session (Req 16 §3). Draft prompt + operation history kept
// in a module-level store so they survive collapsing/reopening the panel (and even
// remounts). Deliberately IN-MEMORY only — not persisted to disk — because it can
// contain model context and provider responses (§14.4 privacy).

import { create } from "zustand";

export interface ConversationEntry {
  id: string;
  prompt: string;
  summary: string;
  applied: number;
  skipped: number;
  failed: number;
  rejected?: boolean;
}

interface CopilotSession {
  draft: string;
  history: ConversationEntry[];
  setDraft: (draft: string) => void;
  addEntry: (entry: ConversationEntry) => void;
  clear: () => void;
}

export const useCopilotSession = create<CopilotSession>((set) => ({
  draft: "",
  history: [],
  setDraft: (draft) => set({ draft }),
  addEntry: (entry) => set((s) => ({ history: [entry, ...s.history].slice(0, 25) })),
  clear: () => set({ history: [] }),
}));
