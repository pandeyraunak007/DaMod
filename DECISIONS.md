# Decision log

Claude Code keeps this log so the author can read *what was chosen and why*
instead of the code (per the "Working context and verification" section of the
requirements). Newest entries at the top. Each entry: what, why, and what was
deliberately not done.

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
