import { describe, it, expect } from "vitest";
import { deriveKey, type SemanticDoc } from "./semantic";
import { serializeSemantic, parseSemanticFile } from "./semanticPersist";

describe("deriveKey (FR-7.11)", () => {
  it("makes identifier-safe keys from names with spaces", () => {
    expect(deriveKey("Average order value")).toBe("average_order_value");
    expect(deriveKey("Revenue")).toBe("revenue");
    expect(deriveKey("OrderLine amount")).toBe("order_line_amount");
    expect(deriveKey("123 metric")).toBe("_123_metric");
  });
});

describe("semantic serialization", () => {
  const doc: SemanticDoc = {
    formatVersion: 1,
    terms: [
      {
        id: "t_1",
        name: "Active customer",
        definition: "Ordered in the last 90 days",
        bindings: [{ concept: "c_1" }],
      },
    ],
    dimensions: [
      {
        id: "d_1",
        name: "Customer",
        concept: "c_1",
        attributes: [{ name: "Region", field: { model: "m_crm", entity: "e_cust", field: "f_region" } }],
      },
      { id: "d_2", name: "Order date", time: true, field: { model: "m_ord", entity: "e_ord", field: "f_at" } },
    ],
    metrics: [
      {
        id: "k_1",
        name: "Revenue",
        key: "revenue",
        aggregate: "sum",
        field: { model: "m_ord", entity: "e_line", field: "f_amt" },
        grain: { model: "m_ord", entity: "e_line" },
        filters: [{ field: { model: "m_ord", entity: "e_ord", field: "f_status" }, op: "=", value: "paid" }],
      },
      { id: "k_2", name: "AOV", key: "aov", derived: { left: "k_1", op: "/", right: "k_3" } },
    ],
  };

  it("is deterministic and round-trips", () => {
    const text = serializeSemantic(doc);
    expect(serializeSemantic(doc)).toBe(text);
    const parsed = parseSemanticFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeSemantic(parsed.value)).toBe(text);
  });

  it("refuses a newer format version", () => {
    const obj = JSON.parse(serializeSemantic(doc));
    obj.formatVersion = 2;
    const r = parseSemanticFile(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("newer");
  });

  it("reports invalid JSON", () => {
    const r = parseSemanticFile("{ bad");
    expect(r.ok).toBe(false);
  });
});
