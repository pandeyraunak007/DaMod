// Req 19 §9 — the canonical PostgreSQL object registry. ONE source of truth that
// describes every object type from the erwin PostgreSQL Support Summary and, for
// each, what DaMod actually implements. It deliberately records honest capability
// flags (not aspirational ones): `support: "full"` means the whole lifecycle
// (create → edit → validate → persist → DDL) exists and is tested; "partial" means
// some of it; "none" means the type is catalogued for the roadmap but not built.
//
// Used to drive the capability matrix (docs/POSTGRES_OBJECTS.md), capability
// indicators, and future registry-driven Explorer/context-menu work. A test
// (objectRegistry.test.ts) checks the "full" rows against the real model/store so
// the registry can never drift into claiming unimplemented support.

import type { ModelLevel } from "./levels";

export type PgObjectId =
  | "database"
  | "schema"
  | "table"
  | "column"
  | "primaryKey"
  | "foreignKey"
  | "uniqueConstraint"
  | "checkConstraint"
  | "index"
  | "view"
  | "materializedView"
  | "sequence"
  | "domain"
  | "rawObject"
  | "trigger"
  | "function"
  | "procedure"
  | "eventTrigger"
  | "userDefinedType"
  | "cast"
  | "collation"
  | "extension"
  | "language"
  | "accessMethod"
  | "server"
  | "tablespace"
  | "transform"
  | "role"
  | "permission"
  | "statistics"
  | "comment";

/** Honest implementation status (Req 19 §12). */
export type Support = "full" | "partial" | "none";

export interface PgObjectCaps {
  create: boolean;
  edit: boolean;
  delete: boolean;
  properties: boolean;
  validation: boolean;
  ddl: boolean;
  reverseEngineer: boolean;
  compare: boolean;
}

export interface PgObjectType {
  id: PgObjectId;
  label: string;
  plural: string;
  /** Valid parent scopes; `[]` means a database-cluster-level root. */
  parents: PgObjectId[];
  /** Modeling levels where the object is visible/editable (Req 19 §8). */
  levels: ModelLevel[];
  support: Support;
  caps: PgObjectCaps;
  /** The `Model` collection / field that backs it, or null when not yet built. */
  backing: string | null;
  notes?: string;
}

const PHYSICAL: ModelLevel[] = ["Physical/Logical", "Physical"];
const ALL_LEVELS: ModelLevel[] = ["Conceptual", "Logical", "Physical/Logical", "Physical"];
const LOGICAL_UP: ModelLevel[] = ["Logical", "Physical/Logical", "Physical"];

const no: PgObjectCaps = {
  create: false,
  edit: false,
  delete: false,
  properties: false,
  validation: false,
  ddl: false,
  reverseEngineer: false,
  compare: false,
};
const full: PgObjectCaps = {
  create: true,
  edit: true,
  delete: true,
  properties: true,
  validation: true,
  ddl: true,
  reverseEngineer: true,
  compare: true,
};

export const PG_OBJECTS: PgObjectType[] = [
  // ---- core relational (implemented) ---------------------------------------
  {
    id: "table",
    label: "Table",
    plural: "Tables",
    parents: ["schema", "database"],
    levels: ALL_LEVELS,
    support: "full",
    caps: full,
    backing: "entities",
  },
  {
    id: "column",
    label: "Column",
    plural: "Columns",
    parents: ["table"],
    levels: ALL_LEVELS,
    support: "full",
    caps: full,
    backing: "entities[].fields",
  },
  {
    id: "primaryKey",
    label: "Primary key",
    plural: "Primary keys",
    parents: ["table"],
    levels: LOGICAL_UP,
    support: "full",
    caps: full,
    backing: "entities[].fields[].primaryKey",
  },
  {
    id: "foreignKey",
    label: "Foreign key",
    plural: "Foreign keys",
    parents: ["table"],
    levels: LOGICAL_UP,
    support: "full",
    caps: full,
    backing: "relationships",
  },
  {
    id: "uniqueConstraint",
    label: "Unique constraint",
    plural: "Unique constraints",
    parents: ["table"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "entities[].fields[].unique",
  },
  {
    id: "checkConstraint",
    label: "Check constraint",
    plural: "Check constraints",
    parents: ["table"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "entities[].checks",
  },
  {
    id: "index",
    label: "Index",
    plural: "Indexes",
    parents: ["table"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "indexes",
  },
  {
    id: "view",
    label: "View",
    plural: "Views",
    parents: ["schema", "database"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "views",
  },
  {
    id: "materializedView",
    label: "Materialized view",
    plural: "Materialized views",
    parents: ["schema", "database"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "views[].materialized",
  },
  {
    id: "sequence",
    label: "Sequence",
    plural: "Sequences",
    parents: ["schema", "database"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "sequences",
  },
  {
    id: "schema",
    label: "Schema",
    plural: "Schemas",
    parents: ["database"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "schemas",
    notes: "Table→schema name-qualification in DDL is a later increment.",
  },
  {
    id: "domain",
    label: "Domain",
    plural: "Domains",
    parents: ["schema", "database"],
    levels: PHYSICAL,
    support: "full",
    caps: full,
    backing: "domains",
    notes: "Reusable named type; bind/propagate implemented. CREATE DOMAIN DDL deferred.",
  },
  {
    id: "rawObject",
    label: "Raw object",
    plural: "Raw objects",
    parents: ["schema", "database"],
    levels: PHYSICAL,
    support: "full",
    caps: { ...full, reverseEngineer: false, compare: false },
    backing: "rawObjects",
    notes: "Escape hatch: dialect-specific SQL exported verbatim (covers unsupported types).",
  },
  {
    id: "comment",
    label: "Comment",
    plural: "Comments",
    parents: ["table", "column"],
    levels: PHYSICAL,
    support: "partial",
    caps: { ...no, create: true, edit: true, delete: true, properties: true, ddl: true },
    backing: "entities[].description / fields[].description",
    notes: "Stored as object descriptions; COMMENT ON emitted. Not a free-standing object.",
  },

  // ---- catalogued, NOT yet implemented (roadmap, Req 19 Phases 3–5) ---------
  { id: "database", label: "Database", plural: "Databases", parents: [], levels: PHYSICAL, support: "partial", caps: { ...no, properties: true }, backing: "model.name + model.dialect", notes: "The model itself is the database; no separate editable object yet." },
  { id: "trigger", label: "Trigger", plural: "Triggers", parents: ["table", "view"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 4." },
  { id: "function", label: "Function", plural: "Functions", parents: ["schema"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 4." },
  { id: "procedure", label: "Stored procedure", plural: "Stored procedures", parents: ["schema"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 4." },
  { id: "eventTrigger", label: "Event trigger", plural: "Event triggers", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 4." },
  { id: "userDefinedType", label: "User-defined type", plural: "User-defined types", parents: ["schema"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 3 (enum/composite/range)." },
  { id: "cast", label: "Cast", plural: "Casts", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 3." },
  { id: "collation", label: "Collation", plural: "Collations", parents: ["schema"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 3." },
  { id: "extension", label: "Extension", plural: "Extensions", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 3." },
  { id: "language", label: "Language", plural: "Languages", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 3." },
  { id: "accessMethod", label: "Access method", plural: "Access methods", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5." },
  { id: "server", label: "Foreign server", plural: "Servers", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5." },
  { id: "tablespace", label: "Tablespace", plural: "Tablespaces", parents: [], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5 (cluster-level)." },
  { id: "transform", label: "Transform", plural: "Transforms", parents: ["database"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5." },
  { id: "role", label: "Role", plural: "Roles & permissions", parents: [], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5 (cluster-level)." },
  { id: "permission", label: "Permission", plural: "Permissions", parents: ["schema", "table", "view", "sequence", "function"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5 (grants/revokes)." },
  { id: "statistics", label: "Statistics", plural: "Statistics", parents: ["table"], levels: PHYSICAL, support: "none", caps: no, backing: null, notes: "Phase 5." },
];

const BY_ID = new Map<PgObjectId, PgObjectType>(PG_OBJECTS.map((o) => [o.id, o]));

export function pgObject(id: PgObjectId): PgObjectType | undefined {
  return BY_ID.get(id);
}

/** Object types visible at a modeling level (Req 19 §8). */
export function pgObjectsForLevel(level: ModelLevel): PgObjectType[] {
  return PG_OBJECTS.filter((o) => o.levels.includes(level));
}

/** Object types whose create/edit/persist lifecycle is actually implemented. */
export function implementedPgObjects(): PgObjectType[] {
  return PG_OBJECTS.filter((o) => o.support === "full");
}

/** Child object types valid under a given parent scope. */
export function childObjectTypes(parent: PgObjectId): PgObjectType[] {
  return PG_OBJECTS.filter((o) => o.parents.includes(parent));
}
