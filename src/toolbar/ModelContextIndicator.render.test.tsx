// @vitest-environment jsdom
//
// Req 20 — the Model | Level | Database indicator reflects the active model's
// authoritative state: updates on tab switch + level change, shows the configured
// database for physical models, "Database-independent" for logical/conceptual, and
// "Database not configured" (never a silent Postgres) when a physical model has none.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModelContextIndicator, databaseLabel } from "./ModelContextIndicator";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const s = () => useModelStore.getState();
const text = () => container.querySelector(".mctx")?.textContent ?? "";

beforeEach(() => {
  s().loadModel(newModel("damod_test", "2026-01-01T00:00:00Z", "Physical", "postgres"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ModelContextIndicator />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("databaseLabel (pure)", () => {
  it("names the configured database for physical levels", () => {
    expect(databaseLabel("Physical", "postgres")).toBe("Postgres 16");
    expect(databaseLabel("Physical/Logical", "snowflake")).toBe("Snowflake");
  });
  it("is database-independent for conceptual/logical", () => {
    expect(databaseLabel("Conceptual", undefined)).toBe("Database-independent");
    expect(databaseLabel("Logical", "postgres")).toBe("Database-independent");
  });
  it("never assumes Postgres when a physical model has no dialect", () => {
    expect(databaseLabel("Physical", undefined)).toBe("Database not configured");
  });
});

describe("ModelContextIndicator (live)", () => {
  it("shows model name, level and configured database", () => {
    expect(text()).toContain("damod_test");
    expect(text()).toContain("Physical");
    expect(text()).toContain("Postgres 16");
  });

  it("updates when the active model is swapped (tab switch)", () => {
    act(() => s().loadModel(newModel("Customer Domain", "2026-01-01T00:00:00Z", "Logical")));
    expect(text()).toContain("Customer Domain");
    expect(text()).toContain("Logical");
    expect(text()).toContain("Database-independent");
    expect(text()).not.toContain("Postgres");
  });

  it("reflects a physical model with no dialect as not configured", () => {
    act(() => s().loadModel(newModel("bare", "2026-01-01T00:00:00Z", "Physical")));
    expect(text()).toContain("Database not configured");
    expect(text()).not.toContain("Postgres 16");
  });
});
