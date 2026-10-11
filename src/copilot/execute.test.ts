import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "../store/modelStore";
import { newModel } from "../model/model";
import { serializeModel } from "../persist/serialize";
import { parsePlan } from "./actions";
import { executePlan } from "./execute";

const s = () => useModelStore.getState();

beforeEach(() => {
  useModelStore.getState().loadModel(newModel("shop", "2026-01-01T00:00:00Z", "Physical"));
});

describe("Copilot plan validation", () => {
  it("rejects a malformed plan (bad action)", () => {
    const r = parsePlan({ summary: "x", actions: [{ kind: "nope" }] });
    expect(r.ok).toBe(false);
  });
  it("accepts a well-formed plan", () => {
    const r = parsePlan({
      summary: "add Customer",
      actions: [{ kind: "create_entity", name: "Customer", fields: [{ name: "id", type: "uuid", primaryKey: true }] }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("executePlan (reuses existing ops, atomic, idempotent)", () => {
  it("creates entities + a relationship and applies them as ONE undo step", () => {
    const plan = parsePlan({
      summary: "orders",
      actions: [
        { kind: "create_entity", name: "Customer", description: "A buyer", fields: [{ name: "id", type: "uuid", primaryKey: true }] },
        { kind: "create_entity", name: "Order", fields: [{ name: "id", type: "uuid", primaryKey: true }] },
        { kind: "create_relationship", parent: "Customer", child: "Order", cardinality: "one-to-many", foreignKeyFieldName: "customer_id" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const res = executePlan(plan.value);
    expect(res.applied).toBe(3);
    expect(res.failed).toBe(0);

    const m = s().model;
    expect(m.entities.map((e) => e.name).sort()).toEqual(["Customer", "Order"]);
    expect(m.entities.find((e) => e.name === "Customer")!.description).toBe("A buyer");
    expect(m.relationships).toHaveLength(1);
    // FK auto-created on the child via existing relationship logic.
    expect(m.entities.find((e) => e.name === "Order")!.fields.some((f) => f.name === "customer_id")).toBe(true);

    // ONE undo reverts the entire plan.
    s().undo();
    expect(s().model.entities).toHaveLength(0);
    expect(s().model.relationships).toHaveLength(0);
    s().redo();
    expect(s().model.entities).toHaveLength(2);
  });

  it("is idempotent — re-running the same plan skips existing objects", () => {
    const plan = parsePlan({
      summary: "x",
      actions: [{ kind: "create_entity", name: "Customer", fields: [{ name: "id", type: "uuid", primaryKey: true }] }],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    const res2 = executePlan(plan.value);
    expect(res2.skipped).toBe(1);
    expect(res2.applied).toBe(0);
    expect(s().model.entities).toHaveLength(1); // no duplicate
  });

  it("updates an entity description via existing updateEntity", () => {
    s().renameEntity(s().createEntity(), "Invoice");
    const plan = parsePlan({
      summary: "doc",
      actions: [{ kind: "update_description", entity: "Invoice", text: "A request for payment." }],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    expect(s().model.entities[0].description).toBe("A request for payment.");
  });

  it("reports a failed action without mutating for it (missing target)", () => {
    const before = serializeModel(s().model);
    const plan = parsePlan({
      summary: "x",
      actions: [{ kind: "update_description", entity: "DoesNotExist", text: "y" }],
    });
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.failed).toBe(1);
    expect(serializeModel(s().model)).toBe(before); // no change
  });

  it("supports add column / update / rename / delete via existing ops", () => {
    // Seed a Customer with an id.
    const seed = parsePlan({
      summary: "seed",
      actions: [{ kind: "create_entity", name: "Customer", fields: [{ name: "id", type: "uuid", primaryKey: true }] }],
    });
    if (seed.ok) executePlan(seed.value);

    // Add a column, rename it + change type, rename the entity.
    const edit = parsePlan({
      summary: "edit",
      actions: [
        { kind: "create_attribute", entity: "Customer", name: "email", type: "string" },
        { kind: "update_attribute", entity: "Customer", field: "email", newName: "email_addr", nullable: false },
        { kind: "rename_entity", entity: "Customer", newName: "Client" },
      ],
    });
    if (!edit.ok) return;
    const r = executePlan(edit.value);
    expect(r.applied).toBe(3);
    const e = s().model.entities.find((x) => x.name === "Client")!;
    expect(e).toBeTruthy();
    const col = e.fields.find((f) => f.name === "email_addr")!;
    expect(col.type).toBe("string");
    expect(col.nullable).toBe(false);

    // Delete the column, then the entity.
    const del = parsePlan({
      summary: "del",
      actions: [
        { kind: "delete_attribute", entity: "Client", field: "email_addr" },
        { kind: "delete_entity", entity: "Client" },
      ],
    });
    if (!del.ok) return;
    executePlan(del.value);
    expect(s().model.entities.find((x) => x.name === "Client")).toBeUndefined();

    // The whole delete batch undoes in one step.
    s().undo();
    expect(s().model.entities.find((x) => x.name === "Client")).toBeTruthy();
  });

  it("rejecting a plan (never calling executePlan) leaves the model byte-identical", () => {
    const before = serializeModel(s().model);
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_entity", name: "Ghost" }] });
    expect(plan.ok).toBe(true);
    // Simulate rejection: we simply do not execute.
    expect(serializeModel(s().model)).toBe(before);
  });
});

describe("create_subject_area action (Req 21/22 §6)", () => {
  function withTables() {
    const e1 = s().createEntity(); s().renameEntity(e1, "Invoice");
    const e2 = s().createEntity(); s().renameEntity(e2, "Supplier");
  }

  it("groups named tables into a subject area (applied through the store)", () => {
    withTables();
    const plan = parsePlan({
      summary: "finance area",
      actions: [{ kind: "create_subject_area", name: "Finance", tables: ["Invoice", "Supplier", "Ghost"] }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(1);
    const area = s().model.subjectAreas!.find((a) => a.name === "Finance")!;
    expect(area.entities).toHaveLength(2); // Invoice + Supplier; "Ghost" skipped
  });

  it("is idempotent (re-applying the same area name skips)", () => {
    withTables();
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_subject_area", name: "Finance", tables: ["Invoice"] }] });
    if (!plan.ok) return;
    executePlan(plan.value);
    const r2 = executePlan(plan.value);
    expect(r2.skipped).toBe(1);
    expect(s().model.subjectAreas).toHaveLength(1);
  });

  it("allows free-form names with spaces (not a SQL identifier)", () => {
    withTables();
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_subject_area", name: "Customer Order Management", tables: ["Invoice"] }] });
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(1);
    expect(s().model.subjectAreas![0].name).toBe("Customer Order Management");
  });
});

describe("bind_domain action (apply a reusable domain to columns)", () => {
  // Seed two entities with a couple of plain columns each.
  function seed() {
    const e1 = s().createEntity(); s().renameEntity(e1, "Customer");
    s().addField(e1); s().addField(e1);
    const e2 = s().createEntity(); s().renameEntity(e2, "Order");
    s().addField(e2);
  }

  it("binds a domain to all columns across all entities when entity/attribute omitted", () => {
    seed();
    const plan = parsePlan({
      summary: "standardise ids",
      actions: [
        { kind: "create_domain", name: "Money", type: "decimal" },
        { kind: "bind_domain", domain: "Money" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.failed).toBe(0);
    const domain = s().model.domains!.find((d) => d.name === "Money")!;
    const allFields = s().model.entities.flatMap((e) => e.fields);
    expect(allFields.length).toBeGreaterThan(0);
    // Every column is now bound to the domain and carries its physical type.
    expect(allFields.every((f) => f.domainId === domain.id)).toBe(true);
    expect(allFields.every((f) => f.type === "decimal")).toBe(true);
    // ONE undo reverts the whole plan (domain + all binds).
    s().undo();
    expect(s().model.domains ?? []).toHaveLength(0);
    expect(s().model.entities.flatMap((e) => e.fields).every((f) => !f.domainId)).toBe(true);
  });

  it("scopes to a single entity when only entity is given", () => {
    seed();
    const plan = parsePlan({
      summary: "x",
      actions: [
        { kind: "create_domain", name: "Money", type: "decimal" },
        { kind: "bind_domain", domain: "Money", entity: "Order" },
      ],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    const domain = s().model.domains!.find((d) => d.name === "Money")!;
    const order = s().model.entities.find((e) => e.name === "Order")!;
    const customer = s().model.entities.find((e) => e.name === "Customer")!;
    expect(order.fields.every((f) => f.domainId === domain.id)).toBe(true);
    expect(customer.fields.every((f) => !f.domainId)).toBe(true); // untouched
  });

  it("fails when the domain does not exist", () => {
    seed();
    const plan = parsePlan({ summary: "x", actions: [{ kind: "bind_domain", domain: "Ghost" }] });
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.failed).toBe(1);
    expect(res.applied).toBe(0);
  });

  it("detaches the domain from an FK whose type reconcile reverts (no bound-but-mismatched column)", () => {
    // C(id:uuid PK) ← B(id PK, c_id FK). Binding a decimal domain to B's PK + its FK:
    // the FK must follow C's uuid PK, so reconcile reverts it — and it must NOT stay
    // bound to the decimal domain (that would be an inconsistent bound-but-mismatched column).
    const cEnt = s().createEntity(); s().renameEntity(cEnt, "Ccat");
    const cPk = s().addField(cEnt)!;
    s().updateField(cEnt, cPk, { name: "id", type: "uuid", primaryKey: true });
    const bEnt = s().createEntity(); s().renameEntity(bEnt, "Bchild");
    const bPk = s().addField(bEnt)!;
    s().updateField(bEnt, bPk, { name: "id", type: "uuid", primaryKey: true });
    s().createRelationship({ parentEntity: cEnt, childEntity: bEnt, cardinality: "one-to-many" });

    const did = s().createDomain();
    s().updateDomain(did, { name: "Money", type: "decimal", precision: 12, scale: 2 });

    const b = () => s().model.entities.find((e) => e.name === "Bchild")!;
    const fk = b().fields.find((f) => !f.primaryKey)!; // the auto-created FK column
    const bound = s().bindFieldsToDomain(
      [{ entityId: bEnt, fieldId: bPk }, { entityId: bEnt, fieldId: fk.id }],
      did,
    );
    expect(bound).toBe(2);
    const fkAfter = b().fields.find((f) => f.id === fk.id)!;
    expect(fkAfter.type).toBe("uuid"); // reverted to follow C's PK
    expect(fkAfter.domainId).toBeUndefined(); // and detached, not left mismatched
    const pkAfter = b().fields.find((f) => f.id === bPk)!;
    expect(pkAfter.domainId).toBe(did); // B's own PK stays bound (decimal)
    expect(pkAfter.type).toBe("decimal");
  });

  it("emits AT MOST ONE FK-reconcile notice for a bulk bind (no toast storm)", () => {
    // Parent/child with a FK so re-typing the parent PK cascades to the child FK.
    const parent = s().createEntity(); s().renameEntity(parent, "Customer");
    const pk = s().addField(parent)!;
    s().updateField(parent, pk, { name: "id", type: "uuid", primaryKey: true });
    const child = s().createEntity(); s().renameEntity(child, "Order");
    s().createRelationship({ parentEntity: parent, childEntity: child, cardinality: "one-to-many" });
    const plan = parsePlan({
      summary: "x",
      actions: [
        { kind: "create_domain", name: "Ref", type: "string" },
        { kind: "bind_domain", domain: "Ref" }, // every column, including the PK
      ],
    });
    if (!plan.ok) return;
    const noticesBefore = s().notices.length;
    executePlan(plan.value);
    // The whole bulk bind adds at most a single reconcile notice, not one per column.
    expect(s().notices.length - noticesBefore).toBeLessThanOrEqual(1);
  });
});

import { useWorkspaceStore } from "../store/workspaceStore";
import { emptySemanticDoc } from "../semantic/semantic";

describe("Copilot semantic-layer actions (FR-7)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ semantic: emptySemanticDoc() });
    // A model with an entity + a numeric field for metric binding.
    s().loadModel(newModel("sales", "2026-01-01T00:00:00Z", "Physical"));
    const e = s().createEntity();
    s().renameEntity(e, "Order");
    const f = s().addField(e)!;
    s().updateField(e, f, { name: "total", type: "decimal" });
  });

  it("creates a business term", () => {
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_term", name: "Gross Revenue", definition: "Total billed", synonyms: ["Revenue"] }] });
    if (!plan.ok) return;
    expect(executePlan(plan.value).applied).toBe(1);
    const t = useWorkspaceStore.getState().semantic.terms[0];
    expect(t.name).toBe("Gross Revenue");
    expect(t.definition).toBe("Total billed");
    expect(t.synonyms).toEqual(["Revenue"]);
  });

  it("creates a dimension bound to an entity", () => {
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_dimension", name: "Order", entity: "Order" }] });
    if (!plan.ok) return;
    executePlan(plan.value);
    const d = useWorkspaceStore.getState().semantic.dimensions[0];
    expect(d.entity?.entity).toBe(s().model.entities[0].id);
  });

  it("creates a metric with aggregate + field binding", () => {
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_metric", name: "Total Sales", aggregate: "sum", entity: "Order", field: "total" }] });
    if (!plan.ok) return;
    executePlan(plan.value);
    const m = useWorkspaceStore.getState().semantic.metrics[0];
    expect(m.aggregate).toBe("sum");
    expect(m.field?.field).toBe(s().model.entities[0].fields[0].id);
  });

  it("is idempotent on term name", () => {
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_term", name: "T" }] });
    if (!plan.ok) return;
    executePlan(plan.value);
    expect(executePlan(plan.value).skipped).toBe(1);
    expect(useWorkspaceStore.getState().semantic.terms).toHaveLength(1);
  });
});

describe("Copilot model-object actions (Req 19)", () => {
  beforeEach(() => {
    s().loadModel(newModel("shop", "2026-01-01T00:00:00Z", "Physical"));
    const e = s().createEntity();
    s().renameEntity(e, "Invoice");
    const f = s().addField(e)!;
    s().updateField(e, f, { name: "amount", type: "decimal" });
  });

  it("creates schema, view, index, sequence, domain, check and sets stereotype", () => {
    const plan = parsePlan({
      summary: "objects",
      actions: [
        { kind: "create_schema", name: "sales", owner: "app" },
        { kind: "create_view", name: "v_paid", definition: "SELECT 1", materialized: true },
        { kind: "create_index", entity: "Invoice", columns: ["amount"], unique: false },
        { kind: "create_sequence", name: "invoice_seq", start: 100 },
        { kind: "create_domain", name: "Money", type: "decimal" },
        { kind: "create_check_constraint", entity: "Invoice", expression: "amount >= 0" },
        { kind: "set_stereotype", entity: "Invoice", stereotype: "fact" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(7);
    const m = s().model;
    expect(m.schemas?.[0].name).toBe("sales");
    expect(m.views?.find((v) => v.materialized)?.name).toBe("v_paid");
    expect(m.indexes?.length).toBe(1);
    expect(m.sequences?.[0].start).toBe(100);
    expect(m.domains?.[0].name).toBe("Money");
    expect(m.entities[0].checks?.[0].expression).toBe("amount >= 0");
    expect(m.entities[0].stereotype).toBe("fact");
  });
});

describe("create_snowflake_object + create_governance_object actions (Req 23 Phase 4/5)", () => {
  beforeEach(() => {
    useModelStore.getState().loadModel(newModel("sf", "2026-01-01T00:00:00Z", "Physical", "snowflake"));
  });

  it("creates a pipe and a masking policy through the store ops", () => {
    const plan = parsePlan({
      summary: "sf de+gov",
      actions: [
        { kind: "create_snowflake_object", objectKind: "pipe", name: "INGEST", copyStatement: "COPY INTO t FROM @s", autoIngest: true },
        { kind: "create_governance_object", objectKind: "maskingPolicy", name: "MASK_EMAIL", argType: "STRING", body: "CASE WHEN current_role() = 'ADMIN' THEN val ELSE '***' END" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(2);
    const pipe = s().model.snowflakeObjects!.find((o) => o.name === "INGEST")!;
    expect(pipe.kind).toBe("pipe");
    expect(pipe.autoIngest).toBe(true);
    const pol = s().model.governanceObjects!.find((o) => o.name === "MASK_EMAIL")!;
    expect(pol.kind).toBe("maskingPolicy");
    expect(pol.body).toContain("current_role()");
  });

  it("skips Snowflake objects when the model does not target Snowflake", () => {
    useModelStore.getState().loadModel(newModel("pg", "2026-01-01T00:00:00Z", "Physical", "postgres"));
    const plan = parsePlan({
      summary: "x",
      actions: [{ kind: "create_governance_object", objectKind: "role", name: "ANALYST" }],
    });
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
    expect(s().model.governanceObjects ?? []).toHaveLength(0);
  });

  it("applies the whole plan as one undo step", () => {
    const plan = parsePlan({
      summary: "x",
      actions: [
        { kind: "create_snowflake_object", objectKind: "stage", name: "LAND" },
        { kind: "create_governance_object", objectKind: "role", name: "ANALYST" },
      ],
    });
    if (!plan.ok) return;
    executePlan(plan.value);
    expect(s().model.snowflakeObjects).toHaveLength(1);
    expect(s().model.governanceObjects).toHaveLength(1);
    s().undo();
    expect(s().model.snowflakeObjects ?? []).toHaveLength(0);
    expect(s().model.governanceObjects ?? []).toHaveLength(0);
  });
});

describe("Copilot create_pipeline action (G-AI)", () => {
  beforeEach(() => {
    // A source model with two tables + a FK, registered as the active tab so allModels()
    // (which iterates tabs) can resolve it. path:null → upsertPipeline stays in memory.
    s().loadModel(newModel("sales", "2026-01-01T00:00:00Z", "Physical"));
    const c = s().createEntity(); s().renameEntity(c, "Customer");
    const cPk = s().addField(c)!; s().updateField(c, cPk, { name: "id", type: "uuid", primaryKey: true });
    const o = s().createEntity(); s().renameEntity(o, "Order");
    const oPk = s().addField(o)!; s().updateField(o, oPk, { name: "id", type: "uuid", primaryKey: true });
    const m = s().model;
    useWorkspaceStore.setState({
      pipelines: [],
      pipelineHistory: {},
      path: null,
      activeId: m.id,
      tabs: [{ id: m.id, fileName: "sales.model.json", model: m, lastSavedText: serializeModel(m), savedMtime: 0, externalChange: false, loadError: null }],
    });
  });

  it("creates a full-load pipeline from the active model to a target", () => {
    const plan = parsePlan({ summary: "x", actions: [{ kind: "create_pipeline", name: "sales_to_wh", target: "snowflake" }] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const res = executePlan(plan.value);
    expect(res.applied).toBe(1);
    const pipes = useWorkspaceStore.getState().pipelines;
    expect(pipes).toHaveLength(1);
    expect(pipes[0].name).toBe("sales_to_wh");
    expect(pipes[0].target.platform).toBe("snowflake");
    expect(pipes[0].objects.length).toBe(2); // both tables by default
  });

  const run = (actions: unknown[]) => {
    const p = parsePlan({ summary: "x", actions });
    if (!p.ok) throw new Error(p.error);
    return executePlan(p.value);
  };

  it("restricts to the named tables and skips a duplicate name", () => {
    run([{ kind: "create_pipeline", name: "p", target: "postgres", entities: ["Order"] }]);
    const pipes = useWorkspaceStore.getState().pipelines;
    expect(pipes[0].objects.length).toBe(1);
    // Re-running the same name is idempotent (skipped).
    expect(run([{ kind: "create_pipeline", name: "p", target: "postgres" }]).skipped).toBe(1);
    expect(useWorkspaceStore.getState().pipelines).toHaveLength(1);
  });

  it("fails when no table matches", () => {
    const res = run([{ kind: "create_pipeline", name: "p2", target: "postgres", entities: ["Ghost"] }]);
    expect(res.failed).toBe(1);
    expect(useWorkspaceStore.getState().pipelines).toHaveLength(0);
  });
});
