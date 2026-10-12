// Path helpers must be separator-agnostic so the app runs on macOS (/) and Windows (\).
import { describe, it, expect } from "vitest";
import { joinPath, baseName, dirName } from "./fs";

describe("path helpers — POSIX", () => {
  it("joins, bases, and dirs with forward slashes", () => {
    expect(joinPath("/Users/you/models", "sales.model.json")).toBe("/Users/you/models/sales.model.json");
    expect(joinPath("/Users/you/models/", "a.json")).toBe("/Users/you/models/a.json"); // trailing slash trimmed
    expect(baseName("/Users/you/models")).toBe("models");
    expect(baseName("/Users/you/models/sales.model.json")).toBe("sales.model.json");
    expect(dirName("/Users/you/models/sales.model.json")).toBe("/Users/you/models");
  });
});

describe("path helpers — Windows", () => {
  it("joins with a backslash when the dir uses backslashes", () => {
    expect(joinPath("C:\\Users\\you\\models", "sales.model.json")).toBe("C:\\Users\\you\\models\\sales.model.json");
    expect(joinPath("C:\\Users\\you\\models\\", "a.json")).toBe("C:\\Users\\you\\models\\a.json");
  });
  it("extracts base name and parent dir from backslash paths", () => {
    expect(baseName("C:\\Users\\you\\models")).toBe("models");
    expect(baseName("C:\\Users\\you\\models\\sales.model.json")).toBe("sales.model.json");
    expect(dirName("C:\\Users\\you\\models\\sales.model.json")).toBe("C:\\Users\\you\\models");
  });
});
