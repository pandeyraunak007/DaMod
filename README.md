# DaMod — Personal Data Modeling Tool

A single-user, local-first desktop app for **relational + dimensional data modeling,
reverse-engineering, ETL pipeline design, and AI-assisted modeling**. Every model is plain,
Git-diffable JSON — no accounts, no telemetry, offline-first. Built solo with Claude Code.

See `Personal Data Modeling Tool — Requirements (1).md` for the full spec, `CLAUDE.md` for
the project guide, and `DECISIONS.md` for the running decision log.

## Stack

- **Tauri v2** (Rust shell) wrapping a **React 19 + TypeScript** frontend (Vite 8)
- **React Flow** (`@xyflow/react`) canvas · **Zustand** state · **Zod** validation · **Vitest** tests
- Runs on **macOS** and **Windows** (Tauri is cross-platform)

---

## Run it on your machine

Tauri apps are compiled for the OS you build on — so build on the machine you want to run on
(you can't produce a Windows `.exe` from a Mac without extra tooling). Pick your platform
below.

### Windows (10 or 11)

**1. Install the prerequisites (one time):**

| Tool | Where | Notes |
|------|-------|-------|
| **Node.js** (LTS) | https://nodejs.org | includes npm |
| **Rust** | https://rustup.rs | accept the default **MSVC** toolchain |
| **Visual Studio C++ Build Tools** | https://visualstudio.microsoft.com/visual-cpp-build-tools/ | run the installer and tick **"Desktop development with C++"** (gives Rust its linker) |
| **WebView2** | pre-installed on Windows 11; on Windows 10 get the [Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) | the webview the app renders in |
| **Git** | https://git-scm.com | to clone the repo |

> After installing Rust, **close and reopen** your terminal (PowerShell) so `cargo` is on PATH.

**2. Get the code and launch the app:**

```powershell
git clone https://github.com/pandeyraunak007/DaMod.git
cd DaMod
npm install
npm run tauri dev
```

The first launch is slow — Rust compiles the shell from scratch (a few minutes). After that
it's fast. A desktop window titled **DaMod** opens.

**3. Build an installer you can keep / share:**

```powershell
npm run tauri build
```

The installers land in `src-tauri\target\release\bundle\` — both an **`.msi`** and an **NSIS
`.exe`**. Double-click either to install DaMod like a normal Windows app.

### macOS (Apple Silicon or Intel)

```bash
# one-time: install Node (nodejs.org or `brew install node`) and Rust (https://rustup.rs),
# plus Xcode Command Line Tools:  xcode-select --install
git clone https://github.com/pandeyraunak007/DaMod.git
cd DaMod
npm install
npm run tauri dev            # run the app
npm run tauri build          # build a .dmg / .app under src-tauri/target/release/bundle/
```

---

## Everyday commands

```bash
npm run tauri dev     # launch the desktop app (compiles the Rust shell on first run)
npm run tauri build   # produce an installer for the current OS
npm test              # run the unit tests (Vitest)
npm run typecheck     # tsc --noEmit
npm run build         # type-check + build the frontend bundle
npm run dev           # frontend only in a browser (UI iteration without the desktop shell)
```

## Good to know

- **Your models are just files.** A workspace is a folder of `.model.json` files (plus
  `workspace.json`, `links.json`, etc.). Copy a workspace folder between machines and open it
  with **Open workspace** or **Open model file…** — no import/export needed.
- **Everything except the live database connector is fully offline** — modeling, Import SQL,
  ETL design, DDL/YAML export, and the AI Copilot all work with no network.
- **PostgreSQL reverse-engineering** needs a Postgres server to point at (host / port / user).
  Install Postgres on the machine or connect to a remote one; credentials are stored only in
  the OS keychain (Keychain on macOS, Credential Manager on Windows) — never in the files.
- **AI Copilot is optional** and bring-your-own-LLM (an OpenAI-compatible endpoint + your own
  API key, held in the OS keychain). All modeling works with it turned off.

## Features (high level)

Entities/fields/relationships on a crow's-foot **and** IDEF1X canvas; four modeling levels
(Conceptual → Physical); reusable domains, naming & data-type standards; SQL
reverse-engineering and multi-dialect DDL export (Postgres/Snowflake/Databricks/Oracle/SQL
Server/MySQL/BigQuery); a semantic/OLAP layer; a connector framework with a live PostgreSQL
connector and a **browse-then-import** reverse-engineering flow; an **ETL pipeline designer**
(visual DAG, SQL generation, per-pipeline undo/redo); and an **AI Copilot** that can propose
reviewed changes to the model, standards, semantic layer, and ETL pipelines.
