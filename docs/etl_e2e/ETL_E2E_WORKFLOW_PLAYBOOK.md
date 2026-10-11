# DaMod ETL Designer — End-to-End Workflow Playbook

A manual, executable playbook for the **Retail sales data integration** use case, grounded
in the *current* DaMod implementation. Companion artifacts in this folder:
`ETL_FEATURE_CAPABILITY_MATRIX.md`, `ETL_SOURCE_TO_TARGET_MAPPING.md`,
`ETL_EXPECTED_RESULTS.md`, `ETL_TEST_CASES.md`, `ETL_GAP_REGISTER.md`, and `fixtures/`.

**What is real today:** reverse-engineer → model → visual DAG design (source/filter/select/
derive/cast/join/target) → per-node schema + validation → generate SQL + Target DDL →
save/reopen. **What is NOT:** in-app execution, aggregation, pipeline undo, Copilot ETL
actions. So the use case is **design in DaMod, execute externally** (a disposable Postgres),
then verify with independent SQL. Category tags: **A** DaMod now · **B** external tool · **C** blocked.

Scope chosen to be achievable now: `fact_sales` is **line grain** (one row per non-cancelled
`order_item`); no aggregation (G-AGG). Dims are straight column selects.

---

## Stage 1 — Environment preparation

### S1.1 Launch DaMod
**Objective:** Run the actual app. **Where:** repo root. **Actions:** `source ~/.cargo/env`
then `npm install` (first time) and `npm run tauri dev`. **Expected:** Vite ready on
`http://localhost:1420`, cargo "Finished", a native window opens. **Verify:** window shows
the DaMod ribbon; `/tmp` log has no errors. **Failure:** "Port 1420 in use" → stop the
other dev server. **Status:** A. **Evidence:** `package.json` scripts, `src-tauri/`. **Result:** ___

### S1.2 Disposable Postgres for external execution (optional until Stage 10)
**Objective:** A throwaway DB for Category-B execution. **Where:** a terminal (outside DaMod).
**Actions:** `brew services start postgresql@16` (or Docker), then `createdb damod_etl_test`.
**Expected:** empty DB reachable via `psql damod_etl_test`. **Verify:** `psql damod_etl_test -c '\dt'`.
**Failure:** auth/socket errors → use a local trust/dev role. **Status:** B. **Never use production.** **Result:** ___

### S1.3 Clean, reproducible test state
**Objective:** Isolate the test without touching existing work. **Actions:** create a **new
workspace folder** (e.g. `~/damod-etl-test/`) from the Welcome screen / open-folder; keep
fixtures in this repo's `docs/etl_e2e/fixtures/`. **Expected:** empty workspace, no tabs.
**Verify:** Model Explorer empty. **Status:** A. **Result:** ___

---

## Stage 2 — Prepare sample source data
**Objective:** A deterministic dataset. **Where:** `docs/etl_e2e/fixtures/`. **Inputs:**
`source_schema.sql`, `source_data.sql` (already provided — synthetic). **Expected:** 4 tables;
counts customers=4, products=3, orders=5, order_items=7; embedded edge cases (NULL email,
0.00 price, a cancelled order). **Verify:** see `ETL_EXPECTED_RESULTS.md` §Source counts.
**Status:** A (artifacts) / B (loading into Postgres). **Result:** ___

---

## Stage 3 — Connect to / import the source
**Objective:** Get source metadata into DaMod. **Decision:** live DB discovery is metadata-only
and needs a connection; the **offline, deterministic path is Import SQL** — use it.
**Where:** **File ribbon → "Import SQL"** (opens *Reverse-engineer from SQL*).
**Actions:** "Load file…" → pick `fixtures/source_schema.sql` (or paste it); set model name
`retail_source`; read the live preview. **Inputs:** `source_schema.sql`. **Expected:** preview
shows **4 entities, 3 relationships**. Click **Import**. **Verify:** a new model tab
`retail_source` with 4 entities in Model Explorer. **Failure:** parse error → unsupported SQL
construct (keep to CREATE TABLE/PK/FK/standard types). **Status:** A. **Evidence:**
`import/ImportDialog.tsx`, `import/reverse.ts` `parseDdl`. **Note:** this is *metadata*, not data
extraction. **Result:** ___

---

## Stage 4 — Build the source model (inspect)
**Objective:** Confirm the reverse-engineered model. **Where:** Model Explorer + Properties
(docked inspector / ⚙ Properties). **Actions:** expand each entity; check attributes, types,
PK flags; open Relationships to confirm the 3 FKs (orders→customers, order_items→orders,
order_items→products). **Expected:** `order_items` has `order_item_id` PK, FK columns
`order_id`/`product_id`, `quantity integer`, `unit_price numeric(12,2)`; `customers.email`
nullable. **Verify:** matches `source_schema.sql`. **Status:** A. **Evidence:** `model/*`,
`explorer/ModelExplorer.tsx`, `panels/`. **Result:** ___

Optional (if testing standards): apply a Naming Standard (Home ribbon → **Naming**) or Data
Type Standard (**Types**) — see `docs/STANDARDS.md`. Not required for the pipeline. **Status:** A.

---

## Stage 5 — Build the target model
**Objective:** Define dim_customer / dim_product / fact_sales. **Two supported paths:**
- **Fast (recommended):** File ribbon → **Import SQL** → `fixtures/target_schema.expected.sql`
  → name `retail_target` → Import. **Expected:** 3 entities.
- **Manual:** New Model dialog (pick target DB = Postgres) → add entities/columns/keys by hand.
**Verify:** `fact_sales` has `line_amount numeric(12,2)` and PK `order_item_id`.
**Status:** A. **Evidence:** `export/ddl.ts` (Target DDL later), modeling engine.
**Note:** DaMod also *generates* target DDL from the pipeline (Stage 9); you do not have to
hand-create the target unless you want it as a separate model. **Result:** ___

---

## Stage 6 — Design source-to-target mappings
**Objective:** Specify every target column's source + transform. **Inputs:** the full table in
`ETL_SOURCE_TO_TARGET_MAPPING.md` (the oracle). **Where (flat edits):** Data ribbon →
**Pipelines** → open a pipeline → **Mapping** tab (`MappingEditor`): rename/retype target
columns, add transforms, drop/add columns, add source-side filters and cross-object joins.
**Where (visual):** the **Designer** (Stage 7) for the multi-table `fact_sales` join.
**Expected:** mappings match the spec; live validation shows issue counts. **Verify:** compare
to `ETL_SOURCE_TO_TARGET_MAPPING.md`. **Status:** A. **Evidence:** `pipeline/MappingEditor.tsx`,
`planner.validatePipeline`. **Result:** ___

---

## Stage 7 — Design transformations (the DAG)
**Objective:** Build the transform graph. **Prerequisites:** a pipeline exists (Stage 9 S9.1
creates it; you can create it first then design). **Where:** **Data ribbon → Designer**.
**Actions:**
1. Select the pipeline; if it has no graph, click **Create starter graph**.
2. Use the left **palette** to add nodes; drag to position; **drag between nodes to connect**;
   **Delete** removes a selected node/edge. Configure each in the right **NodeInspector**.
3. For `fact_sales`: `source order_items` + `source orders` → **join** (inner; key
   `order_id = order_id`; connect the two sources to the join's **left** then **right** ports)
   → **filter** (`status != cancelled`) → **derive** (`line_amount = quantity * unit_price`,
   decimal) → **select** (keep the 8 fact columns) → **target** (`targetObject = fact_sales`).
4. For `dim_customer`/`dim_product`: `source` → (optional `select`) → `target`.
**Inputs:** the mapping spec. **Expected:** nodes connect without a cycle error; selecting the
derive node shows `line_amount` in its **output schema**. **Verify:** `ETL_SOURCE_TO_TARGET_MAPPING.md`
DAG + schema. **Failure scenarios:** see N5–N12 in `ETL_TEST_CASES.md`. **Status:** A (nodes
source/filter/select/derive/cast/join/**aggregate**/**distinct**/target). **union/lookup/
SCD = C (G-XFORM remaining); dedup done.** To aggregate (e.g. sales by customer), insert an `aggregate`
node (group-by columns + measures sum/count/count_distinct/avg/min/max) before the target.
**Evidence:** `etl/EtlDesigner.tsx`, `etl/NodeInspector.tsx`, `pipeline/graph.ts`. **Result:** ___

---

## Stage 8 — Validate the pipeline
**Objective:** Catch structural/schema/transform errors. **Where:** Designer **bottom
diagnostics** panel (live) + PipelineDialog validation line. **Actions:** read the error/warning
counts; click issues. **Expected clean state:** 0 errors (duplicate-column/type warnings OK).
**Negative checks:** run N1–N13 from `ETL_TEST_CASES.md` and confirm each expected
message. **Verify:** messages match `planner.validatePipeline` / `graph.validateGraph`.
**Status:** A. **Evidence:** `pipeline/graph.ts`, `pipeline/planner.ts`. **Result:** ___

---

## Stage 9 — Generate SQL / execution plan
### S9.1 Create the pipeline (if not already)
**Where:** Data ribbon → **Pipelines → New pipeline**. **Actions:** source model
`retail_source`, name `retail_sales`, target platform `postgres`, select all 4 objects →
**Plan full load & save**. **Expected:** pipeline saved (v2, with a starter graph). **Status:** A.

### S9.2 Generate graph SQL
**Where:** Designer **SQL** toggle, or PipelineDialog **SQL** tab. **Expected:** a `WITH`-chain
`SELECT` per target (JOIN + `WHERE status != 'cancelled'` + `line_amount` expression),
quoted in the source dialect. **Verify:** compare shape to `ETL_EXPECTED_RESULTS.md`
§Expected artifacts. **Status:** A (design-time text — **not executed**). **Evidence:**
`pipeline/graphSql.ts`, `pipeline/planner.ts` `pipelineSql`. **Result:** ___

### S9.3 Generate Target DDL + export
**Where:** PipelineDialog **Target DDL** tab → **Export report + SQL + DDL**. **Expected:**
`<name>.target.sql`, `<name>.extract.sql`, `<name>.pipeline-report.txt` written to the workspace.
**Verify:** `target.sql` ≈ `fixtures/target_schema.expected.sql`. **Status:** A.
**Note (G-DDL-GRAPH done):** when the pipeline has a DAG with target nodes and the source
model is open, the Target DDL tab now derives CREATE TABLE from each **target node's inferred
schema** (`graphTargetDdl`); it falls back to the flat objects-based DDL otherwise. **Result:** ___

---

## Stage 10 — Execute (EXTERNAL — Category B)
**Objective:** Actually move data. **DaMod does NOT execute** (G-EXEC) — connectors are
metadata-only; generated SQL is text. Use the disposable Postgres from S1.2.
**Actions (external terminal):**
```
psql damod_etl_test -f docs/etl_e2e/fixtures/source_schema.sql
psql damod_etl_test -f docs/etl_e2e/fixtures/source_data.sql
psql damod_etl_test -f docs/etl_e2e/fixtures/target_schema.expected.sql   # or DaMod Target DDL
# then, per target, wrap DaMod's generated SELECT:
psql damod_etl_test -c "INSERT INTO dim_customer SELECT * FROM customers;"
psql damod_etl_test -c "INSERT INTO dim_product  SELECT * FROM products;"
psql damod_etl_test -c "INSERT INTO fact_sales <paste the fact_sales graph SELECT from S9.2>;"
```
**Expected:** rows inserted (dim_customer 4, dim_product 3, fact_sales 6). **Failure/limits:**
re-running without TRUNCATE → PK violation (no upsert/merge — G-EXEC); DaMod has **no retry/
rollback** because it does not run the job. **Status:** B. **Do not run against a real/shared DB.**
**Result:** ___

> This is explicitly **external execution of a DaMod-generated artifact**, NOT native DaMod
> pipeline execution.

---

## Stage 11 — Verify the target output (Category B)
**Objective:** Prove correctness against the oracle. **Where:** external `psql`. **Actions:**
`psql damod_etl_test -f docs/etl_e2e/fixtures/verify.sql`. **Expected:** dim_customer=4,
dim_product=3, fact_sales=6; cancelled_leaked=0; dup_pk=0; bad_line_amount=0;
total_line_amount=**157.92**; orphan_customer/product=0; sales-by-customer 1=97.98, 2=49.95,
4=9.99; customer 4 email NULL. **Verify:** matches `ETL_EXPECTED_RESULTS.md`. **Status:** B.
**Result:** ___

---

## Stage 12 — Save, reopen, modify
**Objective:** Persistence + lifecycle. **Actions:** (L1) close & reopen the workspace →
reopen the Designer → confirm nodes/edges/config/layout intact. (L2) change a mapping, save,
reopen → persists. (L3) **Undo/redo a pipeline edit → BLOCKED (G-UNDO)**: pipeline edits have
no undo stack; model ⌘Z does not affect pipelines — record as a gap. (L4) change a source
column/type in `retail_source` → revalidate → **drift errors**, mappings not silently rewritten.
(L5) a pre-DAG `pipelines.json` opens and gains a starter graph (v2 migration). (L6) original
models unchanged. **Verify:** per `ETL_TEST_CASES.md` L1–L6. **Status:** A (except L3 = C).
**Evidence:** `pipelinesPersist.ts`, `workspaceStore.ts`. **Result:** ___

---

## Stage 13 — Failure & recovery testing
Run the negative matrix in `ETL_TEST_CASES.md` (N1–N13 design-time; E5 external). Key points:
source-unavailable/invalid-credentials apply only to the **live connector** (not this offline
path); schema-change (N1/N2) and invalid expression/type (N4) are caught by validation;
invalid pipeline JSON is rejected by `parsePipelinesFile`/Zod with a readable error;
app restart mid-edit → unsaved in-memory graph edits since the last `upsertPipeline` are lost
(no autosave for the Designer graph beyond explicit save — note for G-UNDO/autosave). **Do not
trigger destructive operations on a real database.** **Status:** mixed (see matrix). **Result:** ___

---

## Stage 14 — AI Copilot testing (Category C — future)
Copilot has **no ETL-aware actions** (`copilot/actions.ts` covers model objects, domains,
naming/type standards, Snowflake/governance — not pipelines). So all of: "explain this
pipeline", "suggest mappings", "identify missing mappings", "propose a `line_amount`
transform", "explain the type incompatibility", "propose a fix for this validation error"
are **future tests** (G-AI). If/when added, verify: structured Zod plan, human approval,
reuse of the same validation + `upsertPipeline`/graph commands, rejection of unsupported
actions, no credentials/source rows sent by default. **Status:** C. **Result:** ___

---

## Quick capability summary

| Stage | Works now (A) | External (B) | Blocked (C) |
|---|---|---|---|
| 1 prep | ✅ launch, workspace | Postgres setup | |
| 2 data | ✅ fixtures | load into DB | |
| 3 source | ✅ Import SQL | | live extraction (C5) |
| 4 source model | ✅ | | |
| 5 target model | ✅ | | |
| 6 mapping | ✅ | | |
| 7 transforms | ✅ filter/select/derive/cast/join/**aggregate**/**distinct** | | union/lookup/SCD (G-XFORM) |
| 8 validate | ✅ | | |
| 9 generate | ✅ SQL + DDL + export | | — |
| 10 execute | | ✅ external psql | native exec (G-EXEC) |
| 11 verify | | ✅ verify.sql | |
| 12 save/reopen | ✅ | | undo/redo (G-UNDO) |
| 13 failures | ✅ validation/parse | re-run idempotency | |
| 14 Copilot | | | all ETL actions (G-AI) |
