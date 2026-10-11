// Domain model shapes. These mirror the Model file format in the requirements so
// Phase 2 persistence can serialize them almost directly. Phase 1 keeps them in
// memory only.

import { newId } from "../lib/ids";
import { type DataTypeKind, withTypeDefaults } from "./dataTypes";
import type { LogicalTypeKind, ModelLevel } from "./levels";
import { usesPhysicalTypes } from "./levels";

export type { LogicalTypeKind } from "./levels";

export interface Position {
  x: number;
  y: number;
}

/** A user-defined property (ERwin UDP): an arbitrary named value on any object. */
export interface Udp {
  name: string;
  value: string;
}

/** Referential-integrity action on a foreign key (ERwin RI). */
export type RiAction = "no action" | "cascade" | "restrict" | "set null" | "set default";

/**
 * Dimensional role of a column on a fact table (Kimball):
 *   measure    — an additive numeric fact column (the thing you aggregate)
 *   degenerate — a dimension attribute stored on the fact with no separate
 *                dimension table (e.g. order_number, invoice_id)
 */
export type FieldRole = "measure" | "degenerate";

export interface Field {
  id: string;
  name: string;
  /** Physical (Postgres) type — present at Physical and Physical/Logical levels. */
  type?: DataTypeKind;
  length?: number;
  precision?: number;
  scale?: number;
  /** Generic type — present at Logical and Physical/Logical levels (FR-11.3). */
  logicalType?: LogicalTypeKind;
  /** Hybrid logical name shown beside the physical column (FR-11.5). */
  logicalName?: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  default?: string;
  description?: string;
  /** Bound reusable domain (ERwin). When set, the field's physical type is
   *  governed by the domain and changes to the domain propagate here. */
  domainId?: string;
  /** Dimensional role on a fact table (Kimball measure / degenerate dimension). */
  role?: FieldRole;
  note?: string;
  udps?: Udp[];
  /** Discovery provenance (Req 22 §7) — chiefly the source-native type; absent for
   *  hand-authored fields. */
  source?: ObjectSource;
}

/**
 * A reusable named type (ERwin domain): a physical type spec authored once and
 * bound to many fields, so changing the domain updates every field that uses it.
 * Lives on the model alongside views/indexes/sequences.
 */
export interface Domain {
  id: string;
  name: string;
  type: DataTypeKind;
  length?: number;
  precision?: number;
  scale?: number;
  logicalType?: LogicalTypeKind;
  /** Default SQL applied to a field when it has none of its own. */
  default?: string;
  description?: string;
}

export type Stereotype = "fact" | "dimension";

/** Discovery provenance for a reverse-engineered object (Req 21 Phase 2). Lets a
 *  re-discovery match an existing model object by its stable source identifier so
 *  repeated imports update in place instead of duplicating (§6/AC-6), and records
 *  where an EBS object's product/relationship mapping came from (§5/§7). Absent for
 *  hand-authored objects. */
export interface ObjectSource {
  /** Source system type, e.g. "oracle-ebs" / "postgres". */
  system?: string;
  /** Source schema the object was discovered in. */
  schema?: string;
  /** Stable source identifier (e.g. "AP.AP_INVOICES_ALL"); the match key. */
  nativeId?: string;
  /** The source's own type spelling, verbatim (columns only), e.g. "NUMBER(15)",
   *  "VARCHAR2(240)", "timestamptz" — preserved even when the normalized type loses it. */
  nativeType?: string;
  /** EBS product/module short code (e.g. "AP"). */
  product?: string;
  /** How this object's mapping was established (see RELATIONSHIP_PROVENANCE kin). */
  provenance?: string;
  /** 0..1 confidence for inferred mappings. */
  confidence?: number;
  /** Fusion Cloud REST resource path (Req 22 §7), e.g. ".../invoices". */
  apiPath?: string;
  /** Fusion Cloud REST API version. */
  apiVersion?: string;
}

/** Physical table variant (Req 23 §4.1). Different kinds have different properties
 *  and constraint-enforcement behavior (hybrid tables enforce keys; standard ones
 *  don't). Undefined = a standard table. */
export const TABLE_KINDS = ["standard", "temporary", "transient", "external", "hybrid"] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

export interface Entity {
  id: string;
  /** Physical/identifier name (used for references and DDL). */
  name: string;
  /** Optional logical/business name shown at Conceptual/Logical levels (e.g. a
   *  "Customer" entity whose physical table is "dim_customer"). Mirrors a field's
   *  `logicalName`. Free text; never used for DDL or references. */
  logicalName?: string;
  description?: string;
  tags?: string[];
  position: Position;
  fields: Field[];
  /** Marks an entity the tool created for a many-to-many relationship (FR-3.4). */
  junction?: boolean;
  /** Dimensional-modeling role (star schema). */
  stereotype?: Stereotype;
  note?: string;
  udps?: Udp[];
  /** Owning schema name (Req 19). Default/undefined means the public schema. */
  schema?: string;
  /** Physical table variant (Req 23 §4.1). Undefined = standard. */
  tableKind?: TableKind;
  /** Table-level CHECK constraints (Req 19). */
  checks?: CheckConstraint[];
  /** Discovery provenance (Req 21 Phase 2); absent for hand-authored entities. */
  source?: ObjectSource;
}

export type Cardinality = "one-to-one" | "one-to-many" | "many-to-many";

export interface Relationship {
  id: string;
  label?: string;
  description?: string;
  cardinality: Cardinality;
  /**
   * Identifying relationship (IDEF1X): the foreign key is part of the child's
   * primary key, drawn as a solid line. Non-identifying (default) is dashed.
   */
  identifying?: boolean;
  /**
   * Subtype/category relationship: parent is the supertype, child a subtype that
   * shares the supertype's primary key. Rendered with a category symbol.
   */
  subtype?: boolean;
  /** The side that holds the primary key. */
  parentEntity: string;
  /** The side that holds the foreign key. */
  childEntity: string;
  parentOptional: boolean;
  childOptional: boolean;
  /** FK field IDs on the child; empty for many-to-many (the junction carries them). */
  foreignKeyFields: string[];
  /** Present only for many-to-many. */
  junctionEntity?: string;
  /** Child→parent verb phrase (ERwin inverse verb phrase). `label` is parent→child. */
  childVerbPhrase?: string;
  /** Referential-integrity actions on the foreign key (ERwin RI). */
  onDelete?: RiAction;
  onUpdate?: RiAction;
  /** Whether the FK is physically ENFORCED by the target DB (Req 23 §4.2). Snowflake
   *  standard tables DECLARE but do NOT enforce FKs; only hybrid tables enforce. When
   *  unset, enforcement is derived from the child table's kind. Never imply a
   *  relationship is enforced when the target DB does not enforce it. */
  enforced?: boolean;
  note?: string;
  udps?: Udp[];
}

export type Notation = "IE" | "IDEF1X";

// ---- other physical/logical database objects --------------------------------

/** A database view: a named SQL query. Rendered on the canvas and exported.
 *  A materialized view sets `materialized` (Req 19) — it is the same object with
 *  different DDL (`CREATE MATERIALIZED VIEW`) and a storage/refresh option. */
export interface View {
  id: string;
  name: string;
  /** The SQL SELECT body (raw, exported verbatim). */
  definition: string;
  materialized?: boolean;
  /** Materialized-view only: create `WITH NO DATA` (populate later via REFRESH). */
  withNoData?: boolean;
  /** Source entity ids, for drawing canvas lines (optional). */
  sources?: string[];
  position: Position;
}

/** A table-level CHECK constraint (Req 19). The expression is exported verbatim
 *  inside `CHECK (...)`; it depends on the owning table's columns. */
export interface CheckConstraint {
  id: string;
  name: string;
  expression: string;
}

/** An index over one or more of an entity's columns. */
export interface Index {
  id: string;
  name: string;
  entity: string;
  fields: string[];
  unique?: boolean;
}

/** A sequence generator. */
export interface Sequence {
  id: string;
  name: string;
  start?: number;
  increment?: number;
}

/** A database schema / namespace (Req 19). A cluster-level container that owns
 *  tables, views, sequences, etc. Modeled as a first-class object with its own
 *  DDL (`CREATE SCHEMA`); table→schema name-qualification is a later increment. */
export interface SchemaObj {
  id: string;
  name: string;
  owner?: string;
  comment?: string;
}

/** A subject area (Req 21 §6): a named grouping of entities for focus/navigation —
 *  e.g. one per EBS product ("Payables", "General Ledger") or business process. It is
 *  a lens over the model, not a container: an entity may belong to several areas and
 *  deleting an area never deletes entities. */
export interface SubjectArea {
  id: string;
  name: string;
  description?: string;
  /** Member entity ids. */
  entities: string[];
  /** EBS product short code this area was derived from, if any (e.g. "AP"). */
  product?: string;
}

/** Snowflake data-engineering objects (Req 23 §5): ingestion/transformation objects
 *  with per-kind definitions and DDL. One flexible shape (kind-discriminated) rather
 *  than six near-identical collections; only the fields relevant to each kind are used. */
export const SNOWFLAKE_OBJECT_KINDS = ["stage", "fileFormat", "pipe", "stream", "task", "dynamicTable"] as const;
export type SnowflakeObjectKind = (typeof SNOWFLAKE_OBJECT_KINDS)[number];

export interface SnowflakeObject {
  id: string;
  kind: SnowflakeObjectKind;
  name: string;
  comment?: string;
  // stage
  stageType?: "internal" | "external";
  url?: string;
  fileFormat?: string; // referenced file-format name
  // fileFormat
  formatType?: string; // CSV / JSON / PARQUET / AVRO / ORC / XML
  options?: string; // raw format / copy options
  // pipe
  copyStatement?: string; // COPY INTO …
  autoIngest?: boolean;
  // stream
  sourceObject?: string;
  streamType?: "standard" | "append_only" | "insert_only";
  // task / dynamicTable
  warehouse?: string;
  schedule?: string; // task
  sql?: string; // task body / dynamic-table query
  after?: string; // task: parent task
  targetLag?: string; // dynamicTable
}

export type DbDialect = "postgres" | "snowflake" | "databricks" | "oracle" | "sqlserver" | "mysql" | "bigquery";

/** A free-form, dialect-specific object (Snowflake stage/stream/task, Databricks
 *  table properties, etc.) whose SQL body is exported verbatim for its dialect. */
export interface RawObject {
  id: string;
  name: string;
  dialect: DbDialect;
  kind?: string;
  sql: string;
}

export interface Model {
  formatVersion: 1;
  id: string;
  name: string;
  description?: string;
  level: ModelLevel;
  /** Target database dialect for physical modeling (Req 17). Authoritative default
   *  for physical types, DDL, validation and reverse-engineering. Only meaningful at
   *  physical levels; absent for Conceptual/Logical (database-independent). Older
   *  models written before Req 17 have none — `modelDialect` supplies the default. */
  dialect?: DbDialect;
  /** Diagram notation (default IE crow's-foot). */
  notation?: Notation;
  /** Source model id when this model was derived from another (FR-11.7). */
  derivedFrom?: string;
  createdAt: string;
  updatedAt: string;
  entities: Entity[];
  relationships: Relationship[];
  schemas?: SchemaObj[];
  subjectAreas?: SubjectArea[];
  snowflakeObjects?: SnowflakeObject[];
  views?: View[];
  indexes?: Index[];
  sequences?: Sequence[];
  rawObjects?: RawObject[];
  domains?: Domain[];
}

// ---- factories ---------------------------------------------------------------

/**
 * Create a field. Pass a physical `kind` for a typed (physical) field, or omit
 * it for a typeless field (Conceptual, or a Logical field that only carries a
 * logicalType via overrides).
 */
export function newField(
  name: string,
  kind?: DataTypeKind,
  overrides: Partial<Field> = {},
): Field {
  return {
    id: newId("field"),
    name,
    nullable: true,
    primaryKey: false,
    unique: false,
    ...(kind ? withTypeDefaults(kind) : {}),
    ...overrides,
  };
}

export function newEntity(
  name: string,
  position: Position,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id: newId("entity"),
    name,
    position,
    fields: [],
    ...overrides,
  };
}

export function newView(name: string, position: Position): View {
  return { id: newId("view"), name, definition: "SELECT\n", position };
}

export function newIndex(name: string, entity: string): Index {
  return { id: newId("index"), name, entity, fields: [] };
}

export function newSequence(name: string): Sequence {
  return { id: newId("sequence"), name, start: 1, increment: 1 };
}

export function newCheckConstraint(name: string, expression = ""): CheckConstraint {
  return { id: newId("check"), name, expression };
}

export function newSchemaObject(name: string): SchemaObj {
  return { id: newId("schema"), name };
}

export function newSubjectArea(name: string, entities: string[] = [], product?: string): SubjectArea {
  return { id: newId("subjectArea"), name, entities, ...(product ? { product } : {}) };
}

export function newSnowflakeObject(kind: SnowflakeObjectKind, name: string): SnowflakeObject {
  const base: SnowflakeObject = { id: newId("snowflakeObject"), kind, name };
  if (kind === "stage") base.stageType = "internal";
  if (kind === "fileFormat") base.formatType = "CSV";
  if (kind === "stream") base.streamType = "standard";
  return base;
}

export function newRawObject(name: string, dialect: DbDialect): RawObject {
  return { id: newId("rawObject"), name, dialect, sql: "" };
}

export function newDomain(name: string, kind: DataTypeKind = "string"): Domain {
  return { id: newId("domain"), name, ...withTypeDefaults(kind) };
}

export function newModel(
  name: string,
  now: string,
  level: ModelLevel = "Physical",
  dialect?: DbDialect,
): Model {
  return {
    formatVersion: 1,
    id: newId("model"),
    name,
    level,
    // Database-independent levels carry no dialect (Req 17 §3).
    ...(dialect && usesPhysicalTypes(level) ? { dialect } : {}),
    createdAt: now,
    updatedAt: now,
    entities: [],
    relationships: [],
  };
}

/** The authoritative dialect for a model's physical operations. Falls back to
 *  Postgres for models written before Req 17 (compatibility default — see §4). */
export function modelDialect(model: Model): DbDialect {
  return model.dialect ?? "postgres";
}

// ---- lookups -----------------------------------------------------------------

export function findEntity(model: Model, id: string): Entity | undefined {
  return model.entities.find((e) => e.id === id);
}

export function findField(entity: Entity, id: string): Field | undefined {
  return entity.fields.find((f) => f.id === id);
}

export function primaryKeyFields(entity: Entity): Field[] {
  return entity.fields.filter((f) => f.primaryKey);
}
