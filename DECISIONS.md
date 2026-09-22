# Decision log

Claude Code keeps this log so the author can read *what was chosen and why*
instead of the code (per the "Working context and verification" section of the
requirements). Newest entries at the top. Each entry: what, why, and what was
deliberately not done.

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
