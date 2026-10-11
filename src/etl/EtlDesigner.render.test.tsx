// @vitest-environment jsdom
//
// ETL Phase 3 Slice B — EtlDesigner shell smoke. Mounts the no-graph state (which does
// NOT mount React Flow), asserting the pipeline list + "Create starter graph" affordance
// render without the Zustand getSnapshot loop. The canvas itself (React Flow) is
// author-verified, like the modeling Canvas (no RF render test in the repo).
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EtlDesigner } from "./EtlDesigner";
import { useWorkspaceStore } from "../store/workspaceStore";
import { planFullLoad } from "../connectors/pipeline/planner";
import { newModel, newEntity, newField, type Model } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function model(): Model {
  const m = newModel("sales", "2026-01-01T00:00:00Z", "Physical");
  const c = newEntity("Customer", { x: 0, y: 0 });
  c.fields = [newField("id", "uuid", { primaryKey: true, nullable: false })];
  m.entities = [c];
  return m;
}

beforeEach(() => {
  const spec = planFullLoad(model(), ["Customer"], "postgres", { name: "load_customers" });
  useWorkspaceStore.setState({ pipelines: [spec] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useWorkspaceStore.setState({ pipelines: [] });
  vi.restoreAllMocks();
});

describe("EtlDesigner shell", () => {
  it("renders the pipeline list and the no-graph starter affordance without throwing", () => {
    expect(() => act(() => root.render(<EtlDesigner />))).not.toThrow();
    expect(container.textContent).toContain("ETL Designer");
    expect(container.textContent).toContain("load_customers");
    expect(container.textContent).toContain("no visual graph yet");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Create starter graph")).toBe(true);
  });

  it("mounts cleanly with no pipelines", () => {
    useWorkspaceStore.setState({ pipelines: [] });
    expect(() => act(() => root.render(<EtlDesigner />))).not.toThrow();
    expect(container.textContent).toContain("No pipelines yet");
  });
});
