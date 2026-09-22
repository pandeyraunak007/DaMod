import { describe, it, expect } from "vitest";
import {
  type Link,
  type LinksDoc,
  newLink,
  sameAsComponents,
  componentFor,
  proposeFieldMappings,
  linksTouching,
  hasLinks,
  removeLinksTouching,
} from "./links";
import { serializeLinks, parseLinksFile } from "./linksPersist";
import { newModel, newEntity, newField } from "../model/model";

const sameAs = (fm: string, fe: string, tm: string, te: string): Link =>
  newLink("same-as", { model: fm, entity: fe }, { model: tm, entity: te });

describe("sameAsComponents (FR-6.7 transitivity)", () => {
  it("merges A–B and B–C into one group", () => {
    const links = [sameAs("m1", "A", "m2", "B"), sameAs("m2", "B", "m3", "C")];
    const comps = sameAsComponents(links);
    expect(comps).toHaveLength(1);
    expect(comps[0].map((r) => r.entity).sort()).toEqual(["A", "B", "C"]);
  });

  it("keeps unrelated links in separate groups", () => {
    const links = [sameAs("m1", "A", "m2", "B"), sameAs("m3", "D", "m4", "E")];
    expect(sameAsComponents(links)).toHaveLength(2);
  });

  it("componentFor finds the group containing an entity", () => {
    const links = [sameAs("m1", "A", "m2", "B")];
    expect(componentFor(links, "m2", "B")!.map((r) => r.entity).sort()).toEqual(["A", "B"]);
    expect(componentFor(links, "mX", "Z")).toBeNull();
  });
});

describe("proposeFieldMappings (FR-6.2)", () => {
  it("matches fields by name, case-insensitive", () => {
    const crm = newModel("crm", "t", "Physical");
    const cust = newEntity("Customer", { x: 0, y: 0 });
    cust.fields.push(newField("id", "uuid", { primaryKey: true }));
    cust.fields.push(newField("Email", "string"));
    crm.entities.push(cust);

    const orders = newModel("orders", "t", "Physical");
    const oCust = newEntity("Customer", { x: 0, y: 0 });
    oCust.fields.push(newField("id", "uuid", { primaryKey: true }));
    oCust.fields.push(newField("email", "string"));
    orders.entities.push(oCust);

    const maps = proposeFieldMappings(crm, cust.id, orders, oCust.id);
    // id↔id and Email↔email
    expect(maps).toHaveLength(2);
  });
});

describe("linksTouching / removeLinksTouching (FR-6.6)", () => {
  const links = [sameAs("m1", "A", "m2", "B")];

  it("finds links by entity", () => {
    expect(hasLinks(links, { model: "m1", entity: "A" })).toBe(true);
    expect(hasLinks(links, { model: "m9", entity: "Z" })).toBe(false);
    expect(linksTouching(links, { model: "m2", entity: "B" })).toHaveLength(1);
  });

  it("removes touching links", () => {
    const { kept, removed } = removeLinksTouching(links, { model: "m1", entity: "A" });
    expect(removed).toHaveLength(1);
    expect(kept).toHaveLength(0);
  });

  it("finds a field via a same-as mapping", () => {
    const l = newLink("same-as", { model: "m1", entity: "A" }, { model: "m2", entity: "B" }, [
      { from: "f_a", to: "f_b" },
    ]);
    expect(hasLinks([l], { model: "m1", entity: "A", field: "f_a" })).toBe(true);
    expect(hasLinks([l], { model: "m2", entity: "B", field: "f_b" })).toBe(true);
    expect(hasLinks([l], { model: "m2", entity: "B", field: "f_other" })).toBe(false);
  });
});

describe("links serialization round-trip", () => {
  it("is deterministic and re-parses", () => {
    const doc: LinksDoc = {
      formatVersion: 1,
      links: [
        newLink("references", { model: "m1", entity: "A", field: "f1" }, { model: "m2", entity: "B" }),
        newLink("same-as", { model: "m1", entity: "A" }, { model: "m2", entity: "B" }, [
          { from: "f1", to: "f2" },
        ]),
      ],
      conceptGroups: [{ id: "c_1", name: "Customer", canonical: { model: "m1", entity: "A" } }],
    };
    const text = serializeLinks(doc);
    expect(serializeLinks(doc)).toBe(text); // deterministic
    const parsed = parseLinksFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeLinks(parsed.value)).toBe(text);
  });
});
