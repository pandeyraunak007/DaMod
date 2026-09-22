# DaMod — Personal Data Modeling Tool

A single-user, local-first desktop app for drawing relational data models, saving
them as plain JSON files, linking entities across models, and defining a semantic
layer on top. Built solo with Claude Code. See
`Personal Data Modeling Tool — Requirements (1).md` for the full spec and
`DECISIONS.md` for the running decision log.

## Stack

- **Tauri v2** (Rust shell) wrapping a **React 19 + TypeScript** frontend (Vite 8)
- **React Flow** (`@xyflow/react`) for the canvas
- **Zustand** for state
- **Vitest** for unit tests

## Prerequisites

- Node 20+ and npm
- Rust toolchain (`rustup`) — the Tauri shell is compiled with cargo
- macOS with Xcode Command Line Tools

## Develop

```bash
npm install          # install frontend deps
npm run tauri dev    # launch the desktop app (compiles the Rust shell on first run)
npm test             # run unit tests
npm run typecheck    # tsc --noEmit
```

`npm run dev` runs the frontend alone in a browser at http://localhost:1420 if you
want to iterate on UI without the desktop shell.

## Build phases

The tool is built in five phases, each ending in a working app and a passing
acceptance-test group (see the requirements doc):

0. **Scaffold** — repo, app shell, empty canvas, test runner ← *current*
1. One model (entities, fields, relationships, canvas)
2. Persistence (workspace + JSON files)
3. Cross-model linking + validation
4. Semantic layer + export (Postgres DDL, YAML)
