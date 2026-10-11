# ETL Gap Register

Product gaps surfaced while writing this playbook, with the **minimum** change to unblock
each. None are implemented here (this task is docs + fixtures only). Ordered by impact on
the end-to-end workflow.

| Gap | Title | Blocks | Current behavior | Minimum fix to unblock | Effort |
|---|---|---|---|---|---|
| **G-EXEC** | No pipeline execution | Stage 10 (run in DaMod); idempotent re-run | Connectors are metadata-only (no `fullExtract`/write); SQL is design-time text | A read/write execution adapter (e.g. Rust Postgres `INSERT … SELECT` behind an explicit, confirmed, dry-run-first command) + a `targetWrite` capability | XL |
| ~~G-AGG~~ | ~~No aggregate / group-by node~~ | **DONE** | `aggregate` node implemented | Shipped: `AGG_FNS` (sum/count/count_distinct/avg/min/max) in `spec.ts`, schema inference + validation in `graph.ts`, `GROUP BY` SQL in `graphSql.ts`, config in `NodeInspector.tsx`, tests. | — |
| **G-XFORM** | ~~No dedup~~ / union / lookup / SCD nodes | Partial — **dedup done** | `distinct` node shipped (full-row `SELECT DISTINCT`); union/lookup/SCD + key-based dedup remain | Add remaining node kinds incrementally, each with schema-propagation + SQL | L |
| ~~G-UNDO~~ | ~~No undo/redo for pipeline edits~~ | **DONE** | Per-pipeline undo/redo implemented | Shipped: transient `pipelineHistory` (`{past,future}` per id) in `workspaceStore`; `upsertPipeline` pushes the prior version, `undoPipeline`/`redoPipeline` swap; ETL Designer has ↶/↷ buttons + ⌘Z/⌘⇧Z (App yields those keys while the Designer is open). Tests in `pipelineUndo.test.ts`. | — |
| **G-AI** | No Copilot ETL actions | Stage 14 | General Copilot can't explain/suggest pipelines | New Zod actions (e.g. `suggest_mapping`, `add_transform_node`) through the existing action→execute→approve path; feed pipeline+schema context | L |
| **G-INC** | Full-load only | Incremental / CDC / scheduling | `LOAD_STRATEGIES = ["full"]` | Widen load strategy + watermark config (design-time first); execution needs G-EXEC | L (design) |
| ~~G-DDL-GRAPH~~ | ~~Target DDL from flat objects, not the DAG target node~~ | **DONE** | `graphTargetDdl` derives CREATE TABLE from each target node's inferred schema (reusing `inferNodeSchemas`); PipelineDialog's Target DDL tab prefers it when the graph has target nodes, else the flat `targetDdl`. | — |
| **G-LIVE-RE** | SQL reverse-engineer is paste/file only; live-DB reverse-eng needs a connection | N/A (fixtures use Import SQL) | Import SQL path is offline; live discovery via Connections | (not blocking for this playbook) | — |
| **G-DEDUP-NULL** | Null-handling / data-quality is only via `derive`/`filter` expressions, no dedicated node | Explicit null-default / DQ rules | Workable via expression (`COALESCE(...)`) + filter | Optional `null-handling`/`dq` node later | S |

## Notes
- **G-EXEC is the headline gap**: everything through SQL generation works in DaMod; moving
  data is out of scope and must stay explicit, user-initiated, dry-run-first, and never run
  automatically. Until then the workflow is **design-in-DaMod, execute-externally**.
- **G-AGG and G-DDL-GRAPH are now implemented** — the retail fact can be aggregated, and
  Target DDL derives from the DAG target node (so DAG-only targets like `fact_sales` get
  correct CREATE TABLE). **G-EXEC** (external execution only) is now the primary limiter,
  with G-XFORM / G-UNDO / G-AI / G-INC remaining.
