# Decision log

Claude Code keeps this log so the author can read *what was chosen and why*
instead of the code (per the "Working context and verification" section of the
requirements). Newest entries at the top. Each entry: what, why, and what was
deliberately not done.

## 2026-10-10 — Connector framework & ETL platform (Phase 1 foundation)

New direction: extend the app into a local-first data-modeling **and ETL design**
platform with a reusable connector framework (discover → model → compare → plan
pipelines). This is an **extension, not a rewrite** — all existing modeling,
persistence, DDL export, semantic layer and validation are preserved. Full
contract reference lives in `docs/CONNECTORS.md`; roadmap phases 0–9.

**Phase 0 audit (verified, not assumed):** git clean at `b73e123`, 121 tests
pass, typecheck + build clean, ~12.4k lines (incl. tests). Confirmed reusable
pieces: model factories + fixed type set, `mapSqlType`, `diffModels`/
`generateMigration`, the deterministic serialize pattern, and the Zod+version
persistence pattern.

**Phase 1 implemented — connector foundation (`src/connectors/`), no DB driver:**
- `connector.ts` — one `Connector` contract (test/listSchemas/discover), driver-
  independent; **metadata discovery kept separate from data extraction** (reverse
  engineering never reads rows).
- `capabilities.ts` + `errors.ts` — declared capabilities; **unsupported ops throw
  a typed `ConnectorError("unsupported")`**, never a silent empty success.
- `metadata.ts` — versioned, Zod-validated **canonical metadata**. Object-centric
  (`kind`: table/view/business-object/api-resource/…) so it extends to app sources
  like Fusion without a table abstraction. `normalizedType` **reuses the existing
  fixed modeling type set** (the bridge to `.model.json`); native type/id/metadata
  preserved for round-trip fidelity.
- `connection.ts` — `ConnectionProfile` holds a **`secretRef` only**; `findSecretLeaks`
  guard. No plaintext credential may enter JSON/logs/Git.
- `snapshot.ts` — `SourceSnapshot` + provenance, **stable metadata separated from
  operational timestamps**; deterministic serialization (byte-identical across
  serialize→parse→serialize); `parseSnapshot` rejects credential-bearing files.
- `registry.ts` + `mock/mockConnector.ts` — registry-resolved connectors; an
  in-memory mock (composite keys, self-ref, view, quoted identifier, unmappable
  native type) to build/test the pipeline before the Rust Postgres adapter.
- 13 new tests; **134 total pass**; build clean; no existing file's behavior changed.

**Decisions made here:** (1) connector contract lives in TS, with live drivers to
run in Rust/Tauri behind `invoke` (Postgres can't be opened from React, and creds
must stay out of the renderer). (2) Reuse the one model format + `mapSqlType` for
normalization — no second modeling engine. (3) New artifacts (snapshots, later
connections/pipelines) follow the existing versioned-JSON + deterministic-serialize
+ Zod conventions.
**Needs author approval before Phase 2:** adding a PostgreSQL driver crate to the
Rust shell (packaging/security/macOS), and acknowledging the 15k LOC budget will
need a documented raise as the platform grows.

**Phase 2 implemented — PostgreSQL connector (live):**
- **Driver:** `tokio-postgres` (author-approved) — pure-Rust, no libpq, clean macOS
  packaging. Connection future driven on Tauri's tokio runtime; `NoTls` for now
  (TLS/sslmode is a follow-up). Added `tokio` + `keyring` crates.
- **Rust (`src-tauri/src/pg.rs`):** commands `pg_test_connection`, `pg_list_schemas`,
  `pg_discover`, and `secret_store` / `secret_delete`. Discovery is **catalog-only**
  (`pg_class`/`pg_attribute`/`pg_constraint`/`pg_index`, `format_type` for native
  types) — **never reads table rows**. Returns raw JSON (native types verbatim).
- **Credentials:** stored in the **OS keychain** (`keyring`, service "DaMod") keyed
  by the profile's `secretRef`; a transient password may be passed once for a
  pre-save test. No secret is persisted in JSON/logs, nor returned to the renderer.
- **TS (`src/connectors/postgres/`):** `PostgresConnector` implements the contract
  over `invoke`; a **pure `normalizePgDiscovery`** maps the raw payload to canonical
  metadata, reusing `mapSqlType` so native→fixed-type normalization lives in one
  place (a native type with no confident mapping keeps `nativeType`, omits
  `normalizedType`). Registered in the connector registry.
- **Verification:** Rust `cargo build` + 3 unit tests pass; 5 TS normalization tests
  (composite PKs, FKs + RI actions, unmappable native type, views/indexes); 139 TS
  tests total; build clean. A gated `#[tokio::test]` (`DAMOD_TEST_PG_URL`, docker
  `postgres:16`, fixture with composite PK + self-ref) is **author-run** — this
  environment has no database or keychain to exercise live.
- **Not done (next):** Phase 3 — Connections UI + reverse-engineering workflow
  (metadata→model mapping reusing model factories, import preview, open on canvas,
  save offline). TLS, and real end-to-end author verification of connect→discover.

**Phase 3 implemented — reverse-engineering integration:**
- **`connectors/toModel.ts`** — pure `metadataToModel(metadata, name, now)` maps
  canonical metadata into the existing `.model.json`: objects → entities (views
  tagged), columns → fields (type from `normalizedType`, else `text` + warning),
  `primaryKey` → PK flags, unique single-column indexes → `field.unique`, other
  indexes → `model.indexes`, foreign keys → relationships (one-to-one + identifying
  when the FK is the child's whole PK) with RI actions. **Reuses the model
  factories** — no second model engine. Cross-object FKs to objects outside the
  import are warned + skipped.
- **Connections persistence** — `connections.json` (`connectionsPersist.ts`):
  versioned, deterministic (profiles by id, params by key), and **credential-free**
  (serialize/parse both refuse secret-like fields). Loaded on `openWorkspace`;
  CRUD via `upsertConnection`/`deleteConnection` on the workspace store (delete also
  removes the keychain secret).
- **`connectors/ui/ConnectionsDialog.tsx`** (toolbar **Connect**) — manage
  connections (create/test/save/delete; password stored in the **OS keychain** on
  save, sent transiently only for a pre-save test) and the reverse-engineering
  workflow: discover schemas → pick → discover objects → preview (entity/
  relationship counts + warnings) → **import as a new model** via the existing
  `importModel`, which opens it on the canvas and saves it offline like any model.
- **Verified:** 8 new tests (`toModel` discover→model incl. composite PK, self-ref,
  view tag, RI actions, unmappable-type warning, FK-to-missing-object; connections
  determinism + redaction); **147 TS tests**; typecheck + build clean; app code
  ~12.2k (under 15k). The live connect→discover→import path is **author-run** (needs
  a running app + reachable Postgres + keychain).
- **This completes the "first meaningful release" except refresh/drift (Phase 4)
  and pipeline planning (Phase 5).**

**Phase 4 implemented — schema refresh & drift:**
- **Snapshots persist** at `sources/<connection>.snapshot.json` (deterministic,
  credential-free; the Rust atomic-write creates the `sources/` dir, and
  `list_workspace` only treats `*.model.json` as models, so snapshots are never
  loaded as models). Saved on import and after a refresh; store gains
  `saveSnapshot`/`loadSnapshot`.
- **`connectors/drift.ts`** — `computeDrift(prev, next)` projects both the previous
  snapshot and the fresh discovery to models via `metadataToModel` and diffs them
  with **`export/migrate.ts`'s `diffModels` (reuse)**. Because both sides are pure
  source projections, the diff is **purely source drift, never the user's edits**.
  `applyDrift(userModel, nextModel, diff, accepted)` applies only approved changes,
  matched **by name**, so **unrelated manual edits are preserved** (unit-tested).
- **Possible renames:** a removed+added entity pair sharing ≥2 column names is
  flagged for review and **never auto-applied** (§3.7 — no rename claims on thin
  evidence); a lone `id` match is not enough.
- **`RefreshPanel`** (in `ConnectionsDialog`): discover → compare vs the saved
  snapshot → per-change checkboxes (renames disabled) → **apply to the active
  model** + save + write the new snapshot. First refresh with no prior snapshot
  just records one.
- **Verified:** 5 new drift tests (added/removed/changed detection, possible-rename
  flagging, apply-only-accepted **with manual-edit preservation**, accepted type
  change, no-op); **152 TS tests**; typecheck + build clean; app code ~12.6k.
- **Known limits:** refresh applies to the *active* model (user picks which is open)
  and uses `loadModel` (resets that model's undo stack — the `.history/` snapshot on
  save is the recovery path); live refresh is author-run.

**This delivers the full "first meaningful release" loop except Phase 5 (ETL
pipeline planning).**

**Phase 5 implemented — ETL pipeline planning (design/spec, not execution):**
- **`pipeline/spec.ts`** — versioned, Zod-validated `PipelineSpec`: source
  (connectionRef?/modelId/modelName/snapshotId), target (dialect platform +
  schema), per-object column mappings (source, target, source/target types,
  optional transform, required), load strategy (`full` only for now).
  Deterministic serialization (fixed key order). **References the source
  model/snapshot** so a later schema change is detectable.
- **`pipeline/planner.ts`** — consumes an **already-discovered source model** (no
  re-discovery, §5.2). `planFullLoad` auto-maps selected objects 1:1;
  `validatePipeline` flags **type mismatches (no silent inference)**,
  required-but-unmapped target columns, invalid identifiers, and **source drift**
  (object/column gone); `pipelineReport` is a deterministic mapping+validation
  report; `targetDdl` **reuses `exportModelDDL`** (§5.3 — generating DDL is not
  executing a pipeline).
- **Persistence:** `pipelines.json` (one file for all specs, mirroring
  connections.json; versioned, deterministic). Store gains `upsertPipeline`/
  `deletePipeline` and loads on open.
- **`PipelineDialog`** (toolbar **Pipelines**): pick a model → choose objects →
  target platform → plan + save; view re-validates against the current model,
  shows the report + target DDL, and exports both to files.
- **Verified:** 9 new tests (plan, validate incl. type-mismatch/required/drift,
  deterministic report, target DDL reuse, spec + doc round-trips); **161 TS tests**;
  typecheck + build clean.
- **Explicitly out of scope:** pipeline *execution* (Phase 6, authorized milestone),
  incremental/CDC, distributed scheduling.

**MILESTONE: the full "first meaningful release" loop now exists** — connect →
discover → model → save/reopen → refresh & review drift → plan a validated ETL
pipeline — on the reusable connector framework, with all prior modeling/
persistence/DDL/semantic/validation behavior preserved.

**Code-size budget:** app code is ~13.2k of the 15k target. Remaining roadmap
(execution, Oracle, Fusion, MCP) will require a **documented budget raise** — to be
agreed with the author when Phase 6/7 starts; connector modules are small and
isolated, so the modeling core stays well within its original footprint.

**Next task:** Phase 6 (optional) — a minimal, explicitly-authorized full-load
*execution* proof against one target, kept independent of the planner; OR Phase 7 —
Oracle connector (driver/licensing eval first). Author's call.

## 2026-10-10 — Domains, reverse-engineering and forward-engineering (beyond-spec, ERwin)

Author asked to continue development with three ERwin-style features: reusable
**domains**, **reverse-engineering** a `.sql` file into a model, and
**forward-engineering** an ALTER migration. Each ships as its own increment with
unit tests; UI verified by typecheck/build/clean boot (author runs the app).

### Domains: reusable named types (ERwin)
- **What:** A model can define **domains** — named, reusable type specs (e.g.
  `money` = `decimal(14,4)`, `email` = `string(320)`). A field can bind to a
  domain; its physical type is then governed by the domain. Editing the domain's
  type propagates to every bound field (and realigns dependent foreign keys,
  FR-3.7). Deleting a domain unbinds its fields, which keep their last resolved
  type. A manual type edit on a bound field detaches it (ERwin-style override).
- **Where:** Domains live **per-model** as `domains: Domain[]` on the model file,
  exactly like `views`/`indexes`/`sequences` — so they reuse all existing
  persistence, serialization, undo/redo and determinism. A field carries an
  optional `domainId`. Managed from the toolbar **Domains** button; bound from an
  entity's Fields tab in the Properties dialog.
- **Why:** Domains are a core ERwin concept the tool lacked. Per-model (rather
  than workspace-level) keeps the change low-risk and inside one file; a future
  shared-library scope can promote them if needed.
- **Validation:** duplicate domain names, invalid domain identifiers, and a field
  bound to a deleted domain are all errors (one rule, `domainIssues`).
- **Not done:** No cross-model/shared domain library; no domain-level CHECK
  constraints (only type + optional default + logical type).

### Reverse-engineering: SQL DDL → model
- **What:** A **Import SQL** toolbar action (`src/import/`) parses a `.sql` file
  (or pasted DDL) into a new Physical model. It reads `CREATE TABLE` with column
  definitions, table-level and inline `PRIMARY KEY` / `UNIQUE` / `FOREIGN KEY` /
  `REFERENCES`, and standalone `ALTER TABLE … ADD FOREIGN KEY`. Columns become
  fields, FKs become one-to-many relationships (one-to-one + identifying when the
  FK is the child's whole primary key, which also covers subtype tables). SQL
  types map back to the fixed DaMod set; unknown types fall back to `text` with a
  warning. The dialog shows a live preview (table/relationship counts + warnings).
- **Type mapping** is deliberately multi-dialect-tolerant (Postgres, Snowflake
  `NUMBER`/`VARIANT`/`STRING`, common MySQL/SQL-Server spellings) so it accepts
  real-world DDL, not only DaMod's own export. It is the inverse of
  `export/dialects.ts`; a model → Postgres DDL → model round-trip is unit-tested.
- **Why:** Round-trip (ERwin "reverse engineer") makes the tool usable against
  existing databases, not just greenfield models.
- **Parser scope:** hand-written, paren/quote/comment-aware scanner (no SQL
  grammar dependency, per NFR-8). `CREATE VIEW/INDEX/SEQUENCE/SCHEMA`, `INSERT`
  and `CHECK`/`EXCLUDE` constraints are ignored (not errors). Composite FKs and
  schema-qualified names are handled; a FK to an unknown table is a warning, not
  a failure.
- **Not done:** No column comments → descriptions yet; no index/sequence/view
  reconstruction; no M:N collapse (a junction table imports as a plain entity
  with two one-to-many relationships, which matches DaMod's own representation).

### Forward-engineering: ALTER migration + schema options
- **What:** The Export dialog gains (1) **schema options** for the CREATE scripts —
  `DROP TABLE IF EXISTS … CASCADE` first and `CREATE TABLE IF NOT EXISTS` — and
  (2) a **Migration** scope that diffs the active model against a *baseline* and
  emits an `ALTER`-based migration. The baseline is either another model in the
  workspace or a reverse-engineered `.sql` file. This closes the loop with RE:
  dump a live DB → Import SQL as the baseline → edit the model → generate the
  ALTER script that migrates the DB to match.
- **Diff** (`export/migrate.ts`) matches entities and fields **by name** (the SQL
  identifier), not internal id, because a RE'd baseline has different ids. It
  reports added/removed/changed entities, added/removed/changed fields (type,
  nullability, default, PK, unique), and added/removed foreign keys (matched by a
  name signature). `generateMigration` renders CREATE TABLE for new entities
  (FKs added afterward once all tables exist), DROP TABLE for removed ones, and
  ADD/DROP/ALTER COLUMN for field changes.
- **Dialect:** ALTER statements target **Postgres** (the reference dialect);
  other dialects get the same output with a review note, since their ALTER COLUMN
  syntax diverges. PK changes and FK/UNIQUE drops of unnamed constraints are
  emitted as comments (they need a manual constraint-name edit), rather than
  guessing a name — safer than a wrong `DROP CONSTRAINT`.
- **Determinism:** with no schema options set, `exportModelDDL` is byte-identical
  to before (FR-8.6 preserved; unit-tested). `ddl.ts` now exports `tableDDL`,
  `alterFk`, `dropTableSql`, `foreignKeys`, `Fk`, `DdlOptions` for reuse.
- **Not done:** No live-DB connection (scripts are generated, not executed); no
  data migration (schema only); index/sequence/view diffs not included yet.

### Dimensional modeling: SCD-2 scaffolding + fact column roles (Kimball)
- **What:** Two additions make star-schema work more opinionated.
  (1) **SCD-2 scaffolding** — a *Make SCD-2 dimension* button in an entity's
  Properties (General) runs `applyScd2`: it adds a `<Entity>_key` **surrogate**
  bigint primary key, **demotes** the existing natural key(s) to business keys,
  and appends `valid_from` (NOT NULL), `valid_to`, `is_current` (default true),
  `version` (default 1); it defaults the entity's stereotype to `dimension` and
  realigns dependent fact foreign keys to the new surrogate type (FR-3.7, with a
  notice). It is **idempotent** (keyed on the surrogate's presence) and a single
  undo step.
  (2) **Fact column roles** — a field can be flagged `measure` (additive numeric
  fact) or `degenerate` (dimension attribute stored on the fact). Set in the
  field editor; shown on the canvas as `∑` / `⬦` markers.
- **Why:** The tool already had fact/dimension stereotypes, a star layout, and an
  OLAP semantic layer (cubes/hierarchies/time dimensions/metrics). These close
  the two biggest Kimball gaps: surrogate-key/SCD-2 dimension structure, and
  marking which fact columns are measures vs degenerate dimensions.
- **Validation:** a `measure` role on a non-numeric field is a warning
  (`measureRoleFit`).
- **Design choices:** the surrogate is `bigint` with **no auto-default** (the
  author picks identity vs a sequence — DaMod already has sequences — keeping it
  dialect-neutral). Roles are **model metadata** used by the canvas + validation;
  they do not change DDL output (a measure is still just its column).
- **Not done:** no SCD Type 1/3/6 variants; no automatic surrogate-key sequence/
  identity wiring; roles are not yet surfaced in `semantic.yaml` export.

## 2026-09-22 — Phase 4: semantic layer (FR-7) + export (FR-8/FR-9), multi-dialect

84 unit tests cover the pure logic (semantic persistence, DDL across 3 dialects,
YAML export). UI verified by typecheck/build and clean boot; AT-4.1–4.9 pending.

### Scope change: three SQL dialects (was one)
- **What:** The author asked for **Postgres, Snowflake and Databricks** DDL export,
  overriding the spec's original "one dialect" non-goal. Export is parameterised by
  a `Dialect` (type map + identifier quoting + comment style). Postgres stays the
  reference dialect the acceptance tests run against a real DB.
- **Type maps:** Postgres per the FR-8 table; Snowflake (VARCHAR/NUMBER/TIMESTAMP_TZ/
  VARIANT, uuid→VARCHAR(36)); Databricks (STRING/INT/DECIMAL/TIMESTAMP, uuid&json→
  STRING, backtick-quoted identifiers, inline column comments).
- **Identifiers are always quoted** so reserved words like `Order` are safe — the
  sample models use `Order`, which is unquotable in Postgres.

### DDL generation (FR-8)
- Deterministic (byte-identical): tables in a stable topological order (referenced
  first), circular refs and self-references emitted as `ALTER TABLE ... ADD FOREIGN
  KEY` at the end. M:N junctions export like any table with a composite PK. Comments
  via `COMMENT ON` (Postgres/Snowflake) or inline (Databricks). Whole-workspace
  export writes a schema per model + cross-model `references` links as FKs at the end.
- **Validation-first (FR-8.7):** the export dialog runs `validateWorkspace` and
  blocks on any error; DDL scopes are disabled for Conceptual/Logical models (FR-11.8).

### Semantic layer (FR-7) + YAML export (FR-9)
- Terms / dimensions / metrics in `semantic.json` (Zod-validated, deterministic),
  edited in a dedicated Semantic view (toolbar toggle) — no canvas. Metric detail
  shows a generated SQL snippet; lineage lists the models/entities/fields it depends
  on. Metric aggregate-type-fit, dangling-binding and duplicate-name rules added to
  validation. `semantic.yaml` export writes readable `model.entity.field` paths (never
  IDs), a SQL snippet per metric, ordered by name, deterministic (added the `yaml`
  dependency per NFR-8). Explorer gained a workspace-level Semantic node with counts.

## 2026-09-22 — Phase 3: cross-model linking (FR-6) + validation (FR-10)

67 unit tests cover the pure logic (links + validation rules). UI verified by
typecheck/build and clean boot; AT-3.1–3.7 pending manual run.

### Links live in links.json, referenced by ID (FR-6.5)
- **What:** Three link types — same-as (entity↔entity), references (field→entity),
  derived-from (field→field) — plus concept groups, all in `links.json` (workspace
  level). Loaded on open, validated with Zod, saved atomically on every change.
- **Concept groups = same-as connected components (FR-6.7).** Membership is derived
  from same-as links via union-find (A–B, B–C ⇒ one group); the stored group only
  carries the name + canonical entity. Transitivity is automatic.
- **Where models come from:** validation, badges, the map and where-used need every
  model, not just the active one. `workspaceStore.allModels()` returns the active
  model (from the model store) plus the parked tabs — a single source of truth.

### Validation is one-function-per-rule over the whole workspace (FR-10.5)
- **What:** `validateWorkspace(ctx)` runs 11 independent rules and concatenates
  issues (severity + message + go-to target). The panel reruns via `useMemo` on
  model/links change (FR-10.4) and never blocks saving — only export will.
- **Level-aware (FR-11.9):** entity-without-PK and physical-field-without-type only
  fire where they apply; Conceptual/Logical aren't flagged for missing physical types.
- **Cross-level type comparison:** two fields "differ" if both have physical types
  that render differently (so string(255) vs text is caught, AT-3.5), else by their
  generic types. Same-generic physical differences are still flagged.

### Link UI
- Create links from an entity ("+ Link", same-as) or a field ("🔗", references /
  derived-from); same-as proposes name-matched field mappings the author edits
  (FR-6.2 — proposes id↔id, author adds email↔email_address). Badges on canvas
  cards/fields and Explorer nodes with hover (FR-6.4/12.7). Where-used lists every
  dependent link (FR-6.8). Deleting a linked entity warns and cascades the links
  (FR-6.6). Workspace map draws models as nodes with per-pair link counts, click a
  line to list its links (FR-6.3). Sync-from-canonical copies missing fields by name
  (FR-6.10). Validation rollup dots on Explorer nodes (FR-12.7).

## 2026-09-22 — ERwin-style workflow: model-type-first + Explorer authoring

Author asked for a workflow closer to ERwin Data Modeler: decide the model type
on open and have the Model Explorer be where metaobjects are added.

### Start with the model type (not a blank canvas)
- **What:** With no workspace open the app shows a **Welcome** screen (New model /
  Open workspace) instead of a blank canvas. **New model** leads with the level
  choice (Conceptual / Logical / Physical/Logical / Physical) as selectable cards,
  then a name, then — only when no workspace is open yet — a folder to keep models
  in. The canvas opens at the chosen level.
- **Why:** Matches a data modeler's "File → New → pick type" flow. The level is the
  first, most prominent decision because it changes everything downstream (FR-11).
- **Change:** Removed the silent `untitled` model that an empty workspace used to
  seed. An empty workspace now shows a "create your first model" prompt.
- **Constraint kept:** A model still lives in a workspace folder (our persistence
  unit), so New-model-without-a-workspace asks for a folder once. Subsequent models
  go straight into the open workspace.

### Explorer authors metaobjects (FR-12.6)
- **What:** The Model Explorer gained inline **+** buttons (＋Model on Workspace,
  ＋Entity on the Entities group, ＋Field on an entity, ＋Relationship on the
  Relationships group) and a **right-click context menu** per node (add / rename /
  duplicate / delete). Actions switch to the node's model tab first.
- **Why:** The Explorer becomes the primary place to build and manage the model
  tree, as in ERwin, not just to navigate it.
- **Not done:** link/validation badges on tree nodes (FR-12.7) still wait for
  Phase 3 when links and validation exist.

## 2026-09-22 — Phase 1 additions (FR-11 levels, FR-12 Explorer) + Phase 2 (FR-1, FR-5)

Spec v2 added modeling levels and the Model Explorer to Phase 1. Per the author's
call these were built together with the Phase 2 persistence they depend on and
shipped as one increment. 53 unit tests cover the pure logic; UI verified by
clean typecheck/build and a clean Tauri boot (manual AT run pending).

### Open decisions resolved
- **Physical/Logical = hybrid view** (logical name + generic type shown beside the
  physical column; exports like Physical). **Derivation (FR-11.7) deferred** to the
  Could bucket — models are created at each level independently and changed in place.

### Modeling levels (FR-11)
- **What:** A model carries a `level`. A field can hold both a physical `type` and a
  generic `logicalType` (+ hybrid `logicalName`); the level decides which is shown,
  which is required, and whether DDL export is allowed (`canExportDdl`).
- **Reversibility (FR-11.6):** Lowering a level never deletes the other
  representation — both `type` and `logicalType` are serialized whenever present, so
  lower→save→reload→raise restores the physical type. This means a Logical model
  *lowered from* Physical keeps its physical types on disk, a slight deviation from
  the file-format's "logicalType in place of physical type" (which holds for models
  authored fresh at Logical). Chosen deliberately to satisfy reversibility.
- **Raising** synthesises physical types from generic ones; ambiguous ones
  (Text→string/text, Number→integer/bigint, Identifier→uuid/int) get a default and
  are surfaced as a notice for the author to adjust.
- **Level-aware everything:** field type pickers, canvas rendering (Conceptual shows
  no field rows), relationship FK creation (Conceptual makes no FK fields; Logical
  copies the generic type), and the disabled-with-reason Export DDL action.

### Model Explorer (FR-12)
- **What:** A dockable left tree: Workspace → Models (level badge) →
  Entities/Relationships/Fields + a Semantic node (empty until Phase 4). Click
  navigates (switch tab + select + centre); double-click renames an entity inline;
  a filter hides non-matching nodes across all models. Expansion state persists per
  workspace in `localStorage`.
- **Not done:** context-menu actions and link/validation badges (FR-12.6–12.7,
  Should) land with Phase 3 when links/validation exist.

### Persistence (FR-5) and workspace/models (FR-1)
- **Deterministic JSON in TS, atomic writes in Rust.** The serializer builds objects
  in a fixed key order and omits empty optionals; a Rust `write_file` command writes
  to a temp file and renames it into place, snapshotting the previous version into
  `.history/` (last 20) before model writes.
- **Zod** validates every file on open (FR-5.6/5.7) and migrates old files (no
  `level` → Physical). Added as a dependency (NFR-8): chosen over hand-written
  validators for readable path+reason errors, which FR-5.7 needs.
- **tauri-plugin-dialog** for the folder picker; last workspace remembered in the
  app config dir via `app_state_*` commands (FR-1.1).
- **Autosave** 2s after the last edit plus ⌘S; the active tab shows an unsaved dot.
  **External changes** are detected by polling file mtime every 1.5s (simpler than a
  native watcher, no extra Rust dep) and offer reload / keep-mine.
- **Multi-model editing:** the active model lives in the model store (with its undo
  history); other open tabs are parked in the workspace store. Switching tabs saves
  the current model first, so inactive tabs are always the on-disk version. Undo
  history is per-active-model and resets on tab switch (acceptable for a single-user
  tool; not required to persist across tabs).

## 2026-09-22 — Phase 1: one model (FR-2, FR-3, FR-4)

The model lives in memory only this phase; persistence is Phase 2. All acceptance
logic (identifier rules, FK creation, type propagation, cascade delete, undo/redo)
is covered by unit tests in `src/model/*.test.ts` and `src/store/*.test.ts` — 35
tests, run with `npm test`.

### Layering: pure model ops + a Zustand store
- **What:** Domain types and transforms are pure functions in `src/model/`
  (`dataTypes`, `identifiers`, `model`, `operations`). The Zustand store
  (`src/store/modelStore.ts`) wraps them and owns history + selection + notices.
- **Why:** Pure functions are unit-testable without a DOM (NFR-9) and keep the
  store thin. The store clones the model per edit (`structuredClone`) so history
  is a plain stack of immutable snapshots.
- **Not done:** No immer (keeps the dependency budget at zero for this — NFR-8).

### Undo/redo as past/present/future snapshots (FR-4.5)
- **What:** Every edit pushes the prior model onto `past` (cap 100) and clears
  `future`. Drags commit a single history step on drag-stop, not per pixel.
- **Why:** Simple, correct, and easily 50+ deep. Snapshot-per-edit is fine at the
  50-entity target (NFR-3); a 200-entity model still works, just with larger snapshots.

### Foreign-key type is derived from the referenced primary key (FR-3.3, FR-3.7)
- **What:** Creating a 1:1/1:M relationship makes the FK field on the child with
  the parent PK's exact type. `reconcileForeignKeyTypes` realigns FKs whenever a
  PK's type changes and raises a notice listing what changed. Junction id fields
  are mapped positionally (parent keys first, then child keys).
- **Note on AT-1.7:** The spec's expected result says changing `Customer.id` to
  bigint updates "`Order.customer_id` **and OrderProduct keys**". In the sample
  models `OrderProduct`'s keys reference `Order.id` and `Product.id`, not
  `Customer.id`, so only `Order.customer_id` actually changes. The tool propagates
  strictly along real references; `OrderProduct` keys would only change if
  `Order.id` or `Product.id` changed. Flagging as a probable spec wording slip —
  behaviour is intentionally reference-accurate.

### Relationship creation: drag OR side-panel form (FR-3.1), self-refs allowed (FR-3.6)
- **What:** Dragging one entity onto another opens a dialog; a "+ Relationship"
  button in the entity's side panel opens the same dialog. Parent/child are
  dropdowns, so they can be swapped or set equal for a self-reference.
- **Why:** Covers both FR-3.1 paths and makes self-references practical (dragging
  a node to itself is awkward). M:N always materialises a junction (agreed rule).

### Canvas = React Flow, controlled from the store
- **What:** Nodes/edges are derived from the store each render; custom `EntityNode`
  cards show fields with PK/Unique/NOT NULL markers; crow's-foot markers via SVG
  `<marker>` defs. Delete key is intercepted (`deleteKeyCode={null}`) so deletion
  runs through a confirmation (FR-4.6).
- **Not done:** No auto edge-routing beyond React Flow defaults; auto-arrange
  (FR-4.7) is a simple grid.

### Ctrl/Cmd+S is a stub this phase
- **What:** ⌘S shows a "saving arrives in Phase 2" notice.
- **Why:** There is no persistence yet (Phase 2 = FR-1, FR-5). The shortcut is
  wired so the muscle memory works; it becomes a real save next phase.

## 2026-09-22 — Phase 0: scaffold

### Desktop framework: Tauri v2 (not Electron)
- **What:** The app is a React + TypeScript frontend wrapped by Tauri v2 (Rust shell).
- **Why:** NFR-4 asks for startup under 3 seconds and the app "owns nothing but a
  folder of files" — Tauri gives a ~10 MB binary, fast cold start, and native
  filesystem + file-watching for the workspace layer (FR-5, FR-5.8). Author confirmed.
- **Not done:** Electron was rejected for size and startup cost. No mobile targets,
  though Tauri keeps that door open.

### Target OS: macOS only
- **What:** Build and package for macOS (Apple Silicon) only. `bundle.targets` is left
  at `"all"` but only macOS is exercised.
- **Why:** Author works on macOS and is the only user (NFR-1, single-user). Avoids
  Windows/Linux packaging and testing overhead.
- **Not done:** No Windows/Linux builds. Revisit only if the tool is ever shared.

### State library: Zustand
- **What:** Zustand is the single state library (NFR-8 allows exactly one).
- **Why:** Small, hook-based, no boilerplate, works cleanly with an undo/redo history
  stack (FR-4.5) and autosave triggers (FR-5.4).
- **Not done:** Redux/MobX not used. Not yet wired in — added in Phase 1 where the
  in-memory model lives.

### Diagram library: React Flow (`@xyflow/react`)
- **What:** React Flow is the single diagramming library (NFR-8).
- **Why:** Named as the reference choice in the spec; handles pan/zoom/fit-to-view
  (FR-4.2), custom entity nodes and crow's-foot edges (FR-4.1), and the 50-entity
  performance target (FR-4.8, NFR-3).
- **Not done:** No alternative canvas lib evaluated; spec pre-approved this one.

### Test runner: Vitest
- **What:** `npm test` runs Vitest in the `node` environment over `src/**/*.test.ts`.
- **Why:** Shares Vite's config and transform, zero extra toolchain. NFR-9 only requires
  unit tests for pure logic (file format, type mapping, DDL export, validation), which
  need no DOM.
- **Not done:** No component/E2E test harness (jsdom, Playwright) — acceptance tests are
  run by hand per the spec, not automated.

### Many-to-many handling (FR-3.4): always materialize a junction entity
- **What:** Every many-to-many relationship will create a junction entity with both
  foreign keys; no bare N:M conceptual line.
- **Why:** Author's call. Keeps the DDL export (FR-8.2) and validation uniform — a
  junction is just another table. Matches acceptance test AT-1.4.
- **Not done:** Bare conceptual N:M lines are not supported. (Implemented in Phase 1.)

### Link types (FR-6): ship all three
- **What:** `same-as`, `references` and `derived-from` all land in Phase 3.
- **Why:** Author wants full lineage from the start; `derived-from` is lineage-only
  (no constraint), so it is cheap to include.
- **Not done:** Nothing deferred here. (Implemented in Phase 3.)

### Export dialect: Postgres 16 (assumption carried forward)
- **What:** DDL export targets Postgres 16, per the spec's assumption #1.
- **Why:** Default recommended in the plan; no other target requested.
- **Not done:** No second dialect. Type mapping (FR-8 table) is the only one implemented.

### App identifier
- **What:** Bundle identifier is `pm.vinit.damod`, product name `DaMod`.
- **Why:** Derived from the author's domain; single-user local app, so the exact value
  only affects macOS bundle metadata.
