# Snowflake Support — Capability Matrix & Roadmap (Req 23)

> Reference: Snowflake SQL reference (see Req 23 §1). Snowflake is NOT new to DaMod — it
> is already a DDL dialect, a target database, and a source-system type. This increment
> adds the missing link — **a connector to discover FROM Snowflake** — completing the §15
> end-to-end path (connect → discover → reverse-engineer → DDL → compare), offline/mock.
> This file is the Phase-1 capability audit (§13).

## What already existed (before this increment)

- **Snowflake DDL output dialect** (`export/dialects.ts` `sfType`) — `VARCHAR`/`NUMBER`/
  `VARIANT`/`TIMESTAMP_TZ`/… ; used by Export, the pipeline Target DDL, and migration.
- **Target database** — New Model → "Snowflake"; `model.dialect = "snowflake"`; the Model
  Context Indicator shows it; the Inspector SQL tab renders Snowflake DDL.
- **Source-system type** `snowflake` in the canonical metadata contract.
- **Dialect-agnostic downstream** — reverse-eng (`metadataToModel`), schema compare
  (`migrate.diffModels`), pipeline planner, Copilot — all already work for any source.
- **Raw/dialect objects** — Snowflake-specific SQL (stages/streams/tasks) can already be
  carried verbatim as `rawObjects` (dialect `snowflake`) and exported.

## Capability matrix (§12/§14)

Legend: **Done** = implemented + tested here (mock/offline) · **Mock** = works against the
mock, awaits a live adapter · **Live** = needs a Snowflake account · **Deferred** = not built.

| Capability | Status | Notes |
|---|---|---|
| Snowflake physical model (create) | **Done** | New Model → Snowflake; `model.dialect`. |
| Active-model shows Snowflake as target | **Done** | Context indicator + Inspector SQL tab. |
| Snowflake DDL generation | **Done** | `CREATE TABLE … VARIANT/NUMBER(p,s)/TIMESTAMP_TZ …` (7-dialect export). |
| Snowflake connector (contract) | **Done** | `snowflake` registered (mock). |
| Snowflake → canonical type mapping | **Done** | `snowflake/snowflakeTypes.mapSnowflakeType` (NUMBER/VARCHAR/BOOLEAN/DATE/TIMESTAMP_*/VARIANT/OBJECT/ARRAY → canonical); GEOGRAPHY/GEOMETRY/VECTOR/BINARY unmappable → **preserved as `nativeType`**. |
| Mock connector + fixture | **Done** | ANALYTICS.PUBLIC: CUSTOMER (VARIANT/GEOGRAPHY/TIMESTAMP_NTZ), ORDERS (declared-not-enforced FK), a view. |
| Discover databases/schemas/tables/columns/views | **Done (mock)** | `testConnection`/`listSchemas`/`discover`; live `SHOW`/`DESCRIBE`/Information-Schema is **Live**. |
| Reverse-engineer → model | **Done** | via `metadataToModel`; Snowflake-native types preserved on `field.source.nativeType` (VARIANT/GEOGRAPHY round-trip). |
| Connection setup + test + reverse (UI) | **Done (mock)** | Connections dialog: "+ Snowflake (mock)" (account/database only, no credentials). |
| Idempotent re-discovery / snapshot / drift | **Done** | shared `reconcileDiscoveredModel` / `computeDrift` / Source-snapshot browser. |
| Schema comparison + migration | **Done (generic)** | `migrate.diffModels` + Snowflake DDL; Snowflake-specific migration nuances are later. |
| Pipeline planning from Snowflake | **Done (generic)** | source-to-target mapper → Snowflake target DDL. |
| Snowflake-specific types as first-class modeling types | **Partial** | VARIANT/OBJECT/ARRAY/GEOGRAPHY/VECTOR are preserved as **native types**, not added to the fixed canonical type set (same policy as Oracle/Fusion) — avoids forking the one type engine. |
| Table variants (temporary/transient/external/hybrid) | **Done** | `Entity.tableKind`; DDL emits `CREATE TRANSIENT/HYBRID/TEMPORARY TABLE` (Snowflake keywords); Table-kind selector in the Inspector. Discovering the variant from a live source is a connector enhancement. |
| Constraint enforcement (declared vs enforced, §4.2) | **Done** | `Relationship.enforced`; Snowflake standard/transient/external tables export PK/UNIQUE/FK as `NOT ENFORCED`, hybrid tables as enforced — so DDL never implies enforcement Snowflake doesn't provide. A validation rule warns when a FK is marked enforced on a non-hybrid Snowflake table. |
| Secure/materialized views distinction | **Partial** | Views modeled (materialized flag exists); secure-view flag deferred. |
| Data engineering objects (stages/file formats/pipes/streams/tasks/dynamic tables) | **Done** | `Model.snowflakeObjects` (unified `SnowflakeObject`, kind-discriminated); Explorer groups (Snowflake-only), kind-adaptive Inspector editor, Snowflake DDL (`CREATE STAGE/FILE FORMAT/PIPE/STREAM/TASK/DYNAMIC TABLE`), omitted with a count comment on other dialects, validation warnings (pipe→COPY, stream→source, task/dynamic→SQL, external stage→URL). **Stage credentials are never stored or shown** (§5). |
| Governance (roles/grants/tags/masking/row-access policies/shares) | **Done** | `Model.governanceObjects` (unified `GovernanceObject`, kind-discriminated); Explorer groups (Snowflake-only), kind-adaptive Inspector editor, Snowflake DDL (`CREATE ROLE`/`GRANT`/`CREATE TAG`/`MASKING POLICY`/`ROW ACCESS POLICY`/`SHARE`), omitted with a count comment on other dialects, validation warnings (grant→object/role, policy→body, share→objects). **Policy bodies are author-owned local content** (never imported from a live account); **no credential/secret field exists** on the type (§5). |
| Copilot Snowflake context + reviewed actions | **Done** | `create_snowflake_object` + `create_governance_object` actions (create-only, reviewed/approved, one undo group) — skip unless the model targets Snowflake; context summarizes both object sets by name/kind only (never bodies/credentials). |
| Live Snowflake adapter (account/warehouse/role + key-pair/OAuth) | **Deferred** | Needs an account to verify. |

## Delivered files (this increment)

- `src/connectors/snowflake/snowflakeTypes.ts` — `mapSnowflakeType`.
- `src/connectors/snowflake/mockSnowflakeConnector.ts` — mock connector + `snowflakeMockMetadata`.
- `src/connectors/registry.ts` — registers `snowflake`.
- Connections dialog — "+ Snowflake (mock)" via the shared app-mock editor.
- `src/connectors/snowflake/snowflake.test.ts` — 7 tests (type mapping, discovery, reverse→model with native types, Snowflake DDL, round-trip).

## Roadmap — deferred phases (Req 23 §13)

- **Phase 3 (modeling):** *DONE:* table variants (`Entity.tableKind`) + the **constraint-
  enforcement flag** (`Relationship.enforced`, §4.2). *Remaining:* secure-view flag;
  clustering keys; discovering the table variant from a live source.
- **Phase 4 (data engineering):** *DONE.* Stages, file formats, pipes, streams, tasks,
  dynamic tables modeled as one kind-discriminated `SnowflakeObject` (type + factory →
  store ops → serialize/Zod → validation → Snowflake DDL → Explorer category → kind-
  adaptive Inspector). Stage credentials are never stored or displayed. Discovering
  these from a live account is a connector enhancement (needs an account).
- **Phase 5 (governance):** *DONE.* Roles/grants, tags, masking + row-access policies,
  shares as one kind-discriminated `GovernanceObject` (same pipeline as Phase 4). Policy
  bodies are author-written; no secret field exists. *Remaining:* policy↔object
  attachment (which policy guards which column/table) and compatibility checks; kept
  separate from live privilege admin.
- **Phase 6:** *Copilot actions DONE* (`create_snowflake_object`/`create_governance_object`).
  *Remaining:* Snowflake-aware schema-comparison nuances; update/delete Copilot actions
  for these objects (create-only today).
- **Live adapter:** mirror `pg.rs` → Snowflake metadata via `SHOW`/`DESCRIBE`/
  `INFORMATION_SCHEMA`/`GET_DDL`; register it for `snowflake`. Needs an account + auth.

## Security posture (§2/§6) — honored by design

Metadata-only (no row reads); credentials would live in the OS keychain (never in
snapshots/model JSON/logs — the contract stores only a non-sensitive name); the mock
performs no writes; discovery is read-only. Modeling never executes DDL against a live
account. Stage credentials / policy expressions must never be surfaced beyond permissions.
