// @vitest-environment jsdom
//
// Req 18 — the Model Explorer is scoped to the ACTIVE model tab only. Switching
// the active tab swaps the tree; inactive models stay open and untouched; the
// tree never merges two models; selection resolves to the active model.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModelExplorer } from "./ModelExplorer";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { newModel, newEntity, newField, type Model } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function build(name: string, entityName: string): Model {
  const m = newModel(name, "2026-01-01T00:00:00Z", "Physical", "postgres");
  const e = newEntity(entityName, { x: 0, y: 0 });
  e.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  m.entities.push(e);
  return m;
}

const ORDERS = build("Orders", "OrderLine");
const DAMOD = build("damod_test", "Customer");

function tab(m: Model) {
  return { id: m.id, fileName: `${m.name}.model.json`, model: m, lastSavedText: "", savedMtime: 0, externalChange: false, loadError: null };
}

// Simulate what workspaceStore.activate does on a tab switch, without file I/O.
function activate(m: Model) {
  act(() => {
    useWorkspaceStore.setState({ activeId: m.id });
    useModelStore.getState().loadModel(m);
  });
}

beforeEach(() => {
  useWorkspaceStore.setState({ path: "/tmp/ws", tabs: [tab(ORDERS), tab(DAMOD)] });
  useModelStore.getState().loadModel(ORDERS);
  useWorkspaceStore.setState({ activeId: ORDERS.id });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ModelExplorer onNewModel={() => {}} onDeleteModel={() => {}} onOpenSemantic={() => {}} onCollapse={() => {}} />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ModelExplorer active-model scoping (Req 18)", () => {
  it("shows only the active model's tree (isolation)", () => {
    expect(container.textContent).toContain("Orders");
    expect(container.textContent).toContain("OrderLine");
    // The other open model must not appear as a sibling root or merge in.
    expect(container.textContent).not.toContain("damod_test");
    expect(container.textContent).not.toContain("Customer");
  });

  it("swaps to the newly active model's tree and drops the previous one", () => {
    activate(DAMOD);
    expect(container.textContent).toContain("damod_test");
    expect(container.textContent).toContain("Customer");
    expect(container.textContent).not.toContain("Orders");
    expect(container.textContent).not.toContain("OrderLine");
  });

  it("keeps inactive models open in the workspace after switching", () => {
    activate(DAMOD);
    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs.map((t) => t.model?.name).sort()).toEqual(["Orders", "damod_test"]);
    // Both model objects are intact (not mutated/merged).
    expect(ORDERS.entities[0].name).toBe("OrderLine");
    expect(DAMOD.entities[0].name).toBe("Customer");
  });

  it("clears a selection that belonged to the previous model on switch", () => {
    act(() => useModelStore.getState().select({ kind: "entity", id: ORDERS.entities[0].id }));
    expect(useModelStore.getState().selection).not.toBeNull();
    activate(DAMOD); // loadModel resets selection — no stale cross-model selection
    expect(useModelStore.getState().selection).toBeNull();
  });

  it("renders the active model's level badge (level awareness)", () => {
    // Physical model → "P" badge present at the model root.
    expect(container.querySelector(".tree__badge")?.textContent).toBe("P");
  });

  it("offers subject areas for a plain (non-EBS) model and creates one", () => {
    // ORDERS is a plain Postgres model — the Subject areas section must still appear.
    expect(container.textContent).toContain("Subject areas");
    const add = [...container.querySelectorAll(".tree-row")]
      .find((r) => /Subject areas/.test(r.textContent ?? ""))
      ?.querySelector(".tree-row__add") as HTMLButtonElement;
    expect(add).toBeTruthy();
    act(() => add.click());
    expect(useModelStore.getState().model.subjectAreas?.length).toBe(1);
  });
});
