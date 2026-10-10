// UI preferences (§13.6). Toolbar placement, floating position, and panel/grid
// visibility. Kept entirely separate from the model/connector state and persisted
// to localStorage — NOT into model JSON — so UI changes never create meaningless
// diffs in the data model. Pure helpers (defaults, clamp, (de)serialize) are
// exported for unit testing without a DOM.

import { create } from "zustand";

export type ToolbarMode = "bottom" | "floating" | "hidden";

export interface UiPrefs {
  toolbarMode: ToolbarMode;
  floatingPos: { x: number; y: number };
  showExplorer: boolean;
  showProperties: boolean;
  showValidation: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
}

export function defaultUiPrefs(): UiPrefs {
  return {
    toolbarMode: "floating",
    floatingPos: { x: 24, y: 16 },
    showExplorer: true,
    showProperties: true,
    showValidation: true,
    showGrid: true,
    snapToGrid: false,
  };
}

const STORAGE_KEY = "damod.ui";

/** Keep an unknown stored blob valid by merging it over the defaults. */
export function mergePrefs(raw: unknown): UiPrefs {
  const d = defaultUiPrefs();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<UiPrefs>;
  const mode: ToolbarMode =
    r.toolbarMode === "bottom" || r.toolbarMode === "floating" || r.toolbarMode === "hidden"
      ? r.toolbarMode
      : d.toolbarMode;
  const pos =
    r.floatingPos && typeof r.floatingPos.x === "number" && typeof r.floatingPos.y === "number"
      ? { x: r.floatingPos.x, y: r.floatingPos.y }
      : d.floatingPos;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    toolbarMode: mode,
    floatingPos: pos,
    showExplorer: bool(r.showExplorer, d.showExplorer),
    showProperties: bool(r.showProperties, d.showProperties),
    showValidation: bool(r.showValidation, d.showValidation),
    showGrid: bool(r.showGrid, d.showGrid),
    snapToGrid: bool(r.snapToGrid, d.snapToGrid),
  };
}

/** The persisted slice (the whole prefs object; no transient UI). */
export function pickPersisted(s: UiPrefs): UiPrefs {
  return {
    toolbarMode: s.toolbarMode,
    floatingPos: { ...s.floatingPos },
    showExplorer: s.showExplorer,
    showProperties: s.showProperties,
    showValidation: s.showValidation,
    showGrid: s.showGrid,
    snapToGrid: s.snapToGrid,
  };
}

/** Clamp a toolbar position so it stays fully inside the canvas bounds (§13.3). */
export function clampToBounds(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, bounds.w - size.w - margin);
  const maxY = Math.max(margin, bounds.h - size.h - margin);
  return {
    x: Math.min(Math.max(margin, pos.x), maxX),
    y: Math.min(Math.max(margin, pos.y), maxY),
  };
}

function loadInitial(): UiPrefs {
  if (typeof localStorage === "undefined") return defaultUiPrefs();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? mergePrefs(JSON.parse(raw)) : defaultUiPrefs();
  } catch {
    return defaultUiPrefs();
  }
}

function persist(s: UiPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pickPersisted(s)));
  } catch {
    // Storage unavailable (private mode, quota) — prefs stay in-memory only.
  }
}

type Panel = "showExplorer" | "showProperties" | "showValidation";

interface UiStore extends UiPrefs {
  setToolbarMode: (mode: ToolbarMode) => void;
  setFloatingPos: (pos: { x: number; y: number }) => void;
  togglePanel: (panel: Panel) => void;
  setPanel: (panel: Panel, value: boolean) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
}

export const useUiStore = create<UiStore>((set, get) => {
  const commit = (patch: Partial<UiPrefs>) => {
    set(patch);
    persist(pickPersisted(get()));
  };
  return {
    ...loadInitial(),
    setToolbarMode: (toolbarMode) => commit({ toolbarMode }),
    setFloatingPos: (floatingPos) => commit({ floatingPos }),
    togglePanel: (panel) => commit({ [panel]: !get()[panel] } as Partial<UiPrefs>),
    setPanel: (panel, value) => commit({ [panel]: value } as Partial<UiPrefs>),
    toggleGrid: () => commit({ showGrid: !get().showGrid }),
    toggleSnap: () => commit({ snapToGrid: !get().snapToGrid }),
  };
});
