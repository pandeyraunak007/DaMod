// UI preferences (§13.6). Toolbar placement, floating position, and panel/grid
// visibility. Kept entirely separate from the model/connector state and persisted
// to localStorage — NOT into model JSON — so UI changes never create meaningless
// diffs in the data model. Pure helpers (defaults, clamp, (de)serialize) are
// exported for unit testing without a DOM.

import { create } from "zustand";

export type ToolbarMode = "bottom" | "floating" | "hidden";

export const PANEL_MIN_WIDTH = 220;
export const PANEL_MAX_WIDTH = 620;

export interface UiPrefs {
  toolbarMode: ToolbarMode;
  floatingPos: { x: number; y: number };
  showExplorer: boolean;
  showProperties: boolean;
  showValidation: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  /** Copilot drawer visibility (persisted, like the other panels). */
  copilotOpen: boolean;
  /** ETL Designer workspace open (top-level view swap, like the Semantic view). */
  etlDesignerOpen: boolean;
  explorerWidth: number;
  propertiesWidth: number;
  copilotWidth: number;
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
    copilotOpen: false,
    etlDesignerOpen: false,
    explorerWidth: 260,
    propertiesWidth: 340,
    copilotWidth: 360,
  };
}

export function clampWidth(w: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(w)));
}

export type LayoutMode = "full" | "modeling" | "ai" | "review";

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
  const width = (v: unknown, fallback: number) => (typeof v === "number" ? clampWidth(v) : fallback);
  return {
    toolbarMode: mode,
    floatingPos: pos,
    showExplorer: bool(r.showExplorer, d.showExplorer),
    showProperties: bool(r.showProperties, d.showProperties),
    showValidation: bool(r.showValidation, d.showValidation),
    showGrid: bool(r.showGrid, d.showGrid),
    snapToGrid: bool(r.snapToGrid, d.snapToGrid),
    copilotOpen: bool(r.copilotOpen, d.copilotOpen),
    etlDesignerOpen: bool(r.etlDesignerOpen, d.etlDesignerOpen),
    explorerWidth: width(r.explorerWidth, d.explorerWidth),
    propertiesWidth: width(r.propertiesWidth, d.propertiesWidth),
    copilotWidth: width(r.copilotWidth, d.copilotWidth),
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
    copilotOpen: s.copilotOpen,
    etlDesignerOpen: s.etlDesignerOpen,
    explorerWidth: s.explorerWidth,
    propertiesWidth: s.propertiesWidth,
    copilotWidth: s.copilotWidth,
  };
}

/** Resolve a named workspace layout (§1.3) to its panel visibility. */
export function layoutVisibility(mode: LayoutMode): Pick<UiPrefs, "showExplorer" | "showProperties" | "copilotOpen"> {
  switch (mode) {
    case "full":
      return { showExplorer: false, showProperties: false, copilotOpen: false };
    case "modeling":
      return { showExplorer: true, showProperties: true, copilotOpen: false };
    case "ai":
      return { showExplorer: true, showProperties: false, copilotOpen: true };
    case "review":
      return { showExplorer: true, showProperties: true, copilotOpen: false };
  }
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
type WidthKey = "explorerWidth" | "propertiesWidth" | "copilotWidth";

interface UiStore extends UiPrefs {
  setToolbarMode: (mode: ToolbarMode) => void;
  setFloatingPos: (pos: { x: number; y: number }) => void;
  togglePanel: (panel: Panel) => void;
  setPanel: (panel: Panel, value: boolean) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleCopilot: () => void;
  setCopilotOpen: (open: boolean) => void;
  setEtlDesignerOpen: (open: boolean) => void;
  setPanelWidth: (key: WidthKey, width: number) => void;
  applyLayout: (mode: LayoutMode) => void;
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
    toggleCopilot: () => commit({ copilotOpen: !get().copilotOpen }),
    setCopilotOpen: (copilotOpen) => commit({ copilotOpen }),
    setEtlDesignerOpen: (etlDesignerOpen) => commit({ etlDesignerOpen }),
    setPanelWidth: (key, width) => commit({ [key]: clampWidth(width) } as Partial<UiPrefs>),
    applyLayout: (mode) => commit(layoutVisibility(mode)),
  };
});
