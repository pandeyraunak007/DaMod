# ETL Gap Register

Product gaps surfaced while writing this playbook, with the **minimum** change to unblock
each. None are implemented here (this task is docs + fixtures only). Ordered by impact on
the end-to-end workflow.

| Gap | Title | Blocks | Current behavior | Minimum fix to unblock | Effort |
|---|---|---|---|---|---|
| **G-EXEC** | No pipeline execution | Stage 10 (run in DaMod); idempotent re-run | Connectors are metadata-only (no `fullExtract`/write); SQL is design-time text | A read/write execution adapter (e.g. Rust Postgres `INSERT … SELECT` behind an explicit, confirmed, dry-run-first command) + a `targetWrite` capability | XL |
| ~~G-AGG~~ | ~~No aggregate / group-by node~~ | **DONE** | `aggregate` node implemented | Shipped: `AGG_FNS` (sum/count/count_distinct/avg/min/max) in `spec.ts`, schema inference + validation in `graph.ts`, `GROUP BY` SQL in `graphSql.ts`, config in `NodeInspector.tsx`, tests. | — |
| **G-XFORM** | No dedup / union / lookup / SCD nodes | Dedup, multi-source union, dimension lookups, SCD-2 targets | Not present | Add node kinds incrementally (start with `distinct`/`union`), each with schema-propagation + SQL | L+ |
| **G-UNDO** | No undo/redo for pipeline edits | Stage 12 undo/redo | Edits persist via `upsertPipeline`; no history stack (model undo is separate) | A per-pipeline edit history in `workspaceStore` (or route graph edits through a small undo wrapper) | M |
| **G-AI** | No Copilot ETL actions | Stage 14 | General Copilot can't explain/suggest pipelines | New Zod actions (e.g. `suggest_mapping`, `add_transform_node`) through the existing action→execute→approve path; feed pipeline+schema context | L |
| **G-INC** | Full-load only | Incremental / CDC / scheduling | `LOAD_STRATEGIES = ["full"]` | Widen load strategy + watermark config (design-time first); execution needs G-EXEC | L (design) |
| **G-DDL-GRAPH** | Target DDL derives from flat `objects`, not the DAG target node | DDL for DAG-only targets (e.g. fact_sales created purely via nodes) | `targetDdl` reads `spec.objects` | Derive CREATE TABLE from a target node's inferred schema (reuse `inferNodeSchemas`) | M |
| **G-LIVE-RE** | SQL reverse-engineer is paste/file only; live-DB reverse-eng needs a connection | N/A (fixtures use Import SQL) | Import SQL path is offline; live discovery via Connections | (not blocking for this playbook) | — |
| **G-DEDUP-NULL** | Null-handling / data-quality is only via `derive`/`filter` expressions, no dedicated node | Explicit null-default / DQ rules | Workable via expression (`COALESCE(...)`) + filter | Optional `null-handling`/`dq` node later | S |

## Notes
- **G-EXEC is the headline gap**: everything through SQL generation works in DaMod; moving
  data is out of scope and must stay explicit, user-initiated, dry-run-first, and never run
  automatically. Until then the workflow is **design-in-DaMod, execute-externally**.
- **G-AGG is now implemented** (aggregate node) — the retail fact can optionally be
  aggregated (e.g. sales by customer/day) instead of line-grain. G-DDL-GRAPH (objects-based
  target DDL) remains the main use-case limiter.
