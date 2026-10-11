# DaMod — Claude Code Project Guide

> Entry point for any Claude Code session. Read this first, then `DECISIONS.md`
> (dated decision log, newest at top — the author reads it instead of the code) and
> `docs/CONNECTORS.md` (connector/ETL contract reference). The full product spec is
> `Personal Data Modeling Tool — Requirements (1).md`.

---

## NEXT SESSION — START HERE

**Current status:** Branch `main`, **all work committed AND pushed** (latest `067ac6c`).
**559 TS tests pass · typecheck clean · `npm run build` clean** (no Rust changed recently).
Author commits/pushes explicitly — but this session the author repeatedly authorized it, so
everything is on `origin/main`. Newest `DECISIONS.md` entries cover each item below (newest
on top); the standards work still has its own reference `docs/STANDARDS.md`, connector/ETL
is `docs/CONNECTORS.md`, ETL gaps are `docs/etl_e2e/ETL_GAP_REGISTER.md`.

**Most recent session (workspace UX + connectors + ETL Copilot) — all shipped:**
- **Tabs: close ≠ delete.** The tab `✕` now CLOSES the tab (keeps the file); delete moved to
  right-click (and the Explorer context menu), still gated by the "cannot be undone" confirm.
  A `+` picker in the tab bar reopens closed models. Store: `availableFiles`, `closeTab`,
  `openModelFile` (`workspaceStore`).
- **Launch no longer force-opens every model.** `openWorkspace` opens only the previously-open
  set (`meta.openModels`) or the active/first model. New **"Open model file…"**
  (`openModelFilePicker`) — pick a single `.model.json`; its folder opens as the workspace
  (File ribbon + Welcome).
- **UX hardening pass** (review-driven): closing the last tab resets the model store to a blank
  + Home/Diagram ribbon gated on `activeId` (no phantom editing); `openWorkspace` saves the
  dirty model before switching; `+` menu has Escape/outside-click dismissal.
- **Reverse-engineering BROWSE flow** (`ReversePanelBrowse` in `ConnectionsDialog.tsx`): list
  schemas → pick which to discover → browse discovered tables/views (grouped, per-table
  checkboxes) → preview → import. Table exclusion is a pure metadata prune
  (`connectors/browseFilter.ts`); reuses `discover({schemas})`, no new capability/Rust.
- **Copilot `bind_domain`** — attach a reusable domain to columns (omit entity/attribute for
  all). Bulk binds are batched (one notice, not a toast per column) via
  `modelStore.bindFieldsToDomain`.
- **ETL G-UNDO (done):** per-pipeline undo/redo — transient `pipelineHistory` in
  `workspaceStore`; ↶/↷ buttons + ⌘Z/⌘⇧Z in the ETL Designer.
- **ETL G-AI (done):** Copilot ETL actions — `create_pipeline` (source model → target via
  `planFullLoad`) and `add_transform_node` (filter/select/aggregate/distinct, spliced via pure
  `spliceTransformNode` in `graphEdit.ts`). Context now summarizes pipelines.
- **Remaining ETL gaps (deferred, see gap register):** G-INC (incremental/CDC), G-EXEC
  (execution — intentionally external/authorized/dry-run-first). Optional niceties:
  `suggest_mapping` advisory action, derive/cast transform nodes.

**Standards backlog (still deferred, see `docs/STANDARDS.md`):** Postgres `CREATE DOMAIN`
DDL + domain reverse-eng (opt-in), naming auto-apply-to-new-objects, reserved-word/
per-dialect length rules, Explorer nodes for standards, Copilot domain apply/detach +
standard update/delete, a real Copilot before/after diff.

Older context (standards roadmap + Reqs 17–23) follows below.
- See the top DECISIONS entries:
- **Subject areas for ALL databases:** the standard Model Explorer now has a Subject
  areas section (create/rename/delete, add selected table, entity-context "New subject
  area from this") for any source — the EBS/Fusion "from product/family" stays as a
  convenience. Store op `addEntityToSubjectArea`. **Copilot** has a matching
  `create_subject_area` action (by table names or product/family code; reviewed/approved
  like other actions).
- **Subject-area diagrams (erwin-style):** a subject area can be viewed as its own
  scoped canvas diagram (member entities + relationships among them; views hidden), via a
  canvas diagram-selector bar and clicking a subject area in the Explorer. Transient
  `modelStore.activeDiagram` (resets per tab); pure filter `canvas/subjectAreaDiagram.ts`.
  MVP reuses shared entity positions — independent per-area layouts are a future item.
- **Copilot action parity:** the Copilot can now also create **semantic-layer** objects
  (`create_term`/`create_dimension`/`create_metric`) and all remaining model objects
  (`create_schema`/`create_view`/`create_index`/`create_sequence`/`create_domain`/
  `create_check_constraint`/`set_stereotype`) — all through the existing store/semantic
  ops, reviewed + approved, one undo group for model actions. Context now summarizes the
  semantic layer. Create-only for the new types (update/delete deferred).
- **Req 23 (Snowflake, Phase 1–2):** Snowflake was already a DDL dialect/target/source
  type; added the missing **connector to discover FROM Snowflake** (`snowflake` mock) +
  `mapSnowflakeType` (VARIANT/GEOGRAPHY/… preserved as native). End-to-end path works:
  "+ Snowflake (mock)" → discover → reverse-engineer → Snowflake DDL → compare. Data-
  engineering objects (stages/pipes/streams/tasks/dynamic tables), governance, and the
  live adapter are deferred (`docs/SNOWFLAKE.md`). **Table variants** (`Entity.tableKind`)
  + **constraint enforcement** (`Relationship.enforced`, §4.2) are DONE — Snowflake emits
  `CREATE TRANSIENT/HYBRID TABLE` + `NOT ENFORCED` on non-hybrid tables; a validation rule
  warns on enforced-FK-on-non-hybrid.
- **Req 22 (Fusion Cloud, offline/mock):** `oracle-fusion` mock connector (Financials),
  `mapFusionType`, `fusionSnapshotToModel`, `metadata.fusion` (REST resources + extract
  data stores), `source.apiVersion`, connector-generic Connections UI, and a
  **Fusion-aware Explorer view** (family/module grouping) sharing the `AppExplorer`
  component with EBS (Model/EBS|Fusion toggle), and a **Fusion business-object Properties
  panel** (Inspector General tab shows family/module/API path/version). Live REST connector
  + API-resource/extract panels deferred (`docs/ORACLE_FUSION.md`).
- **Field-level source provenance:** `Field.source` (reuses `ObjectSource`) carries the
  **source-native type** (`col.nativeType`) for every connector; the column detail editor
  shows a read-only "Source-native type" row. Shared `sourceToPlain` serializer.
- **Source-snapshot browser** (`connectors/ui/SnapshotBrowser.tsx`, Data → Source
  snapshot): shows a model's snapshot-only metadata — EBS app dictionary (concurrent
  programs/lookups/program units) + Fusion API resources/extract data stores + source
  identity. Loads the active model's snapshot by name (reverse-eng + import both save it).
- **Source-to-target mapping (Req 22 §8):** the pipeline designer has an editable
  **Mapping** tab (`connectors/pipeline/MappingEditor.tsx`) — rename target columns,
  convert types, add transforms, drop/add columns, live-validated, saved via
  `upsertPipeline`. General (any source model → PG/Snowflake/Databricks). Joins/filters
  across objects deferred.
- **Req 21 Phase 4 (part):** `SubjectArea` model concept + `createSubjectAreaFromProduct`
  + EBS Explorer "+ area" / Subject Areas list. A lens, not a container (delete never
  deletes entities).
- **Req 21 driver decision (2026-10-11):** imported-metadata-only — no native Oracle
  driver (deferred indefinitely). "Import metadata file…" loads an exported/eTRM canonical
  JSON (rejects credential leaks). The driver gate that blocked the connector roadmap is
  now closed.
- **Req 21 (Phase 1)** — Oracle **EBS offline/mock** foundation (no live driver, no Rust,
  no deps): mock `oracle-ebs` connector + eTRM-style fixture, `mapOracleType`,
  `ebsSnapshotToModel` (reuses `metadataToModel`), FK provenance/confidence + EBS release
  (separate from DB version), capability matrix + driver trade-off in `docs/ORACLE_EBS.md`.
  Live Rust Oracle adapter still gated on a driver sign-off (documented there).
- **Req 19 (first batch) + Req 20** — Model Context Indicator (`Model · Level · Database`
  badge in the ribbon, pure display, never assumes Postgres). Req 19 was scoped by the
  author to "option 3": a canonical **object registry** (`src/model/objectRegistry.ts`,
  honest support flags, kept truthful by a test) + **capability matrix/roadmap**
  (`docs/POSTGRES_OBJECTS.md`), plus three objects end-to-end — **check constraints,
  first-class schemas, materialized views** (model→store→serialize→Zod→validation→DDL→
  Explorer→Inspector→tests). The rest of the erwin inventory + the §4 type-system
  expansion are catalogued as `none`/deferred in the matrix — build later from there.
- **Req 18** — Model Explorer shows only the **active model tab's** tree; tabs (`TabBar`)
  switch models; selection auto-clears on switch via `loadModel`; expansion per-model.
- **Req 17** — New Model dialog's required Target database selector; `model.dialect`
  persisted + authoritative (ExportDialog + Inspector SQL tab); optional Zod field.

**Req 21 (Oracle EBS) — offline track COMPLETE.** Shipped: Phase 1 (mock connector,
`mapOracleType`, `ebsSnapshotToModel`, FK provenance, EBS-release-vs-DB-version), Phase 2
(`Entity.source` + `reconcileDiscoveredModel` idempotent re-discovery, EBS-aware Explorer
view, connector-generic Connections UI), Phase 3 (app-dictionary metadata: concurrent
programs / lookups / program units on the snapshot + the metadataToPlain serialization
fix), and the **driver decision — imported-metadata-only** with a working "Import metadata
file…" flow. The native Rust Oracle adapter is **deferred indefinitely** (decided against;
the contract is ready if a live feed is ever needed). No open EBS blockers.

**Highest-priority next task — author's choice between two good options (ask if unsure):**
- **A) PostgreSQL type-system expansion (Req 19 §4)** — the best offline ROI, improves the
  ONLY live connector. Replace the fixed generic 10 types with real PG types
  (`smallint`/`real`/`bytea`/geometric/network/`bit`/`jsonb`/`xml`/…): extend
  `DATA_TYPE_KINDS` (`model/dataTypes.ts`), a type-aware Inspector, dialect renderers
  (`export/dialects.ts`), and `mapSqlType`/`mapOracleType`. Bounded + fully testable.
  Catalogued in `docs/POSTGRES_OBJECTS.md` (§4).
- **B) Req 21 Phase 4+ (still offline-testable on the mock/imported path):** logical/
  conceptual generation + subject areas by EBS product; EBS Copilot context + reviewed
  actions (Phase 5); pipeline planning from EBS metadata (Phase 6); a snapshot browser
  that shows app metadata for an imported model. All catalogued in `docs/ORACLE_EBS.md`.

**Verification reality (important for whoever's next):** Reqs 17–21 are **author-verified
only** — Claude cannot drive the native Tauri window or a live DB, and the sandboxed
Chrome can't reach the dev server. Everything is tsc/test/build/cargo-green and a clean
`tauri dev` boot, but the UI click-throughs (New Model dialog, EBS Explorer toggle,
Connections + Import flows) have NOT been visually verified — worth a hands-on pass.

**Files to inspect first (for either option):** `docs/ORACLE_EBS.md` and
`docs/POSTGRES_OBJECTS.md` (matrices + roadmaps), `src/connectors/oracle/` (EBS layer),
`src/connectors/{metadata,toModel,reconcile,snapshot,drift}.ts`, `src/model/dataTypes.ts`
+ `src/export/dialects.ts` (for option A), `src/model/objectRegistry.ts`.

**Standing constraints:** ~20k LOC budget (NFR-10). **Req 16 Phase 4 deferred** (deeper
Inspector↔Copilot integration). Secrets only in the OS keychain; metadata-only discovery.

---

## 1. What DaMod is

A **single-user, local-first macOS desktop app** for **relational + dimensional data
modeling, reverse-engineering, ETL pipeline design, and AI-assisted modeling**. It
"owns nothing but a folder of files": every model is plain, Git-diffable JSON.
No accounts, no telemetry, offline-first. Built solo with Claude Code.

It began as an ERwin-style modeler (Phases 0–4 of the original spec) and has since
grown a reusable **connector framework + ETL planner** and an **AI Copilot (BYOLLM)**.

## 2. Tech stack (locked — do not migrate)

- **Tauri v2** (Rust shell, macOS/Apple-Silicon) · **React 19** + **TypeScript** + **Vite 8**
- **React Flow** (`@xyflow/react`) — the modeling canvas
- **Zustand** — all app state · **Zod** — schema validation · **Vitest** — tests
- `lucide-react` (icons), `yaml`, `@tauri-apps/plugin-dialog`. Rust: `tokio-postgres`,
  `tokio`, `keyring` (OS keychain). Any new dep needs a `DECISIONS.md` line (NFR-8).

## 3. Repo / commands / verification

- Path: `/Users/raunakpandey/Documents/DaMod` · GitHub `origin` → `github.com/pandeyraunak007/DaMod`
- Source Rust env first for anything cargo/tauri: `source ~/.cargo/env`
- `npm test` (Vitest) · `npx tsc --noEmit` · `npm run build` · `npm run tauri dev`
- Rust: `cd src-tauri && cargo build` (and `cargo test --lib pg::` for unit tests)
- **Verification limits:** Claude cannot self-drive the native Tauri window
  (screenshots/driving unavailable). The author runs acceptance scenarios by hand.
  Claude verifies via `npm test`, `tsc`, `npm run build`, `cargo build`, and a clean
  `tauri dev` boot (watch `/tmp/damod-tauri.log`). Postgres testing uses
  `brew services start postgresql@16` (currently **stopped**). The Copilot needs the
  user's own BYOLLM key (Groq works: base `https://api.groq.com/openai/v1`; enabled
  models vary by account — use "Load available models").
- Author's cross-session memory (not in repo): `~/.claude/projects/-Users-raunakpandey-Documents-DaMod/memory/`

## 4. Architecture & where things live (`src/`)

- `model/` — **single source of truth** for the domain. `model.ts` (Entity/Field/
  Relationship/View/Index/Sequence/RawObject/Domain types + factories), `operations.ts`
  (createRelationship, deleteEntity, relevelModel, FK reconciliation), `dataTypes.ts`
  (fixed type set, no free text), `levels.ts` (**level-aware presentation layer**:
  `levelTerms`, `showsPhysicalObjects`, `showsKeys`, `inspectorCaps`, `canExportDdl`),
  `presentation.ts` (dual logical/physical name resolution), `identifiers.ts`, `fieldDisplay.ts`.
- `store/` — Zustand: `modelStore.ts` (the ACTIVE model + undo/redo + selection; all
  mutations go through here; `applyAsOne(fn)` collapses a batch into one undo step),
  `workspaceStore.ts` (tabs, file load/save, links, semantic, connections, pipelines,
  snapshots), `uiStore.ts` (UI prefs → **localStorage**, never model JSON).
- `persist/` — deterministic JSON (`serialize.ts`: fixed key order, omit-empty), Zod
  validation + `formatVersion` migration (`schema.ts`), atomic file layer (`fs.ts`),
  filenames (`filenames.ts`), workspace meta (`workspaceFiles.ts`).
- `export/` — `ddl.ts` (CREATE/ALTER, topo order, 3 dialects), `dialects.ts`
  (postgres/snowflake/databricks), `migrate.ts` (diff two models → ALTER), `semanticExport.ts`.
- `import/reverse.ts` — SQL DDL → model parser (`mapSqlType` is the shared native→type mapper).
- `connectors/` — **connector framework** (see `docs/CONNECTORS.md`): `connector.ts`
  (contract), `capabilities.ts`, `errors.ts`, `metadata.ts` (canonical Zod metadata),
  `connection.ts` (profiles, secret-ref only), `snapshot.ts` (deterministic snapshots),
  `registry.ts`, `toModel.ts` (metadata → `.model.json`), `drift.ts` (refresh/compare,
  reuses `migrate.diffModels`), `mock/`, `postgres/` (Rust-backed, catalog-only),
  `pipeline/` (spec + planner + persistence + UI), `ui/ConnectionsDialog.tsx`.
- `copilot/` — **AI Copilot** (see §7): `actions.ts` (Zod action schemas),
  `execute.ts` (apply via existing ops, one undo group, idempotent), `provider.ts`
  (BYOLLM OpenAI-compatible + mock), `privacy.ts`, `context.ts`, `orchestrate.ts`,
  `settings.ts`, `session.ts` (chat thread, in-memory), `CopilotPanel.tsx`.
- `canvas/` — React Flow (`Canvas.tsx`, `EntityNode.tsx`, toolbars, `canvasControls.ts`).
- `panels/` — `PropertiesDialog.tsx` (modal tabbed inspector + **compact column grid**),
  `SidePanel.tsx` (docked inspector), `DomainsDialog.tsx`, `DbObjectEditors.tsx`.
- `explorer/ModelExplorer.tsx` — the workspace tree (level-aware labels).
- `workspace/` — `PanelChrome.tsx` (shared ResizeHandle + collapsed PanelRail), tabs,
  welcome, dialogs. `toolbar/` — ERwin ribbon (`Toolbar.tsx`) + `ViewMenu.tsx`.
- `validation/rules.ts` — one function per rule; `semantic/` — terms/dimensions/metrics/cubes.
- Rust `src-tauri/src/`: `fsops.rs` (atomic workspace file layer), `pg.rs` (Postgres
  connector + `secret_store`/`secret_get`/`secret_delete` keychain), `lib.rs` (command registration).

## 5. CRITICAL coding conventions (learned the hard way)

1. **NEVER build a new value inside a Zustand selector.** `useStore((s) => s.x ?? [])`,
   `useStore((s) => levelTerms(s.level))`, or any `.map`/object literal returns a fresh
   reference every render → "getSnapshot should be cached" → infinite loop → **blank
   screen**. Select the primitive/stable ref and derive OUTSIDE the selector. (This bug
   bit us in `DomainsDialog`, `PropertiesDialog`, `Toolbar`.)
2. **Deterministic serialization is load-bearing.** `serialize.ts` builds plain objects
   with fixed key order and omits empty optionals; serialize→parse→serialize must be
   byte-identical. Many tests assert this. Don't add `Date.now()`/random into model JSON.
3. **UI state ≠ model state.** Panel layout/visibility/widths live in `uiStore` →
   localStorage, never in `.model.json`, and must not create undo history.
4. **Level is presentation + a real transform.** `levels.ts` helpers drive labels/
   visibility (presentation only). BUT `setModelLevel`/`relevelModel` genuinely
   transforms field types (fills on raise, hides-not-deletes on lower — FR-11.6), so a
   level change DOES create one undo entry. Preserve this; don't "fix" it.
5. **Secrets only in the OS keychain** (Rust `keyring`, via `lib/secrets.ts` →
   `secret_store`/`secret_get`/`secret_delete`). Never in JSON, localStorage, logs, or
   React state (except a transient password typed for a pre-save test).
6. **AI never mutates directly.** Copilot proposes a Zod-validated plan; `execute.ts`
   applies it through the SAME `modelStore` ops as manual editing, as one undo group.
7. **Reuse, don't duplicate.** One model engine, one type-mapper (`mapSqlType`), one
   diff (`migrate.diffModels`), one command path. New connectors produce canonical
   metadata and everything downstream just works.
8. Tests: `*.test.ts` run in node; component render tests are `*.test.tsx` with a
   `// @vitest-environment jsdom` pragma. Mock the LLM; no live keys in the suite.

## 6. Implemented features & verified status

Everything below is **committed, 559 tests green, tsc/build/cargo clean**. UI-interaction
details are author-verified in the running app (per verification limits).

**Core modeling (original Phases 0–4):** workspaces + models in tabs; entities/fields/
relationships; fixed type system; composite PKs, unique, defaults, nullability;
1:1/1:N/M:N (auto junction), self-refs, identifying/non-identifying, subtype/category;
FK auto-create + type propagation; crow's-foot **and** IDEF1X; drag/pan/zoom/fit, search,
auto-arrange, star layout, 50+ undo; atomic autosave, `.history/` + restore, external-
change reload, format migration; cross-model links (same-as/references/derived-from) +
workspace map; semantic/OLAP layer (terms, dimensions, time dims, metrics, derived
metrics, cubes, lineage, semantic.yaml); multi-dialect DDL export (Postgres/Snowflake/
Databricks/**Oracle/SQL Server/MySQL/BigQuery** — 7 dialects, as output targets);
one-function-per-rule validation; **four modeling levels** (Conceptual/
Logical/Physical-Logical/Physical) governing fields/canvas/DDL eligibility; Model Explorer tree.

**Beyond-spec modeling:** reusable **domains** (bind + propagate + detach-on-override);
SQL **reverse-engineering** (`.sql` → model); **forward-engineering** (DROP/IF-NOT-EXISTS
options + ALTER migration vs a baseline); **SCD-2 scaffolding** + **fact column roles**
(measure/degenerate); **dual logical/physical names** (`Customer`/`dim_customer`);
**per-model target database (Req 17)** — chosen at create time for physical levels,
persisted as `model.dialect` (`postgres`/`snowflake`/`databricks`), authoritative for
DDL export + the Inspector SQL tab; `modelDialect()` defaults legacy models to Postgres.

**Connector framework + ETL (Phases 1–5, see `docs/CONNECTORS.md`):** canonical metadata
contract, capability/typed-error contract, connection profiles (secret-ref only) + OS
keychain, deterministic source snapshots; **live PostgreSQL connector** (Rust `tokio-postgres`,
catalog-only discovery — composite keys/self-ref/views/reserved-words verified against a
real PG16); reverse-engineering integration (discover → model → save/reopen, imported
`.model.json` round-trips byte-identical — verified); **schema refresh & drift** (snapshot
diff, review, apply preserving manual edits); **ETL pipeline planner** (full-load spec +
type-compat/required/drift validation + target DDL via `exportModelDDL`, deterministic).
Connectors resolved via a registry; a mock connector drives tests.

**Level-aware Properties Inspector:** `inspectorCaps(level)` is the one shared capability
mechanism. Terminology (Entity/Attribute ↔ Table/Column ↔ Business Entity), object-
specific tabs, a **compact column grid** (inline name/type/params/PK/NN/unique/default +
`⋯` detail expander + reorder/delete/add), a **SQL (DDL) tab** gated to physical levels,
RI tab gated to physical, selection hygiene on level change. Hidden metadata is never
deleted (round-trip tested).

**Workspace UI (Req 16 Phases 1–3):** Explorer, Properties, Copilot are **independently
collapsible + drag-resizable** (shared `PanelChrome`), persisted to localStorage, with
collapsed rails and layout presets (Full canvas / Modeling / AI-assisted / Review);
canvas reclaims space (React Flow ResizeObserver, no `fitView` → positions preserved).
**Model Explorer is scoped to the active model tab (Req 18)** — shows only the active
model's tree (derived from `activeId`+`activeModel`, no separate Explorer state); `TabBar`
switches models; expansion is per-model; selection auto-clears on switch via `loadModel`.
A **Model Context Indicator** (Req 20) badge sits in the ribbon (`Model · Level ·
Database`, pure display).

**PostgreSQL object modeling (Req 19, in progress — erwin reference):** a canonical
**object registry** (`src/model/objectRegistry.ts`) with honest per-object support flags
drives the **capability matrix + roadmap** (`docs/POSTGRES_OBJECTS.md`). Real objects so
far: tables/columns/PK/FK/unique + **check constraints**, indexes, views + **materialized
views**, sequences, **first-class schemas**, domains, raw objects. The long tail
(functions/procedures/triggers, roles/permissions, casts/collations/extensions, servers/
tablespaces/transforms, UDTs, and the full PG **type-system expansion** §4) is catalogued
as deferred in the matrix — NOT shown as empty placeholder categories.

**AI Copilot (BYOLLM, §14 Stages 1–4):** a **ChatGPT-style** panel — flowing thread with
user/assistant bubbles and a bottom composer (⌘↵). Propose → review (plan card with
Approve/Reject) → apply through existing ops (one undo group) → inline result + Undo.
Supported actions: create/update/rename/delete for entities, attributes, relationships,
and descriptions; subject areas; schemas/views/indexes/sequences/domains/check-constraints/
stereotypes; semantic-layer objects (terms/dimensions/metrics); naming/type standards
(create + apply); **`bind_domain`** (attach a domain to columns); and **ETL actions**
(`create_pipeline`, `add_transform_node`) — all Zod-validated, idempotent, destructive-gated;
model actions apply as one undo group, ETL actions land in the pipeline's own undo history.
BYOLLM provider
(OpenAI-compatible: Groq tested; Test connection + Load models + JSON-mode fallback);
API key in keychain only; **privacy policy** (verified/unverified/unsupported no-training;
blocks confidential context when unverified; secret-leak guard on context; no telemetry).
Conversation + draft persist across panel collapse (in-memory session store).
Copilot is optional — all modeling works with it off.

## 7. Product requirements on record (do not drop; some deferred)

- **PostgreSQL modeling** + the **four levels** (Conceptual/Logical/Physical-Logical/
  Physical) across Explorer/canvas/properties/toolbar/validation/DDL — **implemented**.
- **Context-sensitive Properties Inspector** — implemented (level-aware, object-specific,
  compact column grid, DDL tab). Deferred polish: more object-type grid views, staged
  Apply/Cancel editing (currently immediate-edit).
- **AI Copilot with BYOLLM + privacy** — implemented (Stages 1–4). Deferred (Stage 5–7):
  naming-standard / business-term / semantic-object AI actions, streaming, a Rust-side
  LLM proxy (current adapter reads the key just-in-time in JS — documented trade-off),
  connector/ETL-assist actions.
- **Workspace UI** (collapsible/resizable panels, persistent layout, max canvas,
  synchronized behavior) — implemented (Req 16 Phases 1–3). Deferred: Phase 4 deeper
  inspector↔Copilot integration.
- **Connector roadmap:** Postgres done; **Oracle (Phase 7) is next**; Fusion Cloud,
  MCP, and real pipeline execution (Phase 6) are later/optional.

See `DECISIONS.md` (top entries) for the full rationale and `docs/CONNECTORS.md` for
the connector/ETL/pipeline contract and phase roadmap.

## 8. Known limitations / deferred (none are "done but broken")

- Live DB + keychain + native-UI flows are **author-verified**, not Claude-verified.
- Copilot: no streaming; key read just-in-time in JS (Rust proxy is the hardening step);
  naming-standard/semantic AI actions not yet built; conflict handling is an `updatedAt`
  check (not a field-level merge).
- No separate physical *entity* schema/catalog fields (only `logicalName` dual naming).
- Pipeline **execution** is intentionally not built (spec: separate, authorized milestone).
- Budget: src ~15.8k lines; the original 15k target (NFR-10) was raised to ~20k with
  justification in DECISIONS (connector/ETL/Copilot are large, isolated additions).

## 9. Handoff rules

- The author pushes explicitly; **do not push** `57aac34`/`dc2b8e9` unless asked.
- Commit per working increment (author reviews via acceptance + tests, not code).
  End commit messages with the Co-Authored-By line.
- Update `DECISIONS.md` (newest entry on top) every increment — the author reads it
  instead of the code. Update `docs/CONNECTORS.md` for connector changes.
- Implement in small, verifiable increments; run `npm test` + `tsc` + `build` (+ `cargo
  build` for Rust) after each; report completed vs deferred honestly.
