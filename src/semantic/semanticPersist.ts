// Deterministic serialization and validation for semantic.json (FR-5.5–5.7).

import { z } from "zod";
import { type ParseResult, CURRENT_FORMAT_VERSION } from "../persist/schema";
import {
  AGGREGATES,
  DERIVED_OPS,
  FILTER_OPS,
  type Dimension,
  type FieldRef,
  type Metric,
  type SemanticDoc,
  type Term,
  type TermBinding,
} from "./semantic";

function fieldRef(r: FieldRef): Record<string, unknown> {
  return { model: r.model, entity: r.entity, field: r.field };
}
function entityRef(r: { model: string; entity: string }): Record<string, unknown> {
  return { model: r.model, entity: r.entity };
}

function binding(b: TermBinding): Record<string, unknown> {
  if ("concept" in b) return { concept: b.concept };
  if ("field" in b) return fieldRef(b);
  return entityRef(b);
}

function serializeTerm(t: Term): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, name: t.name, definition: t.definition };
  if (t.synonyms && t.synonyms.length) out.synonyms = [...t.synonyms];
  if (t.bindings && t.bindings.length) out.bindings = t.bindings.map(binding);
  return out;
}

function serializeDimension(d: Dimension): Record<string, unknown> {
  const out: Record<string, unknown> = { id: d.id, name: d.name };
  if (d.description) out.description = d.description;
  if (d.concept) out.concept = d.concept;
  if (d.entity) out.entity = entityRef(d.entity);
  if (d.attributes && d.attributes.length) {
    out.attributes = d.attributes.map((a) => ({ name: a.name, field: fieldRef(a.field) }));
  }
  if (d.time) out.time = true;
  if (d.field) out.field = fieldRef(d.field);
  return out;
}

function serializeMetric(m: Metric): Record<string, unknown> {
  const out: Record<string, unknown> = { id: m.id, name: m.name, key: m.key };
  if (m.description) out.description = m.description;
  if (m.aggregate) out.aggregate = m.aggregate;
  if (m.field) out.field = fieldRef(m.field);
  if (m.grain) out.grain = entityRef(m.grain);
  if (m.filters && m.filters.length) {
    out.filters = m.filters.map((f) => {
      const fo: Record<string, unknown> = { field: fieldRef(f.field), op: f.op };
      if (f.value !== undefined && f.value !== "") fo.value = f.value;
      return fo;
    });
  }
  if (m.derived) out.derived = { left: m.derived.left, op: m.derived.op, right: m.derived.right };
  return out;
}

export function serializeSemantic(doc: SemanticDoc): string {
  const out = {
    formatVersion: doc.formatVersion,
    terms: doc.terms.map(serializeTerm),
    dimensions: doc.dimensions.map(serializeDimension),
    metrics: doc.metrics.map(serializeMetric),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

const zFieldRef = z.object({ model: z.string(), entity: z.string(), field: z.string() });
const zEntityRef = z.object({ model: z.string(), entity: z.string() });
const zConcept = z.object({ concept: z.string() });
const zBinding = z.union([zConcept, zFieldRef, zEntityRef]);

const zTerm = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.string(),
  synonyms: z.array(z.string()).optional(),
  bindings: z.array(zBinding).optional(),
});

const zDimension = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  concept: z.string().optional(),
  entity: zEntityRef.optional(),
  attributes: z.array(z.object({ name: z.string(), field: zFieldRef })).optional(),
  time: z.boolean().optional(),
  field: zFieldRef.optional(),
});

const zMetric = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().optional(),
  aggregate: z.enum(AGGREGATES as unknown as [string, ...string[]]).optional(),
  field: zFieldRef.optional(),
  grain: zEntityRef.optional(),
  filters: z
    .array(
      z.object({
        field: zFieldRef,
        op: z.enum(FILTER_OPS as unknown as [string, ...string[]]),
        value: z.string().optional(),
      }),
    )
    .optional(),
  derived: z
    .object({
      left: z.string(),
      op: z.enum(DERIVED_OPS as unknown as [string, ...string[]]),
      right: z.string(),
    })
    .optional(),
});

const zSemanticDoc = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  terms: z.array(zTerm).optional().default([]),
  dimensions: z.array(zDimension).optional().default([]),
  metrics: z.array(zMetric).optional().default([]),
});

export function parseSemanticFile(text: string): ParseResult<SemanticDoc> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "semantic.json is not a JSON object" };
  }
  const version = (raw as Record<string, unknown>).formatVersion;
  if (typeof version !== "number") return { ok: false, error: "Missing formatVersion" };
  if (version > CURRENT_FORMAT_VERSION) {
    return { ok: false, error: `semantic.json format ${version} is newer than supported` };
  }
  const parsed = zSemanticDoc.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    return { ok: false, error: path ? `${path}: ${issue.message}` : issue.message };
  }
  return { ok: true, value: parsed.data as SemanticDoc };
}
