import { describe, it, expect } from "vitest";
import { validateIdentifier, isValidIdentifier, toSnakeCase } from "./identifiers";

describe("validateIdentifier", () => {
  it("accepts valid Postgres identifiers", () => {
    expect(validateIdentifier("Order")).toBeNull();
    expect(validateIdentifier("customer_id")).toBeNull();
    expect(validateIdentifier("_hidden")).toBeNull();
    expect(validateIdentifier("a".repeat(63))).toBeNull();
  });

  // AT-1.2: trailing space and a digit-leading name are both rejected.
  it("rejects a trailing space", () => {
    expect(validateIdentifier("Order ")).not.toBeNull();
  });
  it("rejects a name starting with a digit", () => {
    expect(validateIdentifier("1order")).not.toBeNull();
  });
  it("rejects empty and over-long names", () => {
    expect(validateIdentifier("")).not.toBeNull();
    expect(validateIdentifier("a".repeat(64))).not.toBeNull();
  });
  it("rejects punctuation and spaces", () => {
    expect(validateIdentifier("order-line")).not.toBeNull();
    expect(validateIdentifier("order line")).not.toBeNull();
  });
});

describe("isValidIdentifier", () => {
  it("mirrors validateIdentifier", () => {
    expect(isValidIdentifier("Order")).toBe(true);
    expect(isValidIdentifier("1order")).toBe(false);
  });
});

describe("toSnakeCase", () => {
  it("snake-cases labels", () => {
    expect(toSnakeCase("Customer")).toBe("customer");
    expect(toSnakeCase("OrderLine")).toBe("order_line");
    expect(toSnakeCase("Order Product")).toBe("order_product");
  });
  it("keeps the result identifier-safe", () => {
    expect(isValidIdentifier(toSnakeCase("123 weird!!"))).toBe(true);
    expect(isValidIdentifier(toSnakeCase(""))).toBe(true);
  });
});
