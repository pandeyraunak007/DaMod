// Domain model shapes. These mirror the Model file format in the requirements so
// Phase 2 persistence can serialize them almost directly. Phase 1 keeps them in
// memory only.

import { newId } from "../lib/ids";
import {
  type DataTypeKind,
  type TypeSpec,
  withTypeDefaults,
} from "./dataTypes";

export interface Position {
  x: number;
  y: number;
}

export interface Field extends TypeSpec {
  id: string;
  name: string;
  type: DataTypeKind;
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
  createdAt: string;
  updatedAt: string;
  entities: Entity[];
  relationships: Relationship[];
}

// ---- factories ---------------------------------------------------------------

export function newField(
  name: string,
  kind: DataTypeKind = "string",
  overrides: Partial<Field> = {},
): Field {
  return {
    id: newId("field"),
    name,
    nullable: true,
    primaryKey: false,
    unique: false,
    ...withTypeDefaults(kind),
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

export function newModel(name: string, now: string): Model {
  return {
    formatVersion: 1,
    id: newId("model"),
    name,
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
