# ETL Feature Capability Matrix

Grounded in the current DaMod implementation (verified against source as of this commit).
Legend for **Status**: ✅ implemented+verified · 🟡 partial · 🟦 domain-logic exists, UI thin ·
🟥 not implemented. **Category**: **A** runnable now in DaMod · **B** runnable only with an
external tool (DaMod emits the artifact) · **C** blocked by a product gap.

| Cap | Capability | Status | Cat | Evidence (file) | Notes / gap |
|---|---|---|---|---|---|
| C1 | Launch app (`npm run tauri dev`) | ✅ | A | `package.json`, `src-tauri/` | Vite + Rust boot verified |
| C2 | Create/open workspace + models, tabs | ✅ | A | `store/workspaceStore.ts`, `TabBar` | |
| C3 | Reverse-engineer a model from **SQL DDL** | ✅ | A | `import/reverse.ts` `parseDdl`, `import/ImportDialog.tsx` (File ribbon → **Import SQL**) | No DB needed; CREATE TABLE/PK/FK/standard types |
| C4 | Live DB **metadata discovery** (Postgres) | ✅ | A | `connectors/postgres/`, `src-tauri/src/pg.rs` | Catalog-only; **never reads table rows** |
| C5 | Live DB **data extraction** (read rows) | 🟥 | C | pg CAPS has no `fullExtract` | Connectors are metadata-only |
| C6 | Entities/attrs/keys/FK, data types, domains, naming/type standards | ✅ | A | `model/*`, `panels/*`, `docs/STANDARDS.md` | Full modeling engine |
| C7 | Target model authoring + **Target DDL** generation | ✅ | A | `export/ddl.ts` `exportModelDDL` (7 dialects) | CREATE TABLE text (not executed) |
| C8 | Create/save/reopen a **pipeline** | ✅ | A | `connectors/pipeline/{spec,planner,pipelinesPersist}.ts`, `PipelineDialog.tsx` | `pipelines.json`, v2 |
| C9 | Flat source→target **field mapping** (rename/type/transform/drop/add, filters, joins) | ✅ | A | `pipeline/MappingEditor.tsx`, `planner.validatePipeline` | tabular editor |
| C10 | **Visual DAG designer** (Data ribbon → **Designer**) | ✅ | A | `etl/EtlDesigner.tsx`, `etl/PipelineCanvas.tsx` | separate React-Flow canvas |
| C11 | Transform nodes: source, filter, select, derive, cast, join, target | ✅ | A | `pipeline/spec.ts` `NODE_KINDS`, `etl/NodeInspector.tsx` | join = inner/left |
| C12 | Transform nodes: **aggregate / group-by** | 🟥 | C | — | G-AGG |
| C13 | Transform nodes: **dedup / union / lookup / SCD** | 🟥 | C | — | G-XFORM |
| C14 | **Per-node schema propagation** | ✅ | A | `pipeline/graph.ts` `inferNodeSchemas` | names+types flow downstream |
| C15 | Graph **validation** (dangling edge, cycle, arity, unknown refs, type/required) | ✅ | A | `pipeline/graph.ts` `validateGraph`, `planner.validatePipeline` | warnings/errors, non-blocking |
| C16 | **SQL generation** — flat (per-object SELECT) | ✅ | A | `pipeline/planner.ts` `pipelineSql` | design-time text |
| C17 | **SQL generation** — graph (WITH-chain) | ✅ | A | `pipeline/graphSql.ts` `graphSql` | design-time text |
| C18 | Generated-artifact tabs: Mapping / Report / SQL / Target DDL (+ export) | ✅ | A | `pipeline/PipelineDialog.tsx` | SQL tab prefers graph SQL |
| C19 | **Pipeline execution** (run the SQL inside DaMod) | 🟥 | C | — | G-EXEC; design-time only |
| C20 | Execute generated SQL via **external DB client** | ✅ | B | n/a | psql / any client on a disposable DB |
| C21 | Independent **output verification** | ✅ | B | `fixtures/verify.sql` | external SQL assertions |
| C22 | **Stale-metadata / drift** detection on source change | 🟡 | A | `planner.validatePipeline` (missing object/column → error), `graph.inferNodeSchemas` (unknown source) | flagged on revalidate; no auto-remap |
| C23 | Pipeline **save/reopen** round-trip | ✅ | A | `pipelinesPersist.ts`, v2 migration | deterministic JSON |
| C24 | Pipeline-edit **undo/redo** | 🟥 | C | edits go via `upsertPipeline`, no undo stack | G-UNDO (model undo exists; pipelines don't participate) |
| C25 | Incremental / CDC / scheduling | 🟥 | C | `LOAD_STRATEGIES = ["full"]` | G-INC |
| C26 | **Copilot** general modeling/standards actions | ✅ | A | `copilot/*` | not ETL-aware |
| C27 | **Copilot ETL actions** (explain pipeline, suggest mapping, propose transform) | 🟥 | C | no ETL actions in `copilot/actions.ts` | G-AI |
| C28 | Secrets kept out of JSON (keychain only) | ✅ | A | `connectors/connection.ts` `findSecretLeaks` | no creds in `pipelines.json` |

**Bottom line:** DaMod supports the **design-time** retail pipeline end to end (reverse-engineer → model → DAG design → map/transform → validate → generate SQL + DDL → save/reopen). **Execution is external** (Category B). Aggregation, incremental/CDC, pipeline undo, and Copilot ETL actions are **product gaps** (Category C).
