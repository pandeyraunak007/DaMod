# ETL Test Cases

Positive + negative cases for the retail pipeline. **Cat** = A (DaMod now) / B (external
tool) / C (blocked). Fill **Result** when executing manually. Expected errors are grounded
in `planner.validatePipeline` + `graph.validateGraph`/`inferNodeSchemas`.

## Positive — design time (Category A)

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| P1 | Reverse-engineer source | File ribbon → Import SQL → paste `source_schema.sql` → Import | Model with 4 entities, 3 FKs; PKs on *_id | |
| P2 | Reverse-engineer target | Import SQL → `target_schema.expected.sql` → Import (name `sales_target`) | 3 entities (dims+fact) | |
| P3 | Create pipeline | Data ribbon → Pipelines → New → source model, name `retail_sales`, target platform `postgres`, pick all 4 objects → Plan & save | Pipeline saved; Mapping/Report/SQL/Target DDL tabs | |
| P4 | Open Designer + seed graph | Data ribbon → Designer → select `retail_sales` → Create starter graph | Canvas shows source→target nodes | |
| P5 | Build fact_sales DAG | Add join/filter/derive/select/target nodes; wire order_items+orders→join (left/right)→filter→derive→select→target(fact_sales) | Nodes connect; no cycle error | |
| P6 | Schema propagation | Select the derive node | Output schema includes `line_amount` (decimal); upstream cols present | |
| P7 | Live validation clean | Configure all nodes per mapping spec | Bottom panel: 0 errors (warnings allowed) | |
| P8 | Graph SQL | Designer → SQL toggle (or PipelineDialog SQL tab) | `WITH`-chain SELECT with JOIN+WHERE+`line_amount` expr | |
| P9 | Target DDL | PipelineDialog → Target DDL tab | CREATE TABLE matching `target_schema.expected.sql` | |
| P10 | Export artifacts | PipelineDialog → Export report + SQL + DDL | `.pipeline-report.txt` + `.target.sql` + `.extract.sql` written | |

## Negative / validation (Category A — design time)

| ID | Case | How to trigger | Expected error/warning | Blocking? | Result |
|---|---|---|---|---|---|
| N1 | Missing source object (drift) | Import a source model lacking `orders`, revalidate pipeline | `validatePipeline`: "Source object … no longer in the model (schema drift?)" (error) | export blocked | |
| N2 | Missing source column (drift) | Rename `order_items.quantity` in the source model | "Source column … is missing (schema drift?)" (error) | blocked | |
| N3 | Required target col unmapped | Add a required target column with no source + no transform | "Required target column … has no source mapping" (error) | blocked | |
| N4 | Type incompatibility | Map a string source to a numeric target with no transform | type-conversion **warning** (add a cast/transform) | not blocking | |
| N5 | Filter on unknown column | Filter node references a column not in input schema | graph: "Filter on unknown column …" (error) | blocked | |
| N6 | Filter value missing | op `=` with empty value | "Filter … needs a value" (error) | blocked | |
| N7 | Join key not found | join `on` references a missing column | "Join … column not found" (error) | blocked | |
| N8 | Dangling edge | edge to a deleted node (or hand-edit JSON) | graph: "Edge … ends at unknown node" (error) | blocked | |
| N9 | Cycle | connect a node back to an ancestor | connect is **rejected** ("Connection would create a cycle"); hand-edited JSON → graph "cycle" error | blocked | |
| N10 | Join arity | wire 1 (or 3) inputs into a join | "Join node needs exactly two inputs (left + right)" (error) | blocked | |
| N11 | Duplicate output column | join two sources sharing a column, no rename | "duplicate column … (qualify or rename downstream)" (warning) | not blocking | |
| N12 | Derive duplicate name | derive a column named like an existing one | "duplicates an existing column" (error) | blocked | |
| N13 | Invalid identifier (target) | set a target column name with a space | "Invalid target column name …" (error) | blocked | |

## Persistence / lifecycle (Category A, except noted)

| ID | Case | Expected | Result |
|---|---|---|---|
| L1 | Save + reopen workspace | Reopen Designer → nodes/edges/config/layout intact (`pipelines.json` round-trip) | |
| L2 | Modify a mapping, save, reopen | Change persists | |
| L3 | **Undo/redo a pipeline edit** | **BLOCKED (C)** — pipeline edits have no undo stack (G-UNDO). Model undo (⌘Z) does not affect pipelines | |
| L4 | Source schema change → stale detection | After N1/N2, revalidate → drift errors; mappings are **not** silently rewritten | |
| L5 | v1 → v2 migration | Open a pre-DAG `pipelines.json` → loads, gains a starter graph, specVersion 2 | |
| L6 | Existing model data intact | After all steps, original models unchanged | |

## Execution + verification (Category B — external)

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| E1 | Load source | `psql < source_schema.sql; psql < source_data.sql` (disposable DB) | 4 tables, counts 4/3/5/7 | |
| E2 | Create targets | `psql < target_schema.expected.sql` (or DaMod Target DDL) | empty dims+fact | |
| E3 | Run extract | For each target: `INSERT INTO <t> <DaMod generated SELECT>;` | rows inserted | |
| E4 | Verify | `psql < verify.sql` | fact_sales=6, total=157.92, all integrity checks 0; cust4 email NULL | |
| E5 | Re-run idempotency | Re-run E3 without truncate | **PK violation expected** (no upsert/merge — G-EXEC); truncate between runs | |

## Copilot (Category C — future)

All ETL Copilot prompts (explain pipeline, suggest mappings, propose `line_amount`
transform, explain type incompat, fix a validation error) are **not supported** — no
ETL actions exist in `copilot/actions.ts`. Record as future tests (G-AI). The general
Copilot can create model entities/columns/domains/standards but is not pipeline-aware.
