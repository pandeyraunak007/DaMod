# Reusable Definitions & Standards (erwin-style governance)

Reference for DaMod's reusable modeling governance: **Domains**, **Naming Standards**,
**Data Type Standards**, and their **Copilot** actions. Built in phases 1–5 of the
standards roadmap (see `DECISIONS.md`, newest entries). All are **per-model**, stored in
the model JSON (additive + migration-free — older files load unchanged), mutate only
through `modelStore` ops (single undo steps), and are validated by `validateWorkspace`.

## Shared principles

- **One engine, reused.** No feature forks the model engine, the fixed canonical type
  set, the per-dialect DDL renderers, or the Copilot execute path. Standards are a thin,
  pure layer on top.
- **Check never mutates; apply is explicit.** Compliance/preview functions are pure and
  read-only; applying a standard is a separate, user-initiated, undoable action.
- **Stable IDs.** Relationships/links reference objects by id, so any rename is safe for
  referential integrity — name sync (FK mirroring) is cosmetic.
- **Precedence:** explicit column type override > bound **domain** > **type standard**
  default. A type standard never touches a domain-bound column.

## Domains (`model.domains`)

Reusable named types. `Domain = { id, name, type, length?/precision?/scale?,
logicalType?, default?, description? }`.

- Manage: `DomainsDialog` (modal) **or** the Model Explorer **Domains** group; bind from
  either inspector (modal `PropertiesDialog` or docked `SidePanel`) via a shared
  `DomainSelect`. Store: `createDomain`/`updateDomain`/`bindFieldDomain`.
- Editing a domain propagates its type to every bound field (+ FK reconcile). Editing a
  field's physical type **detaches** it from the domain (erwin detach-on-override).
- **Delete is dependency-aware** (`DomainDeleteDialog`): lists bound columns and requires
  **detach** (keep current type) or **reassign** to another domain — never a silent
  conversion. `deleteDomainResolved(id, mode, replacementId?)`, one undo.
- Validation: `domainIssues` (dup names, invalid identifier, dangling binding).
- **Not yet:** Postgres `CREATE DOMAIN` DDL emit + reverse-eng of domains (opt-in,
  deferred — would change DDL output).

## Naming Standards (`model.namingStandards`) — `src/model/naming.ts`

Reusable identifier conventions. `NamingStandard = { id, name, description?, rules[],
mirrorForeignKeys? }`; `NamingRule = { target: entity|attribute|index, case, prefix?,
suffix?, maxLength? }`. Cases: `snake_case | screaming_snake | pascal | camel | preserve`.

- **Engine (pure):** `toWords` (handles snake/kebab/space/camel/Pascal/ACRONYM),
  `applyNamingRule` (idempotent affixes), `checkNaming` → violations (current/proposed/
  reasons), `previewNaming` → changes + **scope-aware collisions** + the exact ids to skip.
- **FK mirroring** (per-standard toggle, default on): on apply, an FK column adopts its
  parent PK column's final name. `mirrorsForeignKeys(std)`.
- **Apply:** `applyNamingStandard(id)` renames every non-colliding, valid-identifier
  change as ONE undo step, preserving ids; skips collisions/invalid; returns
  `{applied, skipped, collisions}`.
- UI: `NamingStandardsDialog` (ribbon **Naming**) — rules editor, mirror toggle, live
  read-only preview with collision warnings, explicit **Apply**.

## Data Type Standards (`model.typeStandards`) — `src/model/typeStandards.ts`

Reusable **type-parameter** policies + dialect lossy surfacing. `TypeStandard = { id,
name, description?, rules[] }`; `TypeRule = { type, length?/precision?/scale? }`.

- **Engine (pure):** `checkTypes` flags columns whose params deviate (current/proposed/
  reasons), **skipping no-physical-type and domain-bound columns**. `lossyTypeWarnings`
  flags canonical→dialect mappings with no native equivalent (uuid on Snowflake/MySQL/
  BigQuery/Databricks; json on Oracle/SQL Server/Databricks; boolean on Oracle).
- **Apply:** `applyTypeStandard(id)` normalises params as ONE undo step, then
  `reconcileForeignKeyTypes` so FK params follow a normalised PK.
- Deliberately **does not** remap one canonical type to another or fork the per-dialect
  renderers (deferred: editable per-dialect mapping profiles — would change DDL output).
- UI: `TypeStandardsDialog` (ribbon **Types**) — shape-aware rules editor, live preview,
  lossy warnings for the model's dialect, explicit **Apply**.

## Copilot (`src/copilot/`)

Create + apply, through the SAME action→`execute.ts`→store path as the UI (reviewed,
approved, one undo group, idempotent — never direct JSON/Zustand mutation):

- `create_naming_standard`, `apply_naming_standard`, `create_type_standard`,
  `apply_type_standard` (all STRUCTURAL → require approval). Apply operates by standard
  name. `create_domain` already existed.
- **Read-only compliance** is answered from CONTEXT, not a new execution path:
  `context.ts` lists each standard with a **live off-standard count** and populates the
  `namingStandards` + `validation` privacy categories. Only names + counts reach the LLM —
  never column data.
- **Deferred:** Copilot domain apply/replace/detach; update/delete of standards; a real
  before/after diff in the plan card (currently a textual action list).

## Deferred backlog (gated / lower priority)

- Postgres `CREATE DOMAIN` DDL + reverse-eng of domains (opt-in; changes DDL output).
- Naming auto-apply to newly created objects (opt-in, off by default).
- Reserved-word lists + per-dialect identifier length limits (today: Postgres 63-char).
- Editable per-dialect **type mapping profiles** (override canonical→physical rendering).
- Explorer nodes for Naming/Type standards; Copilot domain/standard update+delete actions.
