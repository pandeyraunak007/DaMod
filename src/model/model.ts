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

export interface Entity {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  position: Position;
  fields: Field[];
  /** Marks an entity the tool created for a many-to-many relationship (FR-3.4). */
  junction?: boolean;
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

export interface Model {
  formatVersion: 1;
  id: string;
  name: string;
  description?: string;
  level: ModelLevel;
  /** Source model id when this model was derived from another (FR-11.7). */
  derivedFrom?: string;
  createdAt: string;
  updatedAt: string;
  entities: Entity[];
  relationships: Relationship[];
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
