import { describe, it, expect } from "vitest";
import { newId, isId, ID_PREFIXES, type IdKind } from "./ids";

describe("newId", () => {
  const kinds = Object.keys(ID_PREFIXES) as IdKind[];

  it("uses the right prefix for every kind", () => {
    for (const kind of kinds) {
      expect(newId(kind).startsWith(ID_PREFIXES[kind])).toBe(true);
    }
  });

  it("produces a prefix plus exactly 8 base36 characters", () => {
    for (const kind of kinds) {
      const id = newId(kind);
      const suffix = id.slice(ID_PREFIXES[kind].length);
      expect(suffix).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  it("is well-formed per isId", () => {
    for (const kind of kinds) {
      expect(isId(newId(kind))).toBe(true);
    }
  });

  it("is effectively unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newId("entity"));
    expect(seen.size).toBe(5000);
  });
});

describe("isId", () => {
  it("rejects malformed values", () => {
    expect(isId("")).toBe(false);
    expect(isId("e_")).toBe(false);
    expect(isId("e_a1b2c3d")).toBe(false); // 7 chars
    expect(isId("e_a1b2c3d4e")).toBe(false); // 9 chars
    expect(isId("z_a1b2c3d4")).toBe(false); // unknown prefix
    expect(isId("e_A1B2C3D4")).toBe(false); // uppercase not allowed
    expect(isId("ea1b2c3d4")).toBe(false); // missing underscore
  });
});
