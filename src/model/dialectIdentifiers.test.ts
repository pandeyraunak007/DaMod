// Gap G8 — per-dialect identifier constraints (reserved words + length limits).
import { describe, it, expect } from "vitest";
import { isReservedWord, exceedsIdentifierLength, identifierMax } from "./dialectIdentifiers";

describe("isReservedWord", () => {
  it("detects ANSI reserved words case-insensitively across dialects", () => {
    expect(isReservedWord("postgres", "order")).toBe(true);
    expect(isReservedWord("postgres", "ORDER")).toBe(true);
    expect(isReservedWord("snowflake", "Select")).toBe(true);
    expect(isReservedWord("mysql", "customer")).toBe(false);
  });
  it("detects dialect-specific extras", () => {
    expect(isReservedWord("oracle", "rownum")).toBe(true);
    expect(isReservedWord("postgres", "rownum")).toBe(false); // oracle-only
    expect(isReservedWord("sqlserver", "identity")).toBe(true);
  });
});

describe("identifier length limits", () => {
  it("uses the dialect's max", () => {
    expect(identifierMax("oracle")).toBe(30);
    expect(identifierMax("postgres")).toBe(63);
    expect(identifierMax("bigquery")).toBe(300);
  });
  it("flags over-length per dialect", () => {
    const n40 = "a".repeat(40);
    expect(exceedsIdentifierLength("oracle", n40)).toBe(true); // > 30
    expect(exceedsIdentifierLength("postgres", n40)).toBe(false); // <= 63
  });
});
