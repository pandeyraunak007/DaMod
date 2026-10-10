// @vitest-environment jsdom
//
// Req 17 §2 / AC #7-8 — the Inspector's SQL (DDL) tab renders CREATE TABLE in the
// model's own target dialect, not a hardcoded one.

import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PropertiesDialog } from "./PropertiesDialog";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const s = () => useModelStore.getState();

function openModelWithDialect(dialect: "postgres" | "snowflake") {
  s().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical", dialect));
  const e = s().createEntity();
  s().renameEntity(e, "Customer");
  const f = s().addField(e)!;
  s().updateField(e, f, { name: "id", type: "uuid", primaryKey: true, nullable: false });
  s().select({ kind: "entity", id: e });
  s().openProperties();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PropertiesDialog onClose={() => {}} />));
  const tab = [...container.querySelectorAll("button.tab-btn")].find((b) => b.textContent === "SQL") as HTMLButtonElement;
  act(() => tab?.click());
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Inspector DDL tab honours the model dialect", () => {
  it("renders Postgres types for a postgres model", () => {
    openModelWithDialect("postgres");
    expect(container.textContent).toContain("uuid");
    expect(container.textContent).toContain("Postgres 16 CREATE TABLE");
  });

  it("renders Snowflake types for a snowflake model", () => {
    openModelWithDialect("snowflake");
    const pre = container.querySelector(".export-preview")!.textContent ?? "";
    // uuid maps to VARCHAR(36) in Snowflake, not the pg `uuid` type.
    expect(pre).toContain("VARCHAR(36)");
    expect(container.textContent).toContain("Snowflake CREATE TABLE");
  });
});
