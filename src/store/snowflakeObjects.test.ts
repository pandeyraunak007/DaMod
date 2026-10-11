// Req 23 Phase 4 — store ops for Snowflake data-engineering objects: create
// (selects it), update (patch), delete (clears selection), all undoable.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";

const s = () => useModelStore.getState();

describe("snowflake object store ops", () => {
  beforeEach(() => {
    useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical", "snowflake"));
  });

  it("creates an object, selects it, and applies defaults", () => {
    const id = s().createSnowflakeObject("stage");
    expect(s().model.snowflakeObjects).toHaveLength(1);
    const obj = s().model.snowflakeObjects![0];
    expect(obj.kind).toBe("stage");
    expect(obj.stageType).toBe("internal");
    expect(s().selection).toEqual({ kind: "snowflakeObject", id });
  });

  it("updates via patch and leaves others untouched", () => {
    const a = s().createSnowflakeObject("task");
    s().createSnowflakeObject("pipe");
    s().updateSnowflakeObject(a, { warehouse: "WH", sql: "SELECT 1" });
    const task = s().model.snowflakeObjects!.find((o) => o.id === a)!;
    expect(task.warehouse).toBe("WH");
    expect(s().model.snowflakeObjects).toHaveLength(2);
  });

  it("deletes and clears the selection when the deleted object was selected", () => {
    const id = s().createSnowflakeObject("stream");
    s().deleteSnowflakeObject(id);
    expect(s().model.snowflakeObjects).toHaveLength(0);
    expect(s().selection).toBeNull();
  });

  it("creates undoable history (undo removes the object)", () => {
    s().createSnowflakeObject("fileFormat");
    expect(s().model.snowflakeObjects).toHaveLength(1);
    s().undo();
    expect(s().model.snowflakeObjects ?? []).toHaveLength(0);
  });
});

describe("governance object store ops", () => {
  beforeEach(() => {
    useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical", "snowflake"));
  });

  it("creates a grant with its default privilege and selects it", () => {
    const id = s().createGovernanceObject("grant");
    const obj = s().model.governanceObjects![0];
    expect(obj.kind).toBe("grant");
    expect(obj.privilege).toBe("SELECT");
    expect(s().selection).toEqual({ kind: "governanceObject", id });
  });

  it("updates array fields and deletes clearing selection", () => {
    const id = s().createGovernanceObject("role");
    s().updateGovernanceObject(id, { grantedRoles: ["READER", "WRITER"] });
    expect(s().model.governanceObjects![0].grantedRoles).toEqual(["READER", "WRITER"]);
    s().deleteGovernanceObject(id);
    expect(s().model.governanceObjects).toHaveLength(0);
    expect(s().selection).toBeNull();
  });

  it("is undoable", () => {
    s().createGovernanceObject("maskingPolicy");
    expect(s().model.governanceObjects).toHaveLength(1);
    s().undo();
    expect(s().model.governanceObjects ?? []).toHaveLength(0);
  });
});
