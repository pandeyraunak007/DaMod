// The semantic layer (FR-7): workspace-level business meaning over entities and
// fields from any model. Three object types — terms, dimensions, metrics — bind
// to concept groups, entities or fields by ID, so they stay valid through renames.

import { newId } from "../lib/ids";

/** A reference to a field in some model. */
export interface FieldRef {
  model: string;
  entity: string;
  field: string;
}

/** A reference to an entity in some model. */
export interface EntityRef {
  model: string;
  entity: string;
}

/** A term binding is to a concept group, an entity, or a field. */
export type TermBinding = { concept: string } | EntityRef | FieldRef;

export interface Term {
  id: string;
  name: string;
  definition: string;
  synonyms?: string[];
  bindings?: TermBinding[];
}

export interface DimensionAttribute {
  name: string;
  field: FieldRef;
}

export interface Dimension {
  id: string;
  name: string;
  description?: string;
  /** Bound to a concept group, or a single entity when nothing is linked. */
  concept?: string;
  entity?: EntityRef;
  attributes?: DimensionAttribute[];
  /** A time dimension is bound to a date/timestamp field with standard grains. */
  time?: boolean;
  field?: FieldRef;
}

export const TIME_GRAINS = ["day", "week", "month", "quarter", "year"] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

export const AGGREGATES = ["sum", "count", "count_distinct", "avg", "min", "max"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export const FILTER_OPS = ["=", "!=", "<", "<=", ">", ">=", "in", "is null", "is not null"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface MetricFilter {
  field: FieldRef;
  op: FilterOp;
  value?: string;
}

export const DERIVED_OPS = ["+", "-", "*", "/"] as const;
export type DerivedOp = (typeof DERIVED_OPS)[number];

export interface Metric {
  id: string;
  name: string;
  key: string;
  description?: string;
  // Aggregate metric:
  aggregate?: Aggregate;
  field?: FieldRef;
  grain?: EntityRef;
  filters?: MetricFilter[];
  // Derived metric (combines up to two existing metrics):
  derived?: { left: string; op: DerivedOp; right: string };
}

export interface SemanticDoc {
  formatVersion: 1;
  terms: Term[];
  dimensions: Dimension[];
  metrics: Metric[];
}

export function emptySemanticDoc(): SemanticDoc {
  return { formatVersion: 1, terms: [], dimensions: [], metrics: [] };
}

/**
 * Derive an identifier-safe key from a name (FR-7.11). Names may contain spaces;
 * the key is snake_case, lower-cased, safe for export. Example:
 * "Average order value" -> "average_order_value".
 */
export function deriveKey(name: string): string {
  const key = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (key.length === 0) return "metric";
  return /^[0-9]/.test(key) ? `_${key}` : key;
}

export function newTerm(name: string): Term {
  return { id: newId("term"), name, definition: "" };
}

export function newDimension(name: string): Dimension {
  return { id: newId("dimension"), name };
}

export function newMetric(name: string): Metric {
  return { id: newId("metric"), name, key: deriveKey(name), aggregate: "count" };
}
