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
| Table variants (transient/external/hybrid), enforcement flags | **Deferred** | Needs model fields for table kind + constraint-enforcement (§4.2 declared-vs-enforced). |
| Secure/materialized views distinction | **Partial** | Views modeled (materialized flag exists); secure-view flag deferred. |
| Data engineering objects (stages/file formats/pipes/streams/tasks/dynamic tables) | **Deferred** | Phase 4 — new object types (model + DDL + inspector), or carry as `rawObjects` today. |
| Governance (roles/grants/tags/masking/row-access policies/shares) | **Deferred** | Phase 5. |
| Copilot Snowflake context + reviewed actions | **Partial** | The generic Copilot create-actions (tables/columns/subject areas/semantic) work on a Snowflake model; Snowflake-object-specific actions are later. |
| Live Snowflake adapter (account/warehouse/role + key-pair/OAuth) | **Deferred** | Needs an account to verify. |

## Delivered files (this increment)

- `src/connectors/snowflake/snowflakeTypes.ts` — `mapSnowflakeType`.
- `src/connectors/snowflake/mockSnowflakeConnector.ts` — mock connector + `snowflakeMockMetadata`.
- `src/connectors/registry.ts` — registers `snowflake`.
- Connections dialog — "+ Snowflake (mock)" via the shared app-mock editor.
- `src/connectors/snowflake/snowflake.test.ts` — 7 tests (type mapping, discovery, reverse→model with native types, Snowflake DDL, round-trip).

## Roadmap — deferred phases (Req 23 §13)

- **Phase 3 (modeling):** table variants (transient/external/hybrid) + a **constraint-
  enforcement flag** so relationships never imply enforcement Snowflake doesn't do (§4.2);
  secure-view flag; clustering keys.
- **Phase 4 (data engineering):** stages, file formats, pipes, streams, tasks, dynamic
  tables — each a real model object (type + factory → store ops → serialize/Zod →
  validation → Snowflake DDL → Explorer category → Inspector), mirroring the Req 19
  object pattern. Interim: carry them as `rawObjects`.
- **Phase 5 (governance):** roles/grants, tags, masking + row-access policies, shares —
  with policy↔object compatibility checks; kept separate from live privilege admin.
- **Phase 6:** Snowflake-specific Copilot actions + Snowflake-aware schema-comparison
  nuances.
- **Live adapter:** mirror `pg.rs` → Snowflake metadata via `SHOW`/`DESCRIBE`/
  `INFORMATION_SCHEMA`/`GET_DDL`; register it for `snowflake`. Needs an account + auth.

## Security posture (§2/§6) — honored by design

Metadata-only (no row reads); credentials would live in the OS keychain (never in
snapshots/model JSON/logs — the contract stores only a non-sensitive name); the mock
performs no writes; discovery is read-only. Modeling never executes DDL against a live
account. Stage credentials / policy expressions must never be surfaced beyond permissions.
