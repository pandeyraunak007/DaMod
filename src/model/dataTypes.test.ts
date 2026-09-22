import { describe, it, expect } from "vitest";
import {
  formatType,
  withTypeDefaults,
  copyTypeSpec,
  sameType,
  paramShape,
} from "./dataTypes";

describe("formatType", () => {
  it("renders parameterised types", () => {
    expect(formatType({ type: "string", length: 255 })).toBe("string(255)");
    expect(formatType({ type: "decimal", precision: 12, scale: 2 })).toBe("decimal(12,2)");
  });
  it("renders plain types", () => {
    expect(formatType({ type: "uuid" })).toBe("uuid");
    expect(formatType({ type: "timestamp" })).toBe("timestamp");
  });
  it("falls back to defaults when params are missing", () => {
    expect(formatType({ type: "string" })).toBe("string(255)");
    expect(formatType({ type: "decimal" })).toBe("decimal(12,2)");
  });
});

describe("withTypeDefaults", () => {
  it("fills string length and decimal precision/scale", () => {
    expect(withTypeDefaults("string")).toEqual({ type: "string", length: 255 });
    expect(withTypeDefaults("decimal")).toEqual({ type: "decimal", precision: 12, scale: 2 });
    expect(withTypeDefaults("uuid")).toEqual({ type: "uuid" });
  });
});

describe("paramShape", () => {
  it("classifies kinds", () => {
    expect(paramShape("string")).toBe("length");
    expect(paramShape("decimal")).toBe("decimal");
    expect(paramShape("integer")).toBe("none");
  });
});

describe("copyTypeSpec / sameType", () => {
  it("copies only type-carrying fields", () => {
    expect(copyTypeSpec({ type: "decimal", precision: 12, scale: 2 })).toEqual({
      type: "decimal",
      precision: 12,
      scale: 2,
    });
  });
  it("compares types with params", () => {
    expect(sameType({ type: "string", length: 255 }, { type: "string", length: 255 })).toBe(true);
    expect(sameType({ type: "string", length: 255 }, { type: "string", length: 100 })).toBe(false);
    expect(sameType({ type: "uuid" }, { type: "bigint" })).toBe(false);
  });
});
