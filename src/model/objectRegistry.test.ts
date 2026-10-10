import { describe, it, expect } from "vitest";
import {
  PG_OBJECTS,
  implementedPgObjects,
  pgObjectsForLevel,
  childObjectTypes,
  pgObject,
} from "./objectRegistry";
import { useModelStore } from "../store/modelStore";
import { newModel } from "./model";

const s = () => useModelStore.getState();

// Req 19 §12 — the registry must not claim support it doesn't have. Every "full"
// object maps to a real model backing, and the store exposes a create path for the
// ones the Explorer offers. This locks the capability matrix to reality.
describe("object registry honesty (Req 19)", () => {
  it("every 'full' object declares a backing and create/ddl caps", () => {
    for (const o of implementedPgObjects()) {
      expect(o.backing, `${o.id} backing`).not.toBeNull();
      expect(o.caps.ddl || o.id === "comment", `${o.id} ddl`).toBe(true);
    }
  });

  it("'none' objects are catalogued but claim no capabilities (no placeholders)", () => {
    for (const o of PG_OBJECTS.filter((x) => x.support === "none")) {
      expect(o.backing).toBeNull();
      expect(Object.values(o.caps).every((v) => v === false)).toBe(true);
    }
  });

  it("the store actually implements the create ops for schema/check/view", () => {
    s().loadModel(newModel("m", "2026-01-01T00:00:00Z", "Physical", "postgres"));
    // schema + check + materialized view are the batch delivered this increment.
    expect(typeof s().createSchema).toBe("function");
    expect(typeof s().addCheck).toBe("function");
    expect(typeof s().createView).toBe("function");
    expect(pgObject("schema")?.support).toBe("full");
    expect(pgObject("checkConstraint")?.support).toBe("full");
    expect(pgObject("materializedView")?.support).toBe("full");
  });

  it("respects modeling-level visibility (no physical objects at Conceptual)", () => {
    const conceptual = pgObjectsForLevel("Conceptual").map((o) => o.id);
    expect(conceptual).toContain("table");
    expect(conceptual).not.toContain("index");
    expect(conceptual).not.toContain("schema");
    expect(conceptual).not.toContain("tablespace");
  });

  it("models parent/child scopes (check constraints live under a table)", () => {
    expect(childObjectTypes("table").map((o) => o.id)).toContain("checkConstraint");
    expect(childObjectTypes("database").map((o) => o.id)).toContain("schema");
    expect(pgObject("checkConstraint")?.parents).toEqual(["table"]);
  });
});
