import { describe, it, expect, beforeEach } from "vitest";
import {
  useUiStore,
  defaultUiPrefs,
  mergePrefs,
  pickPersisted,
  clampToBounds,
} from "./uiStore";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";

const ui = () => useUiStore.getState();

function reset() {
  // Back to a known baseline (no localStorage in the node test env).
  const d = defaultUiPrefs();
  useUiStore.setState({ ...d });
}

describe("uiStore placement & visibility", () => {
  beforeEach(reset);

  it("has sensible defaults", () => {
    expect(defaultUiPrefs().toolbarMode).toBe("floating");
    expect(defaultUiPrefs().showExplorer).toBe(true);
  });

  it("switches toolbar placement modes", () => {
    ui().setToolbarMode("bottom");
    expect(ui().toolbarMode).toBe("bottom");
    ui().setToolbarMode("hidden");
    expect(ui().toolbarMode).toBe("hidden");
  });

  it("toggles each panel independently", () => {
    ui().togglePanel("showExplorer");
    expect(ui().showExplorer).toBe(false);
    expect(ui().showProperties).toBe(true); // unaffected
    ui().setPanel("showValidation", false);
    expect(ui().showValidation).toBe(false);
  });

  it("toggles grid and snap", () => {
    const g = ui().showGrid;
    ui().toggleGrid();
    expect(ui().showGrid).toBe(!g);
    ui().toggleSnap();
    expect(ui().snapToGrid).toBe(true);
  });

  it("does not touch model state when UI prefs change (AC #9, #10)", () => {
    useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z"));
    useModelStore.getState().createEntity();
    const before = useModelStore.getState().model;
    ui().setToolbarMode("bottom");
    ui().togglePanel("showProperties");
    ui().toggleGrid();
    expect(useModelStore.getState().model).toBe(before); // identical reference
  });
});

describe("prefs (de)serialization", () => {
  it("merges partial/invalid stored prefs over defaults", () => {
    const merged = mergePrefs({ toolbarMode: "nonsense", showGrid: false, floatingPos: { x: 5, y: 9 } });
    expect(merged.toolbarMode).toBe("floating"); // invalid falls back
    expect(merged.showGrid).toBe(false);
    expect(merged.floatingPos).toEqual({ x: 5, y: 9 });
    expect(merged.showExplorer).toBe(true);
  });

  it("pickPersisted round-trips through merge", () => {
    const s = { ...defaultUiPrefs(), toolbarMode: "bottom" as const, snapToGrid: true };
    expect(mergePrefs(JSON.parse(JSON.stringify(pickPersisted(s))))).toEqual(s);
  });

  it("ignores a non-object blob", () => {
    expect(mergePrefs(null)).toEqual(defaultUiPrefs());
    expect(mergePrefs("x")).toEqual(defaultUiPrefs());
  });
});

describe("clampToBounds (floating stays visible, AC #8)", () => {
  const size = { w: 300, h: 44 };
  const bounds = { w: 1000, h: 700 };

  it("keeps an in-bounds position unchanged", () => {
    expect(clampToBounds({ x: 100, y: 50 }, size, bounds)).toEqual({ x: 100, y: 50 });
  });

  it("clamps a position past the right/bottom edge", () => {
    const c = clampToBounds({ x: 5000, y: 5000 }, size, bounds);
    expect(c.x).toBe(1000 - 300 - 8);
    expect(c.y).toBe(700 - 44 - 8);
  });

  it("clamps a negative position to the margin", () => {
    expect(clampToBounds({ x: -50, y: -50 }, size, bounds)).toEqual({ x: 8, y: 8 });
  });

  it("stays non-negative even when the toolbar is larger than the canvas", () => {
    const c = clampToBounds({ x: 10, y: 10 }, { w: 2000, h: 44 }, { w: 500, h: 300 });
    expect(c.x).toBeGreaterThanOrEqual(8);
  });
});
