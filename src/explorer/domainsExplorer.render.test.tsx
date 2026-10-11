// @vitest-environment jsdom
//
// Slice 1 — Domains discoverable in the Model Explorer. With a physical model that
// has a domain, the tree must render a "Domains" group that counts it. (The known
// gap was that domains had no Explorer node at all.)

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModelExplorer } from "./ModelExplorer";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const model = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  useModelStore.getState().loadModel(model);
  const domainId = useModelStore.getState().createDomain();
  useModelStore.getState().updateDomain(domainId, { name: "Money", type: "decimal" });
  // Seed a single active tab pointing at the active model (Explorer reads the live
  // active model for the active tab).
  useWorkspaceStore.setState({
    path: "/tmp",
    tabs: [
      {
        id: useModelStore.getState().model.id,
        fileName: "m.model.json",
        model: useModelStore.getState().model,
        lastSavedText: "",
        savedMtime: null,
        externalChange: false,
        loadError: null,
      },
    ],
    activeId: useModelStore.getState().model.id,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Model Explorer Domains group (Slice 1)", () => {
  it("renders a Domains group reflecting the model's domain", () => {
    expect(() =>
      act(() => {
        root.render(
          <ModelExplorer
            onNewModel={() => {}}
            onDeleteModel={() => {}}
            onOpenSemantic={() => {}}
            onCollapse={() => {}}
          />,
        );
      }),
    ).not.toThrow();
    expect(container.textContent).toContain("Domains");
  });
});
