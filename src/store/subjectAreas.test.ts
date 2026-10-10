import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";
import { ebsSnapshotToModel } from "../connectors/oracle/ebs";
import { ebsMockMetadata } from "../connectors/oracle/mockEbsConnector";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";

const s = () => useModelStore.getState();

beforeEach(() => {
  s().loadModel(ebsSnapshotToModel(ebsMockMetadata(), "EBS", "2026-01-01T00:00:00Z").model);
});

describe("subject areas (Req 21 §6)", () => {
  it("creates a subject area from an EBS product's tables", () => {
    const id = s().createSubjectAreaFromProduct("AP")!;
    const area = s().model.subjectAreas!.find((a) => a.id === id)!;
    expect(area.product).toBe("AP");
    expect(area.entities).toHaveLength(3); // AP_SUPPLIERS, AP_INVOICES_ALL, AP_INVOICE_LINES_ALL
    expect(area.name).toBe("AP");
  });

  it("refreshes the existing area for a product instead of duplicating", () => {
    const first = s().createSubjectAreaFromProduct("AP");
    const second = s().createSubjectAreaFromProduct("AP");
    expect(second).toBe(first);
    expect(s().model.subjectAreas).toHaveLength(1);
  });

  it("returns null for a product with no tables", () => {
    expect(s().createSubjectAreaFromProduct("ZZ")).toBeNull();
    expect(s().model.subjectAreas ?? []).toHaveLength(0);
  });

  it("supports manual create / update / delete with undo", () => {
    const e0 = s().model.entities[0].id;
    const id = s().createSubjectArea("Finance", [e0]);
    s().updateSubjectArea(id, { description: "finance scope" });
    expect(s().model.subjectAreas![0].description).toBe("finance scope");
    s().deleteSubjectArea(id);
    expect(s().model.subjectAreas ?? []).toHaveLength(0);
    s().undo();
    expect(s().model.subjectAreas).toHaveLength(1);
  });

  it("round-trips subject areas byte-identically", () => {
    s().createSubjectAreaFromProduct("GL");
    const once = serializeModel(s().model);
    expect(once).toContain('"subjectAreas"');
    const parsed = parseModelFile(once);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeModel(parsed.value)).toBe(once);
  });

  it("adds an entity to an area idempotently (works for any model)", () => {
    const e0 = s().model.entities[0].id;
    const id = s().createSubjectArea("Area");
    s().addEntityToSubjectArea(id, e0);
    s().addEntityToSubjectArea(id, e0); // no-op second time
    expect(s().model.subjectAreas![0].entities).toEqual([e0]);
  });

  it("deleting an area never deletes its entities", () => {
    const before = s().model.entities.length;
    const id = s().createSubjectAreaFromProduct("AP")!;
    s().deleteSubjectArea(id);
    expect(s().model.entities.length).toBe(before);
  });
});
