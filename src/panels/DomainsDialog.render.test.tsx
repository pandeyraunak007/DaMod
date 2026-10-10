// @vitest-environment jsdom
//
// Regression for the "getSnapshot should be cached" infinite loop (blank screen):
// a Zustand selector that returns `s.model.domains ?? []` builds a fresh array
// every render when the model has no domains, looping until React throws
// "Maximum update depth exceeded". Mounting the dialog against a domain-less model
// must render cleanly. Covers DomainsDialog and the field editor in PropertiesDialog.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DomainsDialog } from "./DomainsDialog";
import { PropertiesDialog } from "./PropertiesDialog";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // A model with NO domains (the loop trigger) and one entity+field to open.
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("domain selectors do not loop on a domain-less model", () => {
  it("mounts DomainsDialog without an infinite loop", () => {
    expect(() =>
      act(() => {
        root.render(<DomainsDialog onClose={() => {}} />);
      }),
    ).not.toThrow();
    expect(container.textContent).toContain("Domains");
  });

  it("mounts the field editor (PropertiesDialog) without an infinite loop", () => {
    const entityId = useModelStore.getState().createEntity();
    useModelStore.getState().addField(entityId);
    useModelStore.getState().select({ kind: "entity", id: entityId });
    useModelStore.getState().openProperties();
    expect(() =>
      act(() => {
        root.render(<PropertiesDialog onClose={() => {}} />);
      }),
    ).not.toThrow();
  });
});
