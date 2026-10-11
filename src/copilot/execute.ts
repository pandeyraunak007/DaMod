// Execute an approved Copilot plan against the live model (§14.6). This is the
// bridge from AI actions to the EXISTING domain operations — it never touches
// Zustand state or JSON directly. The whole plan applies as ONE undo step
// (applyAsOne); each action is idempotent (duplicates are skipped), and the model
// is re-validated afterwards. A rejected plan simply isn't executed, so the model
// is untouched.

import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { validateIdentifier } from "../model/identifiers";
import { validateWorkspace } from "../validation/rules";
import type { Entity, Field, Model } from "../model/model";
import type { CopilotAction, CopilotPlan } from "./actions";
import { type DataTypeKind, withTypeDefaults } from "../model/dataTypes";
import { newTerm, newDimension, newMetric } from "../semantic/semantic";

export interface ActionResult {
  action: CopilotAction;
  status: "applied" | "skipped" | "failed";
  message: string;
}

export interface PlanResult {
  results: ActionResult[];
  applied: number;
  skipped: number;
  failed: number;
  validationErrors: number;
}

function entityByName(model: Model, name: string): Entity | undefined {
  return model.entities.find((e) => e.name.toLowerCase() === name.toLowerCase());
}
function fieldByName(entity: Entity, name: string): Field | undefined {
  return entity.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
}

/** Apply one action using existing store ops; returns its result. */
function applyAction(action: CopilotAction): ActionResult {
  const store = useModelStore.getState();
  const model = () => useModelStore.getState().model;
  const ok = (message: string): ActionResult => ({ action, status: "applied", message });
  const skip = (message: string): ActionResult => ({ action, status: "skipped", message });
  const fail = (message: string): ActionResult => ({ action, status: "failed", message });

  switch (action.kind) {
    case "create_entity": {
      const err = validateIdentifier(action.name);
      if (err) return fail(`“${action.name}”: ${err}`);
      if (entityByName(model(), action.name)) return skip(`“${action.name}” already exists`);
      const id = store.createEntity();
      store.renameEntity(id, action.name);
      if (action.description) store.updateEntity(id, { description: action.description });
      let fieldCount = 0;
      for (const f of action.fields ?? []) {
        if (validateIdentifier(f.name)) continue; // skip invalid field names
        const fid = store.addField(id);
        if (!fid) continue;
        store.updateField(id, fid, {
          name: f.name,
          ...(f.type ? { type: f.type as DataTypeKind } : {}),
          primaryKey: f.primaryKey ?? false,
          nullable: f.nullable ?? !f.primaryKey,
        });
        fieldCount++;
      }
      return ok(`Created “${action.name}” with ${fieldCount} field(s)`);
    }

    case "update_description": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      if (action.field) {
        const f = fieldByName(e, action.field);
        if (!f) return fail(`Field “${action.entity}.${action.field}” not found`);
        if ((f.description ?? "") === action.text) return skip("description unchanged");
        store.updateField(e.id, f.id, { description: action.text });
        return ok(`Updated description of ${action.entity}.${action.field}`);
      }
      if ((e.description ?? "") === action.text) return skip("description unchanged");
      store.updateEntity(e.id, { description: action.text });
      return ok(`Updated description of ${action.entity}`);
    }

    case "create_relationship": {
      const parent = entityByName(model(), action.parent);
      const child = entityByName(model(), action.child);
      if (!parent) return fail(`Parent “${action.parent}” not found`);
      if (!child) return fail(`Child “${action.child}” not found`);
      const exists = model().relationships.some(
        (r) =>
          r.cardinality === action.cardinality &&
          ((r.parentEntity === parent.id && r.childEntity === child.id) ||
            (action.cardinality === "many-to-many" &&
              r.parentEntity === child.id &&
              r.childEntity === parent.id)),
      );
      if (exists) return skip(`relationship ${action.parent}→${action.child} already exists`);
      store.createRelationship({
        cardinality: action.cardinality,
        parentEntity: parent.id,
        childEntity: child.id,
        foreignKeyFieldName: action.foreignKeyFieldName,
      });
      return ok(`Created ${action.cardinality} ${action.parent}→${action.child}`);
    }

    case "create_attribute": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if (fieldByName(e, action.name)) return skip(`${action.entity}.${action.name} already exists`);
      const fid = store.addField(e.id);
      if (!fid) return fail("could not add field");
      store.updateField(e.id, fid, {
        name: action.name,
        ...(action.type ? { type: action.type as DataTypeKind } : {}),
        primaryKey: action.primaryKey ?? false,
        unique: action.unique ?? false,
        nullable: action.nullable ?? !action.primaryKey,
      });
      return ok(`Added ${action.entity}.${action.name}`);
    }

    case "update_attribute": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      const f = fieldByName(e, action.field);
      if (!f) return fail(`Field “${action.entity}.${action.field}” not found`);
      if (action.newName && validateIdentifier(action.newName)) return fail(`“${action.newName}”: invalid name`);
      store.updateField(e.id, f.id, {
        ...(action.newName ? { name: action.newName } : {}),
        ...(action.type ? { type: action.type as DataTypeKind } : {}),
        ...(action.primaryKey !== undefined ? { primaryKey: action.primaryKey } : {}),
        ...(action.unique !== undefined ? { unique: action.unique } : {}),
        ...(action.nullable !== undefined ? { nullable: action.nullable } : {}),
      });
      return ok(`Updated ${action.entity}.${action.field}`);
    }

    case "rename_entity": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      const err = store.renameEntity(e.id, action.newName);
      if (err) return fail(`rename to “${action.newName}”: ${err}`);
      return ok(`Renamed ${action.entity} → ${action.newName}`);
    }

    case "create_subject_area": {
      // Subject areas use free-form business names (spaces allowed) — NOT SQL
      // identifiers. Only require that the name is non-empty.
      if (!action.name.trim()) return fail("subject area needs a name");
      // Derive from an EBS product / Fusion family when no explicit tables are given.
      if (action.product && !action.tables?.length) {
        const id = store.createSubjectAreaFromProduct(action.product, action.name);
        if (!id) return fail(`No tables found for product/family “${action.product}”`);
        return ok(`Created subject area “${action.name}” from ${action.product}`);
      }
      if ((model().subjectAreas ?? []).some((a) => a.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`subject area “${action.name}” already exists`);
      }
      const ids: string[] = [];
      const unknown: string[] = [];
      for (const t of action.tables ?? []) {
        const e = entityByName(model(), t);
        if (e) ids.push(e.id);
        else unknown.push(t);
      }
      const id = store.createSubjectArea(action.name, ids);
      if (action.description) store.updateSubjectArea(id, { description: action.description });
      const note = unknown.length ? ` (${unknown.length} unknown table(s) skipped: ${unknown.join(", ")})` : "";
      return ok(`Created subject area “${action.name}” with ${ids.length} table(s)${note}`);
    }

    case "create_schema": {
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if ((model().schemas ?? []).some((s) => s.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`schema “${action.name}” already exists`);
      }
      const id = store.createSchema();
      store.updateSchema(id, { name: action.name, ...(action.owner ? { owner: action.owner } : {}), ...(action.comment ? { comment: action.comment } : {}) });
      return ok(`Created schema “${action.name}”`);
    }

    case "create_view": {
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if ((model().views ?? []).some((v) => v.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`view “${action.name}” already exists`);
      }
      const id = store.createView(undefined, action.materialized);
      store.updateView(id, { name: action.name, ...(action.definition ? { definition: action.definition } : {}) });
      return ok(`Created ${action.materialized ? "materialized view" : "view"} “${action.name}”`);
    }

    case "create_index": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      const id = store.createIndex(e.id);
      if (!id) return fail("could not create index");
      const cols = (action.columns ?? [])
        .map((c) => fieldByName(e, c)?.id)
        .filter((x): x is string => !!x);
      store.updateIndex(id, { ...(action.name ? { name: action.name } : {}), fields: cols, unique: action.unique ?? false });
      return ok(`Created index on ${action.entity} (${cols.length} column(s))`);
    }

    case "create_sequence": {
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if ((model().sequences ?? []).some((s) => s.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`sequence “${action.name}” already exists`);
      }
      const id = store.createSequence();
      store.updateSequence(id, { name: action.name, ...(action.start !== undefined ? { start: action.start } : {}), ...(action.increment !== undefined ? { increment: action.increment } : {}) });
      return ok(`Created sequence “${action.name}”`);
    }

    case "create_domain": {
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if ((model().domains ?? []).some((d) => d.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`domain “${action.name}” already exists`);
      }
      const id = store.createDomain();
      store.updateDomain(id, { name: action.name, ...(action.type ? withTypeDefaults(action.type as DataTypeKind) : {}) });
      return ok(`Created domain “${action.name}”`);
    }

    case "create_check_constraint": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      if (!action.expression.trim()) return fail("check constraint needs an expression");
      const cid = store.addCheck(e.id);
      if (!cid) return fail("could not add check constraint");
      store.updateCheck(e.id, cid, { ...(action.name ? { name: action.name } : {}), expression: action.expression });
      return ok(`Added check constraint on ${action.entity}`);
    }

    case "set_stereotype": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      store.updateEntity(e.id, { stereotype: action.stereotype === "none" ? undefined : action.stereotype });
      return ok(`Set ${action.entity} stereotype to ${action.stereotype}`);
    }

    case "create_term": {
      const ws = useWorkspaceStore.getState();
      if (ws.semantic.terms.some((t) => t.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`term “${action.name}” already exists`);
      }
      const term = newTerm(action.name);
      term.definition = action.definition ?? "";
      if (action.synonyms?.length) term.synonyms = action.synonyms;
      ws.addTerm(term);
      return ok(`Created business term “${action.name}”`);
    }

    case "create_dimension": {
      const ws = useWorkspaceStore.getState();
      if (ws.semantic.dimensions.some((d) => d.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`dimension “${action.name}” already exists`);
      }
      const dim = newDimension(action.name);
      if (action.description) dim.description = action.description;
      if (action.entity) {
        const e = entityByName(model(), action.entity);
        if (e) dim.entity = { model: model().id, entity: e.id };
      }
      ws.addDimension(dim);
      return ok(`Created dimension “${action.name}”`);
    }

    case "create_metric": {
      const ws = useWorkspaceStore.getState();
      if (ws.semantic.metrics.some((m) => m.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`metric “${action.name}” already exists`);
      }
      const metric = newMetric(action.name);
      if (action.aggregate) metric.aggregate = action.aggregate;
      if (action.description) metric.description = action.description;
      if (action.entity) {
        const e = entityByName(model(), action.entity);
        if (e) {
          metric.grain = { model: model().id, entity: e.id };
          if (action.field) {
            const f = fieldByName(e, action.field);
            if (f) metric.field = { model: model().id, entity: e.id, field: f.id };
          }
        }
      }
      ws.addMetric(metric);
      return ok(`Created metric “${action.name}”`);
    }

    case "create_snowflake_object": {
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if ((model().dialect ?? "postgres") !== "snowflake") {
        return skip(`Snowflake objects need a Snowflake model (this model targets ${model().dialect ?? "postgres"})`);
      }
      if ((model().snowflakeObjects ?? []).some((o) => o.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`Snowflake object “${action.name}” already exists`);
      }
      const { kind: _k, objectKind, name, ...rest } = action;
      void _k;
      const id = store.createSnowflakeObject(objectKind);
      store.updateSnowflakeObject(id, { name, ...rest });
      return ok(`Created ${objectKind} “${action.name}”`);
    }

    case "create_governance_object": {
      if (validateIdentifier(action.name)) return fail(`“${action.name}”: invalid name`);
      if ((model().dialect ?? "postgres") !== "snowflake") {
        return skip(`Governance objects need a Snowflake model (this model targets ${model().dialect ?? "postgres"})`);
      }
      if ((model().governanceObjects ?? []).some((o) => o.name.toLowerCase() === action.name.toLowerCase())) {
        return skip(`Governance object “${action.name}” already exists`);
      }
      const { kind: _k, objectKind, name, ...rest } = action;
      void _k;
      const id = store.createGovernanceObject(objectKind);
      store.updateGovernanceObject(id, { name, ...rest });
      return ok(`Created ${objectKind} “${action.name}”`);
    }

    case "delete_entity": {
      const e = entityByName(model(), action.entity);
      if (!e) return skip(`“${action.entity}” already gone`);
      store.deleteEntity(e.id);
      return ok(`Deleted ${action.entity} (and its relationships)`);
    }

    case "delete_attribute": {
      const e = entityByName(model(), action.entity);
      if (!e) return fail(`Entity “${action.entity}” not found`);
      const f = fieldByName(e, action.field);
      if (!f) return skip(`${action.entity}.${action.field} already gone`);
      store.deleteField(e.id, f.id);
      return ok(`Deleted ${action.entity}.${action.field}`);
    }

    case "delete_relationship": {
      const parent = entityByName(model(), action.parent);
      const child = entityByName(model(), action.child);
      if (!parent || !child) return fail("relationship endpoints not found");
      const rel = model().relationships.find(
        (r) =>
          (r.parentEntity === parent.id && r.childEntity === child.id) ||
          (r.parentEntity === child.id && r.childEntity === parent.id),
      );
      if (!rel) return skip(`no relationship between ${action.parent} and ${action.child}`);
      store.deleteRelationship(rel.id);
      return ok(`Deleted relationship ${action.parent}↔${action.child}`);
    }
  }
}

/** Execute an approved plan atomically and re-validate. */
export function executePlan(plan: CopilotPlan): PlanResult {
  const results: ActionResult[] = [];
  useModelStore.getState().applyAsOne(() => {
    for (const action of plan.actions) results.push(applyAction(action));
  });

  const model = useModelStore.getState().model;
  const issues = validateWorkspace({
    models: [{ id: model.id, name: model.name, model }],
    links: [],
    conceptGroups: [],
  });
  const validationErrors = issues.filter((i) => i.severity === "error").length;

  return {
    results,
    applied: results.filter((r) => r.status === "applied").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    validationErrors,
  };
}
