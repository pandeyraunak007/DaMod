// Phase 2 Slice A — Naming Standards engine. Pure transform + read-only compliance;
// no model is ever mutated by checkNaming.
import { describe, it, expect } from "vitest";
import { toWords, applyNamingRule, checkNaming, newNamingStandard, type NamingRule } from "./naming";
import { newModel, newEntity, newField, type Model } from "./model";

describe("toWords", () => {
  it("splits snake, kebab, spaces and camel/Pascal/acronym boundaries", () => {
    expect(toWords("customer_id")).toEqual(["customer", "id"]);
    expect(toWords("CustomerOrder")).toEqual(["customer", "order"]);
    expect(toWords("customerOrderLine")).toEqual(["customer", "order", "line"]);
    expect(toWords("APIKey")).toEqual(["api", "key"]);
    expect(toWords("first-name value")).toEqual(["first", "name", "value"]);
  });
});

describe("applyNamingRule", () => {
  const r = (p: Partial<NamingRule>): NamingRule => ({ target: "entity", case: "preserve", ...p });
  it("recasesto each supported case", () => {
    expect(applyNamingRule("CustomerOrder", r({ case: "snake_case" }))).toBe("customer_order");
    expect(applyNamingRule("customer_order", r({ case: "screaming_snake" }))).toBe("CUSTOMER_ORDER");
    expect(applyNamingRule("customer_order", r({ case: "pascal" }))).toBe("CustomerOrder");
    expect(applyNamingRule("customer_order", r({ case: "camel" }))).toBe("customerOrder");
    expect(applyNamingRule("Keep_As_Is", r({ case: "preserve" }))).toBe("Keep_As_Is");
  });
  it("applies prefix/suffix idempotently", () => {
    expect(applyNamingRule("customer", r({ case: "snake_case", prefix: "dim_" }))).toBe("dim_customer");
    expect(applyNamingRule("dim_customer", r({ case: "snake_case", prefix: "dim_" }))).toBe("dim_customer");
    expect(applyNamingRule("orders", r({ case: "snake_case", suffix: "_t" }))).toBe("orders_t");
    expect(applyNamingRule("orders_t", r({ case: "snake_case", suffix: "_t" }))).toBe("orders_t");
  });
});

function model(): Model {
  const m = newModel("m", "2026-01-01T00:00:00Z", "Physical");
  const e = newEntity("CustomerOrder", { x: 0, y: 0 });
  e.fields.push(newField("OrderID", "integer", { primaryKey: true, nullable: false }));
  e.fields.push(newField("customer_id", "integer"));
  m.entities.push(e);
  return m;
}

describe("checkNaming (read-only)", () => {
  it("reports case/prefix/length violations with proposed names and reasons, without mutating", () => {
    const m = model();
    const before = JSON.stringify(m);
    const std = newNamingStandard("snake + dim_");
    std.rules = [
      { target: "entity", case: "snake_case", prefix: "dim_" },
      { target: "attribute", case: "snake_case", maxLength: 6 },
    ];
    const v = checkNaming(m, std);

    const ent = v.find((x) => x.target === "entity")!;
    expect(ent.current).toBe("CustomerOrder");
    expect(ent.proposed).toBe("dim_customer_order");
    expect(ent.reasons.sort()).toEqual(["case", "prefix"]);

    const orderId = v.find((x) => x.target === "attribute" && x.current === "OrderID")!;
    expect(orderId.proposed).toBe("order_id");
    expect(orderId.reasons).toContain("case");
    expect(orderId.reasons).toContain("length"); // "OrderID" is 7 > 6

    // "customer_id" is already snake_case, but still over the 6-char limit → length only.
    const custId = v.find((x) => x.current === "customer_id")!;
    expect(custId.reasons).toEqual(["length"]);
    expect(custId.proposed).toBe("customer_id"); // no case/affix change proposed

    expect(JSON.stringify(m)).toBe(before); // never mutated
  });

  it("returns no violations when everything already conforms", () => {
    const m = model();
    const std = newNamingStandard("snake");
    std.rules = [{ target: "attribute", case: "snake_case" }];
    // customer_id conforms; OrderID does not → exactly one violation.
    expect(checkNaming(m, std).filter((x) => x.target === "attribute")).toHaveLength(1);
  });
});
