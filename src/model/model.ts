// Domain model shapes. These mirror the Model file format in the requirements so
// Phase 2 persistence can serialize them almost directly. Phase 1 keeps them in
// memory only.

import { newId } from "../lib/ids";
import { type DataTypeKind, withTypeDefaults } from "./dataTypes";
import type { LogicalTypeKind, ModelLevel } from "./levels";

export interface Position {
  x: number;
  y: number;
}

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
}

export type Stereotype = "fact" | "dimension";

export interface Entity {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  position: Position;
  fields: Field[];
  /** Marks an entity the tool created for a many-to-many relationship (FR-3.4). */
  junction?: boolean;
  /** Dimensional-modeling role (star schema). */
  stereotype?: Stereotype;
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
}

export type Notation = "IE" | "IDEF1X";

// ---- other physical/logical database objects --------------------------------

/** A database view: a named SQL query. Rendered on the canvas and exported. */
export interface View {
  id: string;
  name: string;
  /** The SQL SELECT body (raw, exported verbatim). */
  definition: string;
  materialized?: boolean;
  /** Source entity ids, for drawing canvas lines (optional). */
  sources?: string[];
  position: Position;
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

export type DbDialect = "postgres" | "snowflake" | "databricks";

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
  /** Diagram notation (default IE crow's-foot). */
  notation?: Notation;
  /** Source model id when this model was derived from another (FR-11.7). */
  derivedFrom?: string;
  createdAt: string;
  updatedAt: string;
  entities: Entity[];
  relationships: Relationship[];
  views?: View[];
  indexes?: Index[];
  sequences?: Sequence[];
  rawObjects?: RawObject[];
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

export function newRawObject(name: string, dialect: DbDialect): RawObject {
  return { id: newId("rawObject"), name, dialect, sql: "" };
}

export function newModel(name: string, now: string, level: ModelLevel = "Physical"): Model {
  return {
    formatVersion: 1,
    id: newId("model"),
    name,
    level,
    createdAt: now,
    updatedAt: now,
    entities: [],
    relationships: [],
  };
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
