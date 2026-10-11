// @vitest-environment jsdom
//
// Verify the Export dialog's Dialect dropdown lists every DDL dialect — including the
// four added targets (Oracle / SQL Server / MySQL / BigQuery) — for a physical model.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExportDialog } from "./ExportDialog";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { newModel, newEntity, newField } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const m = newModel("orders", "2026-01-01T00:00:00Z", "Physical", "postgres");
  const e = newEntity("Customer", { x: 0, y: 0 });
  e.fields.push(newField("id", "uuid", { primaryKey: true, nullable: false }));
  e.fields.push(newField("email", "string", { length: 320, nullable: false }));
  m.entities.push(e);
  useModelStore.getState().loadModel(m);
  useWorkspaceStore.setState({
    path: "/tmp/ws",
    allModels: (() => [{ id: m.id, name: m.name, model: m }]) as never,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ExportDialog onClose={() => {}} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Export dialog dialect dropdown", () => {
  it("lists all 7 DDL dialects including Oracle", () => {
    const select = [...container.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === "Postgres 16"),
    ) as HTMLSelectElement | undefined;
    expect(select).toBeTruthy();
    const labels = [...select!.options].map((o) => o.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(["Postgres 16", "Snowflake", "Databricks", "Oracle", "SQL Server", "MySQL", "BigQuery"]),
    );
  });

  it("generates Oracle DDL when Oracle is selected", () => {
    const select = [...container.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === "Oracle"),
    ) as HTMLSelectElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(select, "oracle");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const preview = container.querySelector(".export-preview")?.textContent ?? "";
    expect(preview).toContain("VARCHAR2"); // Oracle-specific type → DDL regenerated for Oracle
  });
});
