import { describe, it, expect } from "vitest";
import { validateWorkspace, type ValidationContext } from "./rules";
import { newModel, newEntity, newField, type Model } from "../model/model";
import { newLink, type ConceptGroup } from "../links/links";

function ctxOf(models: Model[], links: ValidationContext["links"] = [], conceptGroups: ConceptGroup[] = []): ValidationContext {
  return { models: models.map((m) => ({ id: m.id, name: m.name, model: m })), links, conceptGroups };
}

const rulesOf = (issues: { rule: string }[]) => new Set(issues.map((i) => i.rule));

describe("validateWorkspace", () => {
  it("flags duplicate entity names", () => {
    const m = newModel("orders", "t", "Physical");
    m.entities.push(newEntity("Order", { x: 0, y: 0 }), newEntity("Order", { x: 1, y: 1 }));
    const issues = validateWorkspace(ctxOf([m]));
    expect(rulesOf(issues).has("duplicateEntityNames")).toBe(true);
  });

  it("warns on an entity without a primary key (physical), not Conceptual", () => {
    const phys = newModel("p", "t", "Physical");
    const e = newEntity("Order", { x: 0, y: 0 });
    e.fields.push(newField("total", "decimal"));
    phys.entities.push(e);
    expect(rulesOf(validateWorkspace(ctxOf([phys]))).has("entityWithoutPrimaryKey")).toBe(true);

    const conc = newModel("c", "t", "Conceptual");
    const ce = newEntity("Order", { x: 0, y: 0 });
    ce.fields.push(newField("total"));
    conc.entities.push(ce);
    expect(rulesOf(validateWorkspace(ctxOf([conc]))).has("entityWithoutPrimaryKey")).toBe(false);
  });

  it("flags a foreign key whose type differs from the referenced key", () => {
    const m = newModel("orders", "t", "Physical");
    const customer = newEntity("Customer", { x: 0, y: 0 });
    customer.fields.push(newField("id", "uuid", { primaryKey: true }));
    const order = newEntity("Order", { x: 0, y: 0 });
    const fk = newField("customer_id", "bigint"); // wrong: parent PK is uuid
    order.fields.push(fk);
    m.entities.push(customer, order);
    m.relationships.push({
      id: "r_1",
      cardinality: "one-to-many",
      parentEntity: customer.id,
      childEntity: order.id,
      parentOptional: false,
      childOptional: true,
      foreignKeyFields: [fk.id],
    });
    expect(rulesOf(validateWorkspace(ctxOf([m]))).has("foreignKeyTypeMismatch")).toBe(true);
  });

  it("flags mapped fields of different types across a same-as link (AT-3.5)", () => {
    const crm = newModel("crm", "t", "Physical");
    const cust = newEntity("Customer", { x: 0, y: 0 });
    const email = newField("email", "text"); // changed to text
    cust.fields.push(newField("id", "uuid", { primaryKey: true }), email);
    crm.entities.push(cust);

    const orders = newModel("orders", "t", "Physical");
    const oCust = newEntity("Customer", { x: 0, y: 0 });
    const emailAddr = newField("email_address", "string", { length: 255 });
    oCust.fields.push(newField("id", "uuid", { primaryKey: true }), emailAddr);
    orders.entities.push(oCust);

    const link = newLink(
      "same-as",
      { model: crm.id, entity: cust.id },
      { model: orders.id, entity: oCust.id },
      [{ from: email.id, to: emailAddr.id }],
    );
    const group: ConceptGroup = {
      id: "c_1",
      name: "Customer",
      canonical: { model: crm.id, entity: cust.id },
    };
    const issues = validateWorkspace(ctxOf([crm, orders], [link], [group]));
    expect(rulesOf(issues).has("mappedFieldTypeMismatch")).toBe(true);
  });

  it("flags a same-as group with no canonical, and clears once one is set", () => {
    const a = newModel("a", "t", "Physical");
    const ea = newEntity("Customer", { x: 0, y: 0 });
    ea.fields.push(newField("id", "uuid", { primaryKey: true }));
    a.entities.push(ea);
    const b = newModel("b", "t", "Physical");
    const eb = newEntity("Customer", { x: 0, y: 0 });
    eb.fields.push(newField("id", "uuid", { primaryKey: true }));
    b.entities.push(eb);
    const link = newLink("same-as", { model: a.id, entity: ea.id }, { model: b.id, entity: eb.id });

    expect(rulesOf(validateWorkspace(ctxOf([a, b], [link], []))).has("sameAsGroupWithoutCanonical")).toBe(true);

    const group: ConceptGroup = { id: "c_1", name: "Customer", canonical: { model: a.id, entity: ea.id } };
    expect(
      rulesOf(validateWorkspace(ctxOf([a, b], [link], [group]))).has("sameAsGroupWithoutCanonical"),
    ).toBe(false);
  });

  it("a well-formed single model has no errors", () => {
    const m = newModel("orders", "t", "Physical");
    const customer = newEntity("Customer", { x: 0, y: 0 });
    customer.fields.push(newField("id", "uuid", { primaryKey: true }));
    const order = newEntity("Order", { x: 0, y: 0 });
    order.fields.push(newField("id", "uuid", { primaryKey: true }));
    const fk = newField("customer_id", "uuid");
    order.fields.push(fk);
    m.entities.push(customer, order);
    m.relationships.push({
      id: "r_1",
      cardinality: "one-to-many",
      parentEntity: customer.id,
      childEntity: order.id,
      parentOptional: false,
      childOptional: true,
      foreignKeyFields: [fk.id],
    });
    const errors = validateWorkspace(ctxOf([m])).filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });
});
