# Decision log

Claude Code keeps this log so the author can read *what was chosen and why*
instead of the code (per the "Working context and verification" section of the
requirements). Newest entries at the top. Each entry: what, why, and what was
deliberately not done.

## 2026-10-11 — Domains feature audit + Phase 1 Slices 1–2 (erwin-standards roadmap)

Ran a full read-only audit (5 parallel explorers) of Domains, Naming, Data Types,
Copilot, and the validation/persistence/engineering plumbing, then started the
approved roadmap. Audit verdict: engine/plumbing solid; **Domains ~70% done** (model/
store/Zod/serialize/validation/tests ✅) with the real gaps being discoverability and
deletion UX; **Naming Standards and Data Type Standards don't exist as reusable objects**
(only identifier validation + manual dual-naming + a fixed type catalog). Full
assessment lives in the conversation; roadmap: Domains → Naming → Type Standards →
Copilot standards actions → hardening.

**Slice 1 — Domains discoverable & bindable (shipped):**
- Model Explorer now has a **Domains group** (list/count/add/select/delete) and the
  **docked SidePanel** gained a domain selector on physical fields (previously only the
  modal PropertiesDialog had one). Shared `DomainSelect` component so both inspectors
  bind identically; a docked `DomainEditor` mirrors the modal domain fields.
- Purely additive over existing store ops — **no serialization/schema/engine change, no
  migration**; old files load unchanged. Zustand selector rule honored (stable ref +
  derive outside) to avoid the getSnapshot loop.

**Slice 2 — dependency-aware domain deletion (shipped):**
- Deleting a domain now routes through a **confirm dialog** that lists the bound columns
  and requires an explicit resolution: **detach** (keep each column's current type — the
  legacy behaviour) or **reassign** to another domain (rebinds + applies its type). No
  silent conversion. New store op `deleteDomainResolved(id, mode, replacementId?)` runs as
  **one undo entry** (reassign also realigns FK types via `reconcileForeignKeyTypes`).
- Delete UX is centralized via a transient `domainDeletePending` flag in modelStore
  (precedent: `propertiesOpen`), so all three delete entry points (Explorer tree, docked
  DomainEditor, modal DomainsDialog) funnel into one `DomainDeleteDialog` mounted in App —
  no prop threading, no uiStore/localStorage persistence of transient state. Legacy
  `deleteDomain` kept (still used by tests / as the detach primitive).

**Not done (deferred, per plan):** Postgres `CREATE DOMAIN` DDL emit + reverse-eng of
domains (Phase 1d/e, gated on decision Q1 — changes DDL output, needs `ddl.test.ts`
updates); Naming/Type Standards (Phases 2–3); Copilot domain apply/replace/detach +
read-only compliance actions (Phase 4).

- Tests +11 (Slice 1: `domainBinding.render` ×4, `domainsExplorer.render` ×1; Slice 2:
  `domainDelete` store ×3, `domainDelete.render` ×3). **424 TS tests pass; tsc + build clean.**

## 2026-10-11 — Req 23 Phase 5: Snowflake governance objects + Snowflake Copilot actions

Completed the last two deferred Snowflake items: governance objects, and Copilot actions
for both the Phase 4 data-engineering objects and these new governance ones.

**Governance objects** (`Model.governanceObjects: GovernanceObject[]`, id prefix `z_`):
- One kind-discriminated type (role/grant/tag/maskingPolicy/rowAccessPolicy/share), same
  as Phase 4 — one collection, one serializer/Zod (string + array fields, omit-empty),
  one Explorer group set (Snowflake-only), one kind-adaptive Inspector editor, undo-
  tracked store ops. DDL: `CREATE ROLE` + `GRANT ROLE`, `GRANT …`, `CREATE TAG`,
  `CREATE MASKING POLICY`, `CREATE ROW ACCESS POLICY`, `CREATE SHARE` + grants/accounts;
  other dialects get a single count-comment (no Snowflake equivalent).
- **Security (§5/§6):** there is deliberately **no credential/secret field** on the type,
  so nothing secret can be stored, shown, exported, or sent to the LLM. Policy bodies are
  **author-owned local content** (the model has no live-discovery path for governance, so
  a body only ever contains what the user typed) — the editor documents this. This squares
  the "never expose sensitive policy expressions" constraint with needing to model the
  policy at all: what's shown is the user's own input, not a discovered secret.
- Validation (warnings, WIP-friendly): grant needs object+role; masking/row-access need a
  body; share needs objects.

**Copilot actions** `create_snowflake_object` + `create_governance_object` (create-only,
Zod-validated, reviewed→approved, one undo group via the existing `execute.ts` path):
- Both **skip unless `model.dialect === "snowflake"`** (returns a clear skip message), so
  they can't create objects that would be invisible on a non-Snowflake model.
- Context (`context.ts`) now lists both object sets **by name + kind only** — never policy
  bodies or any field that could carry a secret, honoring "never send business data/creds
  to the LLM". Prompt (`orchestrate.ts`) documents the actions with an explicit
  no-credentials rule.

**Note:** reused the `z_` id prefix; updated `ids.test.ts` which had used `z_` as its
"unknown prefix" example (now a valid prefix) → switched to `u_`.

- 413 TS tests (+15: `export/governanceObjects.test.ts` ×9, `store` governance ×3,
  `copilot/execute` ×3); tsc/build clean.

## 2026-10-11 — Req 23 Phase 4: Snowflake data-engineering objects

Modeled stages, file formats, pipes, streams, tasks and dynamic tables as first-class
objects (previously only carryable as opaque `rawObjects`).

- **One unified type, not six.** `Model.snowflakeObjects: SnowflakeObject[]` where
  `SnowflakeObject` is a single kind-discriminated interface (`kind` ∈ stage/fileFormat/
  pipe/stream/task/dynamicTable) with a superset of optional fields. Chosen over six
  parallel collections to avoid ~6× the store/serialize/Zod/Explorer boilerplate for
  objects that share most plumbing; the kind gates which fields matter. ID prefix `y_`.
- **Deterministic serialize + Zod** (fixed key order, omit-empty) → byte-identical
  round-trip (tested). Store ops `create/update/deleteSnowflakeObject` are undo-tracked
  via `commit`; create selects the new object; delete clears a matching selection.
- **DDL (`snowflakeObjectDDL`):** emits `CREATE STAGE/FILE FORMAT/PIPE/STREAM/TASK/
  DYNAMIC TABLE` for the `snowflake` dialect only; other dialects emit a single
  `-- N Snowflake data-engineering object(s) omitted for <label>` comment (these objects
  have no equivalent elsewhere, so silently dropping them would be misleading).
- **Explorer:** six groups rendered only when `model.dialect === "snowflake"` (they'd be
  noise on a Postgres model). **Inspector:** a kind-adaptive `SnowflakeObjectEditor`.
- **Security (§5):** the stage editor exposes stageType/url/fileFormat only — **never
  credentials**; no secret field exists on the model, so none can leak to JSON/DDL/LLM.
- **Validation:** warnings (not errors — a model can be WIP) when a pipe lacks a COPY
  statement, a stream lacks a source, a task/dynamic-table lacks SQL, or an external
  stage lacks a URL.
- **Not done:** discovering these from a live account (connector enhancement, needs an
  account); governance objects (Phase 5); Snowflake-object-specific Copilot actions.
- 394 TS tests (+14: `export/snowflakeObjects.test.ts` ×10, `store/snowflakeObjects.test.ts`
  ×4); tsc/build clean.

## 2026-10-11 — Req 23 §4.1/§4.2: table variants + constraint-enforcement flag

The §4.2 declared-vs-enforced distinction is correctness-sensitive — Snowflake standard
tables DECLARE but do NOT enforce PK/UNIQUE/FK; only hybrid tables enforce. Modeled it.

- **`Entity.tableKind`** (standard/temporary/transient/external/hybrid) + **`Relationship.
  enforced`** — optional, backward-compatible, deterministic serialize + Zod, undo via the
  existing ops. Inspector: a Table-kind selector (entity General) + an "Enforced by the
  database" checkbox (relationship RI tab).
- **DDL (`ddl.ts`):** `tableKindKeyword` emits `CREATE TRANSIENT/HYBRID/TEMPORARY TABLE`
  (TRANSIENT/HYBRID/EXTERNAL are Snowflake-only; TEMPORARY is broad; other dialects ignore
  the Snowflake-only kinds). For Snowflake, PK/UNIQUE/FK get **`NOT ENFORCED`** on
  non-hybrid tables, enforced on hybrid — so the DDL never implies enforcement Snowflake
  doesn't provide. Postgres etc. never emit NOT ENFORCED.
- **Validation:** `snowflakeEnforcement` warns when a FK is marked enforced on a non-hybrid
  Snowflake table (contradiction).
- 384 TS tests (+6: `export/tableVariants.test.ts`); tsc/build/cargo clean.

## 2026-10-11 — Req 23 (Phase 1–2): Snowflake connector + end-to-end discovery path

Snowflake was already a DDL dialect + target + source-system type, but there was **no
connector to discover FROM Snowflake** — so reverse-engineering a Snowflake schema wasn't
possible. Added that (mock/offline), completing the §15 end-to-end path.

- **`snowflakeTypes.mapSnowflakeType`** — NUMBER/VARCHAR/BOOLEAN/DATE/TIMESTAMP_*/VARIANT/
  OBJECT/ARRAY → canonical; GEOGRAPHY/GEOMETRY/VECTOR/BINARY unmappable → preserved as the
  field's **nativeType** (the field-level source added earlier makes VARIANT/GEOGRAPHY
  survive reverse-engineering even when normalized/unmapped).
- **Mock Snowflake connector** (ANALYTICS.PUBLIC: CUSTOMER with VARIANT/GEOGRAPHY/
  TIMESTAMP_NTZ, ORDERS with a **declared-not-enforced** FK, a view); registered
  `snowflake`. Reuses `metadataToModel` (Snowflake tables are relational) → model → the
  existing Snowflake DDL export + diff/migration + snapshot/drift all work unchanged.
- **UI:** generalized the app-mock Connections editor to a third source — "+ Snowflake
  (mock)" (account/database only, no credentials).
- **Capability audit:** `docs/SNOWFLAKE.md` (what already existed vs. this increment vs.
  deferred). Deliberately did NOT add Snowflake-only types (VARIANT/GEOGRAPHY/…) to the
  fixed canonical type set — preserved as native, same policy as Oracle/Fusion, avoiding a
  fork of the one type engine.
- Deferred (documented): table variants + constraint-enforcement flags (§4.2), data-
  engineering objects (stages/pipes/streams/tasks/dynamic tables), governance, live adapter.
- No new deps, no Rust. 378 TS tests (+7); tsc/build/cargo clean.

## 2026-10-11 — Four more DDL dialects: Oracle, SQL Server, MySQL, BigQuery

Added as DDL *output* targets (export + pipeline target + New Model target database),
so a reverse-engineered EBS/Fusion/relational model can generate DDL for them.

- `export/dialects.ts`: extended `DialectId`/`DIALECTS`/`DIALECT_IDS` with oracle/
  sqlserver/mysql/bigquery (type map + quoting + commentStyle). Added `commentStyle:
  "none"` for dialects without a simple column comment (SQL Server, BigQuery).
- `ddl.ts`: `indexDDL` emits `CREATE INDEX` for postgres/oracle/mysql/sqlserver (clustering
  for Snowflake, OPTIMIZE comment for Databricks/BigQuery); `sequenceDDL` emits `CREATE
  SEQUENCE` for those with it (comment for Databricks/MySQL/BigQuery).
- Kept `DbDialect` (model target) in sync + the Zod enums (model.dialect, rawObject),
  New Model dialect hints, and the raw-object editor. Everything that maps over
  `DIALECT_IDS` (ExportDialog, pipeline target platform) picks them up automatically.
- **Not an Oracle *source*** — DaMod models FROM Oracle (via the connectors) and now
  generates Oracle/SQL-Server/MySQL/BigQuery DDL *out*; still no live DB connection.
- 369 TS tests (+4: per-dialect DDL in `ddl.test.ts`); tsc/build/cargo clean.

## 2026-10-11 — Source-snapshot browser (Req 21/22 §11)

Surfaces the snapshot-only metadata that §11 keeps OFF the model — EBS application
dictionary (concurrent programs / lookups / program units) and Fusion API resources +
extract data stores — closing the last Explorer/Properties gaps for both.

- **`SnapshotView`** (pure, tested): renders a `SourceSnapshot` — source identity (EBS
  release / DB version / Fusion API version), discovery provenance, object counts, the
  EBS app dictionary, and the Fusion REST resources + extract data stores. Sections show
  only when present (works for EBS, Fusion, or plain).
- **`SnapshotBrowser`** dialog loads the active model's snapshot **by model name** and
  renders it (or a clear "no snapshot" message). Opened from Data → **Source snapshot**.
- **Linking:** import already saved the snapshot keyed by model name; reverse-engineering
  now ALSO saves a model-name-keyed copy (keeping the connection-name copy for refresh/
  compare). No model-schema change, no Rust, no snapshot-dir listing needed.
- Limitation (documented): keyed by model name, so renaming the model loses the link;
  a durable `model→snapshot` reference is a future nicety.
- 365 TS tests (+2: `SnapshotBrowser.render.test.tsx`); tsc/build/cargo clean.

## 2026-10-11 — Field-level source provenance (source-native type) (Req 22 §7)

Reverse-engineering dropped each column's source-native type (`NUMBER(15)`, `VARCHAR2`,
`number`, `timestamptz`) — only the normalized modeling type survived. Now preserved.

- `ObjectSource` += `nativeType`; `Field.source?: ObjectSource` added (reuses the one
  provenance type for entities + fields). `metadataToModel` stamps every discovered field
  with `source = { system, nativeType, nativeId? }` — benefits ALL connectors (Postgres/
  EBS/Fusion), not just Fusion.
- Serialize: extracted a shared `sourceToPlain` helper (entity + field), deterministic +
  omit-empty; Zod `source` on `zField`. Byte-identical round-trip (tested). Reconcile
  keeps the fresh native type (structure) while preserving manual field edits.
- Inspector: the column detail (`FieldDetail`) shows a read-only **Source-native type**
  row when present — the §7 attribute source-native-type.
- 363 TS tests (+1 render + data/round-trip assertions); tsc/build/cargo clean.

## 2026-10-11 — Fusion-specific Properties panel (business object) (Req 22 §7)

The Fusion REST specifics (API path/version) lived only in the snapshot's `native.fusion`;
`fusionSnapshotToModel` carried family/module to `entity.source` but not the API fields, so
the Inspector couldn't show them.

- `ObjectSource` += `apiPath`/`apiVersion` (optional, serialize + Zod); `fusionSnapshotToModel`
  now sets them on each entity. **Bug fixed along the way:** it kept the catalog schema name
  as `source.schema` instead of the finer **module** — now the module wins (so the Fusion
  Explorer's Module grouping + the panel are correct).
- `EntitySourceInfo` (Inspector General tab) is now **source-aware**: for `oracle-fusion` it
  renders a "Fusion Cloud source" block with Application family / Module / Business object /
  API path / API version; EBS/relational keep their generic labels.
- Deferred (documented): attribute source-native-type (needs a field-level `source`) and
  standalone API-resource / extract-data-store panels (snapshot-only).
- 362 TS tests (+1 render + source assertions); tsc/build/cargo clean.

## 2026-10-11 — Pipeline cross-object joins + source-side filters (Req 22 §8.6)

Extended the pipeline spec/planner/editor with joins and filters (the mapping editor
already did columns/types/transforms).

- **Spec:** `PipelineObject.filters` (column/op/value — `FILTER_OPS` incl. is null/is not
  null) and spec-level `joins` (`leftObject.leftColumn {inner|left} rightObject.rightColumn`).
  Both default `[]` (backward-compatible); `specToPlain` omits them when empty → old specs
  round-trip unchanged.
- **Planner:** `validatePipeline` checks filter columns exist + value-ops have a value, and
  join endpoints/columns exist in the model; `pipelineReport` lists joins + filters.
- **UI:** `MappingEditor` gains a Joins section (spec-level) + per-object Filters, live-
  validated, saved with the rest of the mapping.
- Still a PLAN, not execution (joins/filters are declared metadata + lineage, honored by a
  future executor). 361 TS tests (+3); tsc/build/cargo clean.

## 2026-10-11 — Source-to-target mapping editor (Req 22 §8)

The pipeline *spec/planner* already modeled column mappings (source/target/transform/
type, type-compat + required validation, report, target DDL) — but the UI only did a
read-only full load. Added the editing surface, so it's a real source-to-target mapper.

- **`MappingEditor`** (new): an editable **Mapping** tab in the pipeline designer. Per
  object: rename the target column, convert its type (any canonical type), add a
  transform expression, toggle NOT NULL, drop a column, or add back an un-mapped source
  column. Edits a local draft, **re-validates live** (reusing `validatePipeline`:
  type-conversion-needs-transform, required-without-source, drift), and "Save mappings"
  persists via the existing `upsertPipeline`.
- Extracted `columnFromField` in the planner (shared by `planFullLoad` + add-back).
- **General, not Fusion-specific:** works for any source model (relational / EBS / Fusion)
  → Postgres/Snowflake/Databricks target. Cross-object joins/filters deferred.
- No new deps, no Rust. 358 TS tests (+4: mapping edit/validation/round-trip in
  `pipeline.test.ts`); tsc/build/cargo clean.

## 2026-10-11 — Fusion-aware Explorer view (reuses the EBS view machinery)

Req 22 §4 — a Fusion Cloud model can now be browsed by **application family / module**,
parallel to the EBS product/schema view.

- **Reuse over duplication:** generalized `EbsExplorer` into a shared `AppExplorer`
  component parameterized by labels; `EbsExplorer` and new `FusionExplorer` are thin
  wrappers (EBS = Products/Schemas, Fusion = Families/Modules). The grouping helper
  `ebsGroups` was already source-neutral (reads `source.product`/`schema`) — Fusion sets
  product=family, schema=module. Existing EBS view + tests unchanged.
- `ebsTree.hasFusionContent` (system `oracle-fusion` or `fusion:` tag). `ModelExplorer`
  generalized its Model/EBS toggle → **Model / {EBS|Fusion}**, chosen by the active
  model's provenance; renders the matching `AppExplorer`.
- Subject-area shortcuts + click-to-open-diagram work in both views.
- API resources / extract data stores stay on the snapshot (not the model), so they're
  not in the Explorer tree — deferred to a snapshot-reading surface (documented).
- 354 TS tests (+4: `FusionExplorer.render.test.tsx`); tsc/build/cargo clean.

## 2026-10-11 — Subject-area diagrams (erwin-style scoped canvas views)

Users can now view a subject area as its own diagram, separate from the main model
diagram — the erwin "subject area" experience.

- **Transient diagram scope** on `modelStore` (`activeDiagram: string | null`, reset on
  `loadModel` so it clears per tab — same pattern as `canvasMode`/`focus`; NOT model
  state, creates no undo). `setActiveDiagram(id|null)`.
- **Canvas** filters to the active area: only its member entities + the relationships
  AMONG them render; views are hidden in a subject-area diagram. Pure helper
  `canvas/subjectAreaDiagram.diagramEntityIds` (tested) — and it falls back to the whole
  model for an unknown/empty area or deleted members, so a stale scope never blanks the
  canvas.
- **UI:** a diagram selector bar on the canvas (Main model / each subject area, with
  counts) + a scope badge and ✕ to exit. Clicking a subject area in the Explorer (or its
  "Open diagram" context item) opens that diagram.
- **Deliberate MVP:** subject-area diagrams reuse the entities' shared model positions
  (a filtered view), not independent per-area layouts. erwin stores separate coordinates
  per subject area; that (per-diagram positions) is a documented future enhancement.
- 350 TS tests (+6: `subjectAreaDiagram.test.ts`); tsc/build/cargo clean.

## 2026-10-11 — Copilot action parity: semantic layer + all remaining object types

Reported: the Copilot refused to create semantic-layer objects (terms/dimensions/metrics)
— it only had table/column/relationship actions. Closed the gap comprehensively so the
AI path matches what the manual UI can do.

- **New actions** (`copilot/actions.ts`, documented in the SYSTEM_PROMPT, rendered in
  `describeAction`, all structural → require approval): `create_term`,
  `create_dimension`, `create_metric` (semantic layer, FR-7); plus the Req 19 objects —
  `create_schema`, `create_view` (incl. materialized), `create_index`, `create_sequence`,
  `create_domain`, `create_check_constraint`, and `set_stereotype` (fact/dimension).
- **Executor** (`execute.ts`): semantic actions go through `useWorkspaceStore` ops
  (`addTerm/addDimension/addMetric` with `newTerm/…` factories), resolving entity/field
  names to refs; model-object actions through the existing `modelStore` ops. Idempotent
  by name; names validated. (Semantic objects live in the workspace semantic doc, so
  they're outside the model's single-undo group — expected.)
- **Context** (`context.ts`): now includes a semantic-layer summary + subject areas, so
  the AI references existing objects instead of duplicating (and no longer reasons that
  "the context does not support semantic layer"). A prompt rule states semantic / subject
  area / schema / view / … actions are available at ANY modeling level.
- 344 TS tests (+5: semantic + model-object Copilot execute tests); tsc/build/cargo clean.
- Still Copilot-only-create (no update/delete) for these new object types — the
  high-value path; deeper edit/delete actions are a follow-up if needed.
- **Fix:** `create_subject_area` wrongly ran `validateIdentifier`, so a natural name like
  "Customer Order Management" failed ("invalid name") and nothing appeared in the tree.
  Subject areas (and terms/dimensions/metrics) are **free-form business names** (spaces
  allowed), not SQL identifiers — now only non-empty is required (matches the manual
  "+ area" path). The metric `key` stays identifier-safe via `deriveKey`.

## 2026-10-11 — Copilot can create subject areas (closing a reported gap)

Reported: the Copilot refused "create a subject area" — the model/store/Explorer supported
them (previous entry) but the Copilot had NO matching action, so it correctly said it
couldn't. Added the action so the AI path matches the manual one.

- New Zod action `create_subject_area` ({ name, description?, tables?: string[],
  product? }) in `copilot/actions.ts`; documented in the `orchestrate` SYSTEM_PROMPT;
  rendered by `CopilotPanel.describeAction`; classified structural (requires approval),
  not destructive.
- `execute.ts` applies it through the SAME store ops (`createSubjectArea` /
  `createSubjectAreaFromProduct`): resolves `tables` names → ids (unknown names skipped
  with a note), or derives members from an EBS product / Fusion family `product` code;
  idempotent by name; validates the name. One undo group, like every other action.
- Level-agnostic — works at Physical/Logical etc. (the error quoted a level/terminology
  limitation; subject areas don't depend on level).
- 339 TS tests (+3: Copilot subject-area execute tests); tsc/build/cargo clean.

## 2026-10-11 — Subject areas available for ALL databases (not just EBS)

The `SubjectArea` model concept was already database-agnostic, but the only UI to
create/manage areas lived in the EBS Explorer view — so a plain Postgres/Snowflake/
Databricks/Fusion/blank model couldn't use them. Added a generic entry point.

- **Standard Model Explorer** now has a **Subject areas** section (sibling of Semantic
  layer), rendered for the active model of ANY source: `+` creates an empty area; each
  area expands to its member tables (reveal/remove), renames (double-click), deletes, and
  a `+`/context action adds the currently-selected table. Entity right-click gains "New
  subject area from this".
- **Store:** added `addEntityToSubjectArea(areaId, entityId)` (idempotent). Everything
  flows through `commit` (undo/redo). The EBS/Fusion "from product/family" convenience
  stays; this is the universal path.
- No new deps, no Rust. 336 TS tests (+2); tsc/build/cargo clean.

## 2026-10-11 — Req 22 (Phase 1 + reverse): Oracle Fusion Cloud offline/mock foundation

Fusion Cloud is an API/extract source, not a DB. Built the offline/mock foundation on the
existing connector framework (no tenant / OAuth / network — untestable here), mirroring
the EBS approach and reusing everything downstream.

- **Contract (backward-compatible):** `source.apiVersion` (Fusion REST version, separate
  from any DB version); `fusion-metadata` added to `RELATIONSHIP_PROVENANCE` (documented
  Fusion relationships / nested resources are not DB FKs); optional `metadata.fusion`
  = { apiResources (path/methods/version/family), extractDataStores (offering/fields/
  incremental) }. API/extract metadata are reference facts on the snapshot, NOT model
  tables (§5). `snapshot.metadataToPlain` serializes all of it deterministically.
- **`mapFusionType`** (JSON-ish REST spellings → canonical set; unmappable → native).
- **Mock Fusion connector** (Financials: Supplier, InvoiceHeader, InvoiceLine nested
  child) + `native.fusion` annotations (family/module/apiPath/apiVersion/verified).
- **`fusionSnapshotToModel`** reuses `metadataToModel`: family tags (`fusion:<FAMILY>`),
  family/module onto `entity.source`, parent-child relationships, composite keys.
- **Neutral dispatcher:** moved `metadataToModelForSource` out of `ebs.ts` into
  `connectors/buildModel.ts` (EBS/Fusion/plain) to avoid EBS↔Fusion coupling.
- **UI:** generalized the Connections editor from EBS-only to any **app-mock** source;
  "+ Oracle Fusion (mock)" (instance URL only, no credentials); Test reports the API
  version; Reverse-engineer imports a Fusion model; the reverse preview shows REST /
  extract counts. Tightened `hasEbsContent` so Fusion models don't trigger the
  EBS-labelled Explorer view (Fusion view deferred).
- No new deps, no Rust. 334 TS tests (+14: `fusion/fusion.test.ts` + Fusion dialog render
  test); tsc/build/cargo clean. Live REST connector + Fusion Explorer/Inspector/mapping/
  extraction are deferred (`docs/ORACLE_FUSION.md`).

## 2026-10-11 — Req 21 Phase 4 (part): subject areas by EBS product

Subject areas (§6) — named entity groupings for focus/navigation. Generally useful, but
the EBS product tags (`ebs:<CODE>` + `entity.source.product`) make them auto-derivable.

- **`SubjectArea` model concept** (`model.subjectAreas`): id/name/description?/entities[]/
  product?. A LENS, not a container — an entity can be in several areas and deleting an
  area never deletes entities (tested). Optional, backward-compatible, deterministic
  serialize + Zod; validation rule for dup names + dangling members.
- **Store ops** via `commit` (undo/redo free): create/update/delete +
  `createSubjectAreaFromProduct(code)` which collects the product's tables and
  **refreshes an existing area for that product instead of duplicating** (returns null if
  the product has no tables).
- **EBS Explorer UI:** a "+ area" action on each product group + a Subject Areas list
  (click reveals a member; ✕ deletes). Read-only navigation; creation/edit flows through
  the store.
- No new deps, no Rust. 320 TS tests (+7: `store/subjectAreas.test.ts` + an EbsExplorer
  render test); tsc/build/cargo clean. Remaining Phase 4: logical/conceptual generation +
  an EBS refresh/compare review UX on `reconcileDiscoveredModel`.

## 2026-10-11 — Req 21: Oracle driver decision = imported-metadata-only (+ file import)

**Decision (author sign-off: "go with the easy fix for the driver"):** adopt the
**imported-metadata-only** option and defer the native Rust Oracle adapter indefinitely.
Rationale: the `oracle` crate needs Oracle Instant Client native libs (licensing +
Apple-Silicon packaging + bundling burden) and a thin worker adds a second process — both
are heavy and, crucially, unverifiable here (no Oracle instance; Claude can't drive a live
DB). Imported-only adds ZERO native dependency, works fully offline, and is the path the
spec explicitly blesses (§3C/§10: eTRM-derived / imported metadata packages when direct
access is unavailable). This closes the long-standing driver gate for now.

- **Made imported metadata a real workflow (not just the mock):** `parseMetadataFile`
  (snapshot.ts) validates an exported/eTRM-derived canonical JSON package and **rejects
  any file carrying a credential** (findSecretLeaks) before parsing. `metadataToModelForSource`
  dispatches EBS vs plain. New **"Import metadata file…"** panel in the Connections dialog:
  pick file → validate → preview (source identity, EBS release, table/relationship counts,
  app-metadata counts, warnings) → import into a model + save a snapshot. No connection,
  no driver.
- Trade-offs accepted (documented in `docs/ORACLE_EBS.md`): point-in-time snapshots not a
  live feed; someone must produce the package (eTRM scrape / FND extract / DBA dump →
  canonical JSON) — that transform lives outside DaMod; only the object kinds we model are
  imported. If a live feed is ever needed, the adapter can slot onto the same contract.
- No new deps, no Rust. 313 TS tests (+6: `importMetadata.test.ts`); tsc/build/cargo clean.

## 2026-10-10 — Req 21 Phase 3 (offline): EBS application-dictionary metadata

EBS application metadata (which product owns a table, concurrent programs, lookups,
program units) is NOT in Oracle catalog views — it comes from the FND dictionary / eTRM.
Modeled it as discovery facts on the snapshot, NOT as model tables (§11 separation).

- **Contract:** optional `metadata.application` = { concurrentPrograms, lookups,
  programUnits (package/package-body/procedure/function/trigger/synonym/type) }.
  Backward-compatible; absent for non-EBS sources.
- **Fixed a Phase-1 serialization bug:** `snapshot.metadataToPlain` had silently dropped
  `source.ebsRelease`/`ebsInstance` and FK `provenance`/`confidence` when persisting a
  snapshot (violating §11/§7). Now serialized deterministically alongside the new
  `application` block; byte-identical round-trip test added.
- **Mock** populates an eTRM-style AP+GL application dictionary; `ebsApplicationSummary`
  counts it; the reverse-engineer preview shows the counts (read-only). Program units /
  concurrent programs are **never turned into entities** (tested).
- **Why not in the EBS Explorer:** the Explorer is model-scoped and §11 says keep source
  metadata separate from the model. So app metadata is shown at discovery time + lives in
  the snapshot; a snapshot browser for an imported model is deferred.
- No new deps, no Rust. 307 TS tests (+4); tsc/build/cargo clean.

## 2026-10-10 — Req 21 Phase 2 (do-now 3): connector-generic Connections UI for EBS

Made the whole EBS path reachable in the app (previously the `oracle-ebs` connector was
registered + tested but had no UI entry point).

- **Connections dialog is now connector-generic** (was Postgres-hardcoded): `connectorFor`
  resolves by `profile.systemType`; `buildModel` dispatches to `ebsSnapshotToModel` for
  EBS (product tags + verified descriptions + provenance) vs `metadataToModel` otherwise.
  Reverse + Refresh panels use the resolved connector, so Postgres behaviour is unchanged.
- **"+ Oracle EBS (mock)" connection**: systemType `oracle-ebs`, instance-only params, NO
  credentials/keychain (it's offline). EBS-specific editor; Test reports the EBS release +
  Oracle DB version (separately) via the connector; Reverse-engineer imports an
  EBS-enriched model; Refresh & compare works via the existing drift/apply path.
- Kept the author-verified Postgres path intact (branch on `isEbs`, no behaviour change).
- 303 TS tests (+3: `EbsConnection.render.test.tsx` — EBS editor fields, create button,
  Test output); tsc/build/cargo clean.
- The live Rust Oracle adapter remains the only EBS gap (driver sign-off + an instance).

## 2026-10-10 — Req 21 Phase 2 (do-now 2): EBS-aware Explorer view

Read-only EBS view of the ACTIVE model, reusing the Req 18 active-model scoping.

- **`explorer/ebsTree.ts`** (pure, tested): `hasEbsContent`, `ebsEntityProduct`,
  `ebsGroups(model, "product"|"schema")` — regroups discovered tables using the
  `entity.source` provenance (+ `ebs:<CODE>` tags) into the two eTRM-style sibling
  branches (application products / database schemas). Ungrouped objects bucket last.
- **`explorer/EbsExplorer.tsx`**: product/schema segmented toggle, counts, search,
  expand/collapse, click-to-reveal (`revealEntity`), columns under each table. Pure
  navigation — never mutates (creation/editing stay in the standard Explorer/Inspector).
- **Wired into `ModelExplorer`** as a Model/EBS header toggle shown ONLY when the active
  model carries EBS/Oracle provenance; falls back to the standard tree otherwise, and
  reverts automatically when switching to a non-EBS tab.
- **Inspector**: the entity General tab now shows a read-only discovery-source block
  (system/product/schema/nativeId/provenance/confidence), labelled verified-vs-inferred
  (§5).
- Deferred: wiring the `oracle-ebs` source into the New Model / Connections UI (§2) and
  the live Oracle adapter (driver sign-off). 300 TS tests (+9); tsc/build/cargo clean.

## 2026-10-10 — Req 21 Phase 2 (do-now track): source provenance + idempotent re-discovery

Built the driver-independent half of Phase 2 (needs no Oracle instance / no sign-off).

- **`Entity.source` provenance** ({system, schema, nativeId, product, provenance,
  confidence}) — optional, backward-compatible, deterministic serialize + Zod. Set by
  `metadataToModel` for EVERY connector (nativeId, else `schema.name` as the stable key),
  enriched with product for EBS in `ebsSnapshotToModel`. Reusable beyond EBS (Postgres
  re-discovery benefits too).
- **`reconcileDiscoveredModel(existing, fresh)`** (`connectors/reconcile.ts`) — the real
  idempotency: matches entities by `source.nativeId`, so repeated discovery UPDATES in
  place instead of duplicating (§6/AC-6). Fresh discovery is the source of truth only for
  physical STRUCTURE; manual edits are preserved — entity logical names, descriptions,
  canvas layout, stereotype, note, udps, tags (union with discovered tags), and per-field
  logical name/description (matched by column name). Relationships are remapped onto the
  reconciled ids and keep their existing id + manual verb phrases when the same edge
  existed. **Removed objects are reported but KEPT pending review (§11)** — removal is a
  structural change, not something a refresh does silently; edges to kept-undiscovered
  entities are preserved so nothing dangles.
- No new deps, no Rust. 291 TS tests (+6: `reconcile.test.ts`); tsc/build/cargo clean.
- Still deferred: the EBS-aware Explorer UI and the live Oracle adapter (driver sign-off).

## 2026-10-10 — Req 21 (Phase 1): Oracle EBS offline/mock foundation

The author chose the **offline/mock** scope (no live driver this session). Rationale:
a live Oracle/EBS connector needs a Rust Oracle driver (Instant Client — a real
licensing/packaging/Apple-Silicon concern) that per NFR-8 requires author sign-off, and
it's untestable here (no Oracle instance; Claude can't self-drive live DBs). So Phase 1
builds everything that does NOT need the driver, fully unit-tested.

- **Reused the connector framework wholesale.** `metadata.ts` already anticipated
  `oracle`/`oracle-ebs`/`oracle-fusion` source kinds and is object-centric with a
  per-object `native` bag — so EBS application metadata (which module owns a table, its
  business purpose) rides in `native.ebs` with ZERO changes to the shared contract
  except two backward-compatible optional additions: `source.ebsRelease`/`ebsInstance`
  (kept SEPARATE from the Oracle DB `productVersion`, §2/§11) and FK
  `provenance`/`confidence` (§7 evidence hierarchy: declared-fk → ebs-metadata →
  etrm-import → user-mapping → ai-proposed). Existing snapshots still validate.
- **Delivered (tested):** `oracleTypes.mapOracleType` (NUMBER/VARCHAR2/CLOB/DATE/
  TIMESTAMP/…; unmappable BLOB/RAW/spatial preserved as native); a mock EBS connector
  with an eTRM-style AP+GL fixture (composite keys, documented-vs-declared FKs, business
  descriptions); `ebsSnapshotToModel` reusing the EXISTING `metadataToModel` (product
  tags `ebs:<CODE>`, verified business descriptions, byte-identical round-trip);
  `ebsProducts` (catalog derived from real annotations, not an assumed list); idempotent
  re-discovery via the existing `computeDrift` (no duplicates); offline import path.
- **Honesty guards (§5/§7):** `EbsAnnotation.verified` distinguishes documented metadata
  from inferred meaning, and inferred descriptions are NOT promoted into model text; a
  real DB comment is never overwritten by an eTRM description; AI-proposed relationships
  carry `provenance: "ai-proposed"` + confidence and are never emitted as declared FKs.
- **Capability matrix + driver trade-off + phased roadmap:** `docs/ORACLE_EBS.md`
  (Done/Mock/Live/Imported/Deferred per capability). The live Rust adapter + EBS
  Explorer/Inspector/Copilot/pipeline UI are documented as deferred phases.
- **No new dependencies, no Rust, no model-schema change.** 285 TS tests (+12); tsc +
  build + cargo clean.

## 2026-10-10 — Req 19 (first batch) + Req 20: PG objects + context indicator

**Req 20 — Model Context Indicator.** A compact `Model · Level · Database` badge in
the always-visible top ribbon bar (`ModelContextIndicator.tsx`). Pure display: reads
the active model's `name`/`level`/`dialect` via primitive selectors (no new state, no
undo). `databaseLabel` is deliberately strict — it returns "Database-independent" for
Conceptual/Logical, "Database not configured" when a physical model has no dialect, and
NEVER falls back to Postgres (that fallback is `modelDialect`'s DDL concern, not a UI
claim). Replaces the old plain `/ model` crumb. Tested.

**Req 19 — the author chose "option 3": a first batch of real objects + the Phase 1
registry, with the rest documented for later.** Scope was deliberately bounded — the
spec itself mandates testable increments and forbids UI-only placeholder categories.

- **Phase 1 — honest capability registry.** `src/model/objectRegistry.ts` catalogues the
  whole erwin PostgreSQL inventory with per-object `support` (full/partial/none),
  capability flags, valid parent scopes, visible levels and the model backing.
  `objectRegistry.test.ts` ties every `"full"` row to a real backing + store op so the
  registry can't claim unimplemented support. `docs/POSTGRES_OBJECTS.md` is the
  human-readable matrix + the deferred-phase roadmap (so it can be built later).
- **Three objects delivered end-to-end** (model type + factory → store ops with undo →
  deterministic serialize + optional Zod field → validation rule → DDL → Explorer
  category/context + Inspector editor → tests):
  - **Check constraints** — `entities[].checks` (name + expression); inline
    `CONSTRAINT … CHECK (…)`; Checks tab in the table Inspector; CK node under the table.
  - **Schemas** — first-class `schemas` (`CREATE SCHEMA [AUTHORIZATION]` + `COMMENT ON
    SCHEMA`); Explorer "Schemas" category; schema Inspector; a table's General tab sets
    its schema; **delete detaches tables, never deletes them** (§6/§8). Table→schema
    *name-qualification* in table DDL is explicitly deferred (documented).
  - **Materialized views** — reused the existing `View.materialized` (DDL already
    emitted it) + added `withNoData`; separate Explorer category + Inspector toggles.
- **Reuse over duplication.** New objects flow through the SAME `commit`/undo, serialize,
  Zod-optional-field (no silent migration of old models), `validateWorkspace`, and
  `exportModelDDL` paths. Matviews were already half-built in `ddl.ts` — surfaced, not
  reinvented.
- **Deferred (documented in `docs/POSTGRES_OBJECTS.md`):** the §4 PostgreSQL type-system
  expansion, and Phases 2–6 (programmable objects, roles/permissions, casts/collations/
  extensions, servers/tablespaces/transforms, deeper reverse-eng + dependency prompts).
  The registry marks all of these `none` with no capabilities — catalogued, not claimed.
- 273 TS tests (+16: `toolbar/ModelContextIndicator`, `model/pgObjects`,
  `model/objectRegistry`); tsc + build + cargo clean.

## 2026-10-10 — Req 18: Model Explorer scoped to the active model tab

The Explorer used to render a "Workspace" root listing **every** open model's full
tree at once (e.g. `Orders` *and* `damod_test`), which was confusing while editing one
model. It now shows **only the active model's** tree.

- **Scoped render, no new state.** Derived `activeEntry = models.find(m => m.tabId ===
  activeId)` and render a single `ModelBranch` for it instead of `models.map(...)`. The
  Explorer keeps NO separate active-model state — it reads `activeId` + `activeModel`
  from the existing stores (§4). Tree depths re-indexed by −1 so the active model is the
  root (depth 0); `ModelBranch`/`EntityBranch`/`ObjectGroup`/`RelationshipRow` otherwise
  unchanged (focused correction, not a rewrite).
- **Tabs stay the switcher.** `TabBar` already switches open models; the Explorer no
  longer doubles as a model list. Moved the "New model" `+` from the old Workspace root
  to an Explorer-head icon button. Inactive models remain open (their tabs + parked
  models untouched) — verified by test.
- **Selection can't go stale across models.** No Explorer change needed: `switchTab →
  activate → modelStore.loadModel` already resets `selection: null` (and parks the
  outgoing model back into its tab). So a selection from the previous model is cleared
  on every switch (§4) — covered by a test.
- **Expansion per model.** Expansion keys are already tab-scoped (`m:<tabId>:…`) and
  persisted per workspace, so each model's expand/collapse state is retained when you
  switch away and back. A model's node auto-expands the first time it becomes active
  (unless the user already toggled it). `expandAll` now scopes to the active model.
- **Level-aware + validation preserved.** Still uses the active model's level via the
  existing `levelTerms`/`showsPhysicalObjects`/`showsKeys` logic; `validateWorkspace`
  still runs over all models so cross-model link marks stay correct. Semantic layer
  stays a workspace-wide sibling root (it is not per-model in DaMod).
- 257 TS tests (+5: `explorer/ModelExplorer.render.test.tsx` — isolation, tab-switch
  swap, inactive-model preservation, selection clear, level badge); tsc + build + cargo
  clean.

## 2026-10-10 — Req 17: choose the target database when creating a physical model

The New Model dialog now reveals a **required "Target database" selector** when the
level is Physical or Physical/Logical, and hides it for Conceptual/Logical (those
levels are database-independent). The chosen dialect is persisted on the model and is
authoritative for its physical SQL.

- **Reused the existing dialect identifiers** (`DbDialect = "postgres"|"snowflake"|
  "databricks"`, already in `model.ts`, same strings as `export/dialects.DialectId`)
  rather than inventing `postgresql`/… — the PRD said reuse existing ids. The selector
  lists exactly `DIALECT_IDS` (the registry), so nothing shows as supported that the app
  can't generate DDL for.
- **Metadata, not a new type system.** DaMod has ONE fixed canonical physical type set
  (`dataTypes.ts`); dialects differ only in *rendering* (`DIALECTS[id].type` → SQL
  spelling). So `dialect` is stored as model metadata and made authoritative at the
  render boundary: `ExportDialog` now defaults to `modelDialect(activeModel)`, and the
  Inspector's **SQL (DDL) tab renders in the model's dialect** (was hardcoded Postgres).
  Added `modelDialect(model)` = `model.dialect ?? "postgres"` as the single compatibility
  default. We did NOT build per-dialect physical type vocabularies in the grid — that
  would fork the one type engine; the dialect-specific surface is the generated SQL.
- **Honest capability signalling.** Dialect hints in the dialog say Postgres is
  full-support (types, DDL, live connection, reverse-engineering) while Snowflake/
  Databricks are DDL+types only (no live connector yet) — per the PRD's "don't imply
  parity" rule.
- **No silent migration (§4).** `dialect` is an optional Zod field; models written
  before Req 17 parse with no dialect and re-serialize byte-identically (test covers
  this). `modelDialect` supplies Postgres only at point of use. The factory drops a
  dialect passed for a non-physical level. Changing a model's DB later is deliberately
  left as a separate explicit operation (not built here).
- 252 TS tests (+14: `model/dialect.test.ts`, `workspace/NewModelDialog.render.test.tsx`,
  `panels/DdlDialect.render.test.tsx`); typecheck + build + cargo clean.

## 2026-10-10 — Fix a class of Zustand selector infinite loops (blank screen)

Two components crashed to a blank screen via "getSnapshot should be cached →
Maximum update depth exceeded": a selector that builds a NEW value each render
(`useStore((s) => s.model.domains ?? [])` returns a fresh `[]`; same with
`levelTerms(s.model.level)` returning a fresh object) makes `useSyncExternalStore`
think the store changed every render. **Rule:** a Zustand selector must return a
stable reference — select the raw primitive/reference and derive (`?? []`, map,
object build) OUTSIDE the selector, in the render body. Fixed in `DomainsDialog`,
`PropertiesDialog` (field editor) and earlier in `Toolbar`/`PropertiesDialog`
(levelTerms). Audited the whole tree; no other new-array/object selectors remain.
- **New dev dep `jsdom`** + widened vitest `include` to `*.test.tsx`: added a
  component render smoke test (`DomainsDialog.render.test.tsx`) that mounts the
  dialogs against a domain-less model. Verified it *reproduces* the bug (reverting
  the fix throws "Maximum update depth exceeded") and passes once fixed. This locks
  the whole loop class, not just the one symptom. Test-only dep (NFR-8 ok).
- 183 TS tests; typecheck + build clean.

## 2026-10-10 — Level-aware presentation (erwin terminology per modeling level)

Reported bug: switching a model between Logical and Physical did not change the
Model Explorer (still "Entities"/"fields", physical-only objects always shown).
**Root cause (diagnosed, not assumed):** the Explorer already re-renders on level
change (it reads the active model reactively) — the problem was a **missing
level-aware presentation layer**; all labels were hardcoded and physical-only
groups were unconditional. Not stale state, not caching.

- **One source of truth** (`model/levels.ts`): `levelTerms(level)` →
  Conceptual = Business Entity/Attribute, Logical = Entity/Attribute,
  Physical & Physical/Logical = Table/Column; `showsPhysicalObjects(level)` (true
  only where there's a physical implementation — Physical & Physical/Logical);
  `showsKeys(level)` (false at Conceptual). Pure functions, presentation-only.
- **Model Explorer** derives every label from the **per-model** level (so two open
  models at different levels each read correctly): group headers (Entities↔Tables),
  `+`/context-menu add actions (Add entity↔Add table↔Add column), field key markers
  hidden at Conceptual, and **Views/Indexes/Sequences/Raw objects hidden at
  Conceptual/Logical**. Field type labels already used the level-aware
  `fieldTypeLabel`.
- **Extended the same terms** to the Properties dialog (entity title + Fields tab →
  Columns/Attributes), the ribbon **Add Entity/Table** button, and the canvas
  add-entity action — so tree, properties, toolbar and canvas never disagree.
- **No model mutation for labels:** terminology is pure presentation. The `level`
  value itself remains legitimate model state (the existing `relevelModel`
  hide/raise behavior for types is unchanged, FR-11.6). A regression test cycles a
  model through all four levels repeatedly and asserts entity/field/relationship
  **IDs and counts are unchanged** (no duplication, no regenerated FKs).
- **Verified:** 8 new tests (terminology matrix incl. the Logical↔Physical flip,
  visibility gating, level-cycle identity integrity); **181 TS tests**; typecheck +
  build clean.
- **Extension (2026-10-10, §15 step 4 — properties + selection):**
  - The modal **Properties dialog field editor** is now level-aware like the docked
    SidePanel already was: Conceptual shows name + definition/note/UDP only (no
    type/keys/default/domain/role); Logical shows a generic **logical-type** select
    and relabels keys as *Primary identifier* / *Required*; Physical &
    Physical-Logical show the full physical column editor. Hidden controls **never
    delete the underlying data** (unit-tested: a decimal type + SQL default survive
    being hidden at Conceptual).
  - **Selection hygiene** (`setModelLevel`): switching to a level that hides
    physical-only objects clears a selected view/index/sequence/raw object (and
    closes the properties panel) so it never shows a no-longer-visible object;
    entity/relationship/domain selections persist (visible at every level).
  - SidePanel "Fields" heading + add button now use the level term (Attributes/
    Columns). Validation was already level-gated (physical-type/PK/FK/measure rules
    skip Conceptual; DDL export gated by `canExportDdl`) — confirmed, no change.
  - Tests: selection-hygiene matrix + jsdom render tests proving the field editor
    hides physical controls at Conceptual and preserves hidden data. 189 TS tests.
- **Extension 2 (2026-10-10, §6 dual logical/physical names):**
  - Fields already had `logicalName` (physical `name` + logical `logicalName`) but it
    was never displayed. Added the symmetric optional **`logicalName` on Entity**
    (additive, backward-compatible: serialize + Zod + `updateEntity`; old files load
    unchanged). `name` stays the physical identifier used for references and DDL.
  - New **`model/presentation.ts`**: `displayName`/`displayNameParts` resolve which
    name to show per level — business name at Conceptual/Logical (fallback to the
    physical name), physical name at Physical, and physical **with the logical name
    as a secondary** at Physical/Logical (shows the Customer↔dim_customer mapping).
    If there is no logical mapping it falls back silently to the physical name (does
    not invent one, §6).
  - Wired into the **canvas** (node title shows the mapping at hybrid; field names
    follow the level; inline rename edits `logicalName` at Conceptual/Logical and the
    physical `name` at Physical levels), the **Explorer** (labels, search over both
    names, level-aware rename), and the **Properties dialog** (entity + field now
    have a "Logical / business name" input).
  - **DDL export is unchanged — it uses the physical `name`, never the logical name**
    (unit-tested: a `dim_customer`/`Customer` entity exports `CREATE TABLE
    "dim_customer"`, never `"Customer"`). Serialization stays deterministic
    (round-trip test). 196 TS tests.
- **Still open (future):** per-level validation *message wording*; a formal shared
  command-capability registry (§8) beyond the current per-level gating.

## 2026-10-10 — Req 16 Phase 1: collapsible + resizable workspace panels

The immediate usability issue (§8 Phase 1): make Explorer, Properties and Copilot
independently collapsible, resizable, and persisted, so the canvas can reclaim space.
- **One shared chrome** (`workspace/PanelChrome.tsx`): a `ResizeHandle` (drag the
  canvas-facing edge, width clamped 220–620) and a `PanelRail` (collapsed strip with
  a lucide restore button) — reused by all three panels instead of per-panel
  collapse code. Removed the Explorer's ad-hoc internal `collapsed` state.
- **uiStore** gains `copilotOpen` + `explorerWidth`/`propertiesWidth`/`copilotWidth`
  + `applyLayout(mode)` (full/modeling/ai/review presets, §1.3), all persisted to
  localStorage (never model JSON, no undo entries). Copilot visibility moved from
  App local state into uiStore so it persists.
- **App layout**: each panel is a width-controlled frame with a resize handle, or a
  rail when hidden; the canvas is `flex:1` so React Flow's ResizeObserver reclaims
  the space automatically (no `fitView` call → node positions preserved). Copilot
  stays **mounted-but-hidden** when closed so its draft/plan survive (§3.4, AC #13).
- View menu adds an **AI Copilot** toggle and a **Layout** preset section.
- Panels fill their frame and scroll internally (Properties got a sticky header +
  `.side__scroll`), so the workspace never overflows horizontally.
- **Verified**: 5 new uiStore tests (independent copilot toggle, width clamping,
  layout presets, persist round-trip of widths+copilotOpen); **230 tests**;
  typecheck + build clean.
- **Phase 2 (done next):** the Properties modal's Columns/Attributes tab is now a
  **compact, level-aware column grid** (§2.2) instead of one big expandable card per
  field. Name/type/params/PK/NN/unique/default edit **inline** in a dense table;
  type-aware params (length for string, precision+scale for decimal); a `⋯` expander
  opens a `FieldDetail` row (logical name, domain, role, definition, note, UDP);
  reorder (↑↓), delete (✕) and + Column via the existing ops. Columns shown adapt to
  `inspectorCaps` (Conceptual → name + description only; Logical → logical type +
  keys; Physical → full). Object header + tabs are sticky; the panel scrolls
  internally. 4 grid interaction tests (inline edit, checkbox toggle, add/delete,
  detail expand). **234 tests.**
- **Phase 3 (done):** Copilot panel redesign (§3). Clickable privacy status
  (opens settings), a **Context** block (scope chips + a live summary of what's
  sent, scoped to the selection or model + level), **suggested-prompt chips** that
  adapt to the selected object (§3.2), a comfortable composer with **⌘↵ to send**,
  and a **Conversation history** of past operations (prompt → summary → applied/
  skipped/failed/rejected). History + draft live in an **in-memory session store**
  (`copilot/session.ts`) so they **survive collapsing/reopening** the panel
  (AC #13) — not persisted to disk (privacy: may contain context/responses). The
  propose→review→approve/reject→execute flow and single-undo are unchanged. 3
  session tests; **237 tests.**
- **Deferred (reported):** Phase 4 — deeper inspector↔Copilot integration polish
  (e.g. click a history entry to select affected objects). The core integration
  (selection → default context, apply updates inspector/canvas/Explorer) works.

## 2026-10-10 — AI Modeling Copilot (§14) — Stages 1–4 foundation

Optional BYOLLM copilot that proposes structured, reviewable plans applied through
the EXISTING modeling command layer — never a second modeling engine, never direct
JSON/state mutation. Entirely optional: all deterministic modeling works with
Copilot off. Implemented per §14.13 as a bounded vertical slice (not all stages).

- **Stage 1 — command layer** (`copilot/actions.ts`, `execute.ts`): Zod action
  schemas (`create_entity`, `update_description`, `create_relationship`); the
  executor resolves names→ids and applies actions via the **existing modelStore
  ops**, idempotently (skips duplicates), re-validates, and reports per-action
  results. New `modelStore.applyAsOne(fn)` collapses the batch into **one undo
  step**. A rejected plan is simply never executed → model byte-identical.
- **Stage 2 — provider + privacy** (`provider.ts`, `privacy.ts`, `settings.ts`):
  BYOLLM `Provider` interface + OpenAI-compatible adapter (endpoint-validated,
  https/localhost only) + `MockProvider` for tests. **API key only in the OS
  keychain** (new Rust `secret_get` + `lib/secrets.ts`), read just-in-time in the
  network layer, never in React state/JSON/localStorage/logs. Privacy policy
  (`verified`/`unverified`/`unsupported` no-training; `require-verified` blocks
  confidential context when unverified); hard secret-leak guard on context;
  context categories shown before sending. No telemetry.
- **Stage 3–4 — context + panel** (`context.ts`, `orchestrate.ts`,
  `CopilotPanel.tsx`): minimal non-secret context (names/types/relationships/
  domains for the chosen scope); orchestrator gates privacy → builds context →
  calls provider → Zod-validates the plan. Panel (toolbar **Copilot** toggle):
  prompt, provider/privacy status, plan preview with assumptions, approve/reject,
  result summary, one-click undo. End-to-end example working: **update entity
  descriptions through a reviewed plan**.
- **Reused, not duplicated**: all mutations go through existing ops; validation via
  `validateWorkspace`; secrets via the keychain commands built for Postgres;
  redaction via `findSecretLeaks`.
- **Verified**: 20 new tests (plan Zod validation, execute incl. single-undo
  atomicity + idempotency + reject=unchanged, privacy enforcement, redaction,
  endpoint safety, context minimisation, no-key persistence, mock end-to-end,
  panel render). **216 TS tests; Rust compiles; typecheck/build clean.** No live
  API key needed for tests.
- **Not done (later stages)**: naming-standard/domain/semantic AI actions,
  streaming, conflict-regeneration UI beyond the updatedAt check, a Rust-side LLM
  proxy (current adapter reads the key just-in-time in JS — documented trade-off;
  hardening is Stage 7). Honest privacy: the app never claims no-training/retention
  the provider can't substantiate.

### Code-size budget raised (NFR-10)
App code reached ~15k, the original Phase-4 target. **Justified raise:** the product
has grown well past the original spec — a full connector framework, ETL pipeline
planner, and now an AI copilot, each in small isolated modules that don't touch the
modeling core. New working target **~20k**; the modeling core itself remains compact.

## 2026-10-10 — UI: View menu, bottom + floating toolbars (§13)

Professional IDE-style workspace controls, added as an extension (canvas, model
state, persistence, connector architecture all untouched).
- **New dep `lucide-react`** (NFR-8 note): the app had no icon library and only
  unicode-glyph buttons; §13.5 asks for a consistent (preferably Lucide) set.
  Tree-shaken per-icon imports, negligible bundle impact. One icon package only.
- **`uiStore` (Zustand, `src/store/uiStore.ts`)** — UI preferences kept **separate
  from model/connector state** and persisted to **localStorage** (`damod.ui`), NOT
  into model JSON, so UI changes never diff the data model (§13.6, AC #9). Holds
  toolbar mode (`bottom`/`floating`/`hidden`), floating position, and
  explorer/properties/validation/grid/snap visibility. Pure helpers
  (`defaultUiPrefs`, `mergePrefs`, `pickPersisted`, `clampToBounds`) are unit-tested
  without a DOM; localStorage access is feature-detected so node tests run clean.
  Chose localStorage over the Rust `app_state` file to avoid clobbering the
  workspace pointer and to keep prefs fully isolated (no new DB/cloud).
- **View menu** (`toolbar/ViewMenu.tsx`): reflects panel/toolbar/grid/snap state
  (checkmarks + active-mode dot) and runs zoom/fit/reset through React Flow's own
  controls via a small `canvasControls` bridge (no competing zoom logic, §13.7);
  Escape/outside-click close; menu items are real buttons (keyboard-accessible).
- **Bottom toolbar** (`canvas/BottomToolbar.tsx`) and **refactored floating
  toolbar** (`canvas/FloatingToolbar.tsx`) share one `useCanvasActions` hook and a
  `ToolbarButton` (lucide icon, `aria-label`+tooltip, hover/active/disabled/focus,
  `aria-pressed`). Only one primary toolbar shows at a time (driven by mode).
  Floating toolbar is draggable **only by a grip handle** (buttons keep their
  click action), `clampToBounds`-constrained, re-clamped on window resize, and
  marked `nopan nodrag` so it never starts a React Flow pan/selection (§13.3/§13.7).
- Panels (ModelExplorer / SidePanel / ValidationPanel) are gated by `uiStore`;
  switching toolbar modes or panel visibility does not touch the active model,
  layout, zoom, selection, or undo (separate stores — AC #10, unit-tested).
- **Verified:** 12 new tests (placement, per-panel visibility, grid/snap,
  model-state-untouched, prefs merge/round-trip, clamp incl. resize/oversize);
  **173 TS tests**; typecheck + build clean.
- **ERwin-style ribbon** (follow-up to author feedback — the old single-row text
  toolbar overflowed the window): `toolbar/Toolbar.tsx` is now a two-row ribbon —
  a bar (brand · workspace chip · `/ model` breadcrumb · **File/Home/Diagram/Data**
  tabs · View menu · icon search) over a contextual content row of lucide
  **icon+label** buttons grouped with captions (ERwin ribbon groups). File = model
  lifecycle (new/duplicate/import/export/history); Home = model name/level/notation
  + add entity/domains + arrange/star + undo/redo; Diagram = map/semantic + grid/
  snap/zoom/fit/reset (via the canvas-controls bridge); Data = connect/pipelines.
  The `Props` interface is unchanged, so `App.tsx` was untouched. All actions wire
  to the same existing commands.
- **Not done:** no per-action global keyboard shortcuts beyond the existing
  ⌘S/⌘Z/⌘⇧Z/Esc/Enter/Delete (tooltips document those); snap uses a fixed 16px grid.

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
