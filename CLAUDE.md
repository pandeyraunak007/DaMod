# DaMod — Claude Code Project Guide

> Entry point for any Claude Code session. Read this first, then `DECISIONS.md`
> (dated decision log, newest at top — the author reads it instead of the code) and
> `docs/CONNECTORS.md` (connector/ETL contract reference). The full product spec is
> `Personal Data Modeling Tool — Requirements (1).md`.

---

## NEXT SESSION — START HERE

**Current status:** Branch `main`. Pushed: `cf8c8e2` (EBS sample fixture) and the rest of
Reqs 17–21 Phases 1–3 + the driver decision + file import. **Req 21 Phase 4 (part) —
subject areas by EBS product — just landed, uncommitted in the working tree.** Author
commits/pushes explicitly, do not commit or push unless asked. **320 TS tests pass ·
typecheck clean · `npm run build` clean · `cargo build` clean.** See the top DECISIONS
entries:
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

Everything below is **committed, 238 tests green, tsc/build/cargo clean**. UI-interaction
details are author-verified in the running app (per verification limits).

**Core modeling (original Phases 0–4):** workspaces + models in tabs; entities/fields/
relationships; fixed type system; composite PKs, unique, defaults, nullability;
1:1/1:N/M:N (auto junction), self-refs, identifying/non-identifying, subtype/category;
FK auto-create + type propagation; crow's-foot **and** IDEF1X; drag/pan/zoom/fit, search,
auto-arrange, star layout, 50+ undo; atomic autosave, `.history/` + restore, external-
change reload, format migration; cross-model links (same-as/references/derived-from) +
workspace map; semantic/OLAP layer (terms, dimensions, time dims, metrics, derived
metrics, cubes, lineage, semantic.yaml); multi-dialect DDL export (Postgres/Snowflake/
Databricks); one-function-per-rule validation; **four modeling levels** (Conceptual/
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
and descriptions — all Zod-validated, idempotent, destructive-gated. BYOLLM provider
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
