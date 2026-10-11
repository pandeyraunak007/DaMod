// Phase 2 Slice A — naming-standard store CRUD + persistence round-trip.
import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { newModel } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";

const s = () => useModelStore.getState();

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical"));
});

describe("naming standard store ops", () => {
  it("creates (unique name), updates rules, deletes — all undoable", () => {
    const id = s().createNamingStandard();
    expect(s().model.namingStandards).toHaveLength(1);
    expect(s().model.namingStandards![0].name).toBe("New standard");

    s().updateNamingStandard(id, {
      name: "House style",
      rules: [{ target: "entity", case: "snake_case", prefix: "dim_" }],
    });
    const std = s().model.namingStandards![0];
    expect(std.name).toBe("House style");
    expect(std.rules).toHaveLength(1);

    s().undo(); // revert the update
    expect(s().model.namingStandards![0].name).toBe("New standard");

    s().deleteNamingStandard(id);
    expect(s().model.namingStandards ?? []).toHaveLength(0);
  });

  it("round-trips byte-identically through serialize → parse → serialize", () => {
    const id = s().createNamingStandard();
    s().updateNamingStandard(id, {
      name: "House style",
      description: "tables dim_, snake columns",
      rules: [
        { target: "entity", case: "snake_case", prefix: "dim_" },
        { target: "attribute", case: "snake_case", maxLength: 63 },
      ],
    });
    const once = serializeModel(s().model);
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeModel(parsed.value)).toBe(once);
    expect(parsed.value.namingStandards![0].rules).toHaveLength(2);
  });
});
