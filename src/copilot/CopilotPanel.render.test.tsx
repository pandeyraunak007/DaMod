// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CopilotPanel } from "./CopilotPanel";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CopilotPanel", () => {
  it("mounts without crashing and is off by default (no provider calls)", () => {
    expect(() => act(() => root.render(<CopilotPanel onClose={() => {}} />))).not.toThrow();
    expect(container.textContent).toContain("Copilot");
    // Disabled by default — deterministic modeling keeps working without an LLM.
    expect(container.textContent).toMatch(/Enable Copilot/);
  });
});
