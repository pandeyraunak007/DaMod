import { describe, it, expect } from "vitest";
import { hasEbsContent, ebsGroups, ebsEntityProduct } from "./ebsTree";
import { ebsSnapshotToModel } from "../connectors/oracle/ebs";
import { ebsMockMetadata } from "../connectors/oracle/mockEbsConnector";
import { newModel, newEntity } from "../model/model";

const ebsModel = () => ebsSnapshotToModel(ebsMockMetadata(), "EBS", "2026-01-01T00:00:00Z").model;

describe("ebsTree grouping (Req 21 §4)", () => {
  it("detects EBS provenance", () => {
    expect(hasEbsContent(ebsModel())).toBe(true);
    const plain = newModel("x", "t", "Physical");
    plain.entities.push(newEntity("Foo", { x: 0, y: 0 }));
    expect(hasEbsContent(plain)).toBe(false);
  });

  it("reads product from provenance or an ebs: tag", () => {
    const m = ebsModel();
    expect(ebsEntityProduct(m.entities.find((e) => e.name === "AP_INVOICES_ALL")!)).toBe("AP");
  });

  it("groups by product with counts", () => {
    const groups = ebsGroups(ebsModel(), "product");
    expect(groups.map((g) => g.key)).toEqual(["AP", "GL"]);
    expect(groups.find((g) => g.key === "AP")!.entities).toHaveLength(3);
    expect(groups.find((g) => g.key === "GL")!.entities).toHaveLength(2);
  });

  it("groups by schema", () => {
    const groups = ebsGroups(ebsModel(), "schema");
    expect(groups.map((g) => g.key)).toEqual(["AP", "GL"]);
  });

  it("buckets entities with no product/schema separately", () => {
    const m = ebsModel();
    m.entities.push(newEntity("ORPHAN", { x: 0, y: 0 }));
    const byProduct = ebsGroups(m, "product");
    expect(byProduct.some((g) => g.entities.some((e) => e.name === "ORPHAN"))).toBe(true);
    // Orphan group sorts last.
    expect(byProduct[byProduct.length - 1].entities.map((e) => e.name)).toContain("ORPHAN");
  });
});
