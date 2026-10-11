# Connector Framework & ETL Planning — Architecture

Status: **Phases 1–5 implemented** (foundation, PostgreSQL discovery, reverse-
engineering integration, schema refresh & drift, ETL pipeline planning). The full
"first meaningful release" loop is in place. Phases 6+ (optional execution, Oracle,
Fusion, MCP) are specified here but not yet built. This document is the contract
reference; `DECISIONS.md` carries the dated decision log.

Phase 5 (pipeline planning): `pipeline/spec.ts` is a versioned, Zod-validated,
deterministically-serialized `PipelineSpec` referencing its source model/snapshot.
`pipeline/planner.ts` consumes a source model already discovered (no re-discovery):
`planFullLoad` auto-maps selected objects 1:1; `validatePipeline` flags type
mismatches (no silent inference), required-but-unmapped target columns, and source
drift; `pipelineReport` renders a deterministic mapping+validation report; and
`targetDdl` reuses `exportModelDDL` for target schema generation. Specs persist in
`pipelines.json`. The `PipelineDialog` designs, validates, previews (report + DDL)
and exports plans. Pipeline execution is explicitly out of scope (a later,
authorized milestone) — generating target DDL is not running a pipeline.

Phase 4 (refresh & drift): snapshots persist at `sources/<connection>.snapshot.json`
(saved on import and on refresh). `drift.ts` projects the previous snapshot and a
fresh discovery to models and diffs them with `export/migrate.ts` — so the
differences are pure *source* drift, not user edits. `applyDrift` applies only the
user-approved changes onto the active model, matched by name, preserving unrelated
manual edits; a removed+added pair sharing ≥2 columns is surfaced as a *possible
rename* (never auto-applied). The `RefreshPanel` in `ConnectionsDialog` runs
discover → compare → review (per-change checkboxes) → apply + save.

Phase 3 (reverse-engineering): `toModel.ts` maps canonical metadata →
`.model.json` reusing the model factories + the same FK→relationship logic as the
SQL parser (no second model engine). Connection profiles persist in
`connections.json` (`connectionsPersist.ts`, deterministic, credential-free — a
guard refuses to write/read secrets). The `ConnectionsDialog`
(`connectors/ui/`) manages connections (create/test/save/delete, password → OS
keychain) and runs the reverse-engineering workflow: list schemas → pick which to
discover → browse the discovered tables/views (grouped by schema, per-table
checkboxes) → preview (entity/relationship counts + warnings) → import as a new
model via the existing `importModel` (opens on the canvas, saved offline). Table
exclusions are a pure metadata prune (`browseFilter.ts`) applied before
`metadataToModelForSource`; the saved snapshot reflects the filtered import.

PostgreSQL connector (Phase 2): the live driver (`tokio-postgres`, pure-Rust) runs
in `src-tauri/src/pg.rs`, exposing `pg_test_connection` / `pg_list_schemas` /
`pg_discover` plus `secret_store` / `secret_delete` (OS keychain via `keyring`).
The TS client `src/connectors/postgres/` implements the `Connector` contract over
`invoke` and normalizes the raw payload with the existing `mapSqlType`. Discovery
is catalog-only (`pg_class`/`pg_attribute`/`pg_constraint`/`pg_index`) — no table
reads. Verified: Rust compiles + unit tests; TS normalization tests; a gated
`#[tokio::test]` integration test runs against `DAMOD_TEST_PG_URL` (docker
`postgres:16`) — author-run.

Guiding principle: **discover once, normalize once, reuse** across modeling,
comparison, pipeline planning, and semantic modeling. There is exactly one
discovery/metadata path — no separate implementations for reverse engineering
and ETL.

All code lives under `src/connectors/`. It is pure TypeScript with Zod; no DB
driver is bundled yet. The live PostgreSQL adapter (Phase 2) will run its driver
in the Rust/Tauri layer and expose the same contract to TypeScript over `invoke`.

---

## 1. Connector interface (`connector.ts`)

One `Connector` interface every adapter implements, independent of its driver or
language:

```
interface Connector {
  id; version; systemType
  capabilities(): Capability[]
  testConnection(profile): Promise<ConnectionTestResult>   // no user data read
  listSchemas(profile): Promise<string[]>
  discover(profile, options?): Promise<DiscoveryResult>    // METADATA ONLY
}
```

- **Metadata discovery is separate from data extraction.** Reverse engineering
  must never read whole tables; `discover` returns structure, not rows.
- Extraction (`fullExtract` / `incrementalExtract`) is a later, capability-gated,
  explicitly-authorized concern — not part of the discovery path.
- Connectors are resolved through `registry.ts` (`getConnector(systemType)`), so
  adding a source never touches the canvas or the pipeline planner.

## 2. Capability model (`capabilities.ts`)

A connector declares the subset of operations it supports (`capabilities()`).
**Unsupported operations are explicit**: calling one throws a typed
`ConnectorError("unsupported")` — never a silent empty result or false success
(`errors.ts`). Not every source supports every capability (e.g. an app/API
source has no `discoverIndexes`).

## 3. Canonical metadata contract (`metadata.ts`)

Versioned (`metadataVersion`), Zod-validated. Object-centric, not table-centric:

```
CanonicalMetadata
  source: { systemType, name, productVersion? }   // name is non-secret
  capabilities: Capability[]
  catalogs: [{ name, schemas: [{ name, objects: SourceObject[] }] }]

SourceObject { name, kind, columns[], primaryKey?, foreignKeys[], indexes[],
               comment?, nativeId?, native? }      // kind ∈ table|view|
                                                   // business-object|api-resource|…
Column { name, ordinal, nativeType, normalizedType?, nullable, default?,
         generated?, comment?, nativeId? }
```

- **`normalizedType` reuses the application's fixed modeling type set**
  (`model/dataTypes.ts`) — the bridge into `.model.json`. When a native type has
  no clean mapping, `normalizedType` is omitted and `nativeType` is preserved.
- **Native fidelity is preserved** (`nativeType`, `nativeId`, `native`) so
  round-trips and schema comparison stay possible.
- **Extensible to non-DB sources:** `kind` lets Oracle Fusion business objects /
  API resources be represented without forcing them into a table abstraction.
  Fusion/EBS are *not* assumed to be reachable as database tables.

## 4. Source snapshot & provenance (`snapshot.ts`)

A `SourceSnapshot` records what a source contained at one discovery point.

```
SourceSnapshot { snapshotVersion, id, connectionRef, metadata, provenance }
Provenance { connectorId, connectorVersion, discoveredAt,
             schemasDiscovered[], capabilitiesUsed[] }
```

- **Stable vs operational split:** `metadata` is the stable, diffable content;
  `provenance` holds operational data (timestamps). `serializeMetadata` is
  deterministic and **excludes** timestamps, so an unchanged schema is
  byte-identical across refreshes (no meaningless Git diffs).
- Deterministic serialization uses fixed key order + sorted collections (mirrors
  `persist/serialize.ts`), verified byte-identical through serialize→parse→
  serialize.
- **`connectionRef` is an id, never credentials.** `parseSnapshot` *rejects* any
  snapshot that contains credential-like fields (`findSecretLeaks`).

## 5. Credential storage (`connection.ts`)

- A `ConnectionProfile` holds only non-secret params plus a `secretRef` — an
  opaque key into the OS secure store (keychain), resolved in the Rust layer at
  connection time.
- **No plaintext secret ever lands in workspace JSON, model JSON, snapshots,
  pipeline artifacts, logs, exports, or Git.** `findSecretLeaks` is a reusable
  guard (used by `parseSnapshot` and asserted in tests).
- Keychain integration itself is a Rust/Tauri concern (Phase 2).

## 6. Schema refresh & drift (planned — Phase 4)

Refresh never blindly overwrites a model:

1. discover → new snapshot → 2. compare against previous snapshot + saved model →
3. classify added/removed/changed (and *possible* renames, flagged for review,
not auto-applied when evidence is insufficient) → 4. user reviews/approves →
5. apply accepted changes while preserving unrelated manual edits → 6. save
atomically.

Will reuse `export/migrate.ts` (`diffModels` / `generateMigration`) but
distinguish **physical source drift** from **user-authored model changes**.

## 7. Pipeline specification & planner (planned — Phase 5)

A separate, versioned, Zod-validated `PipelineSpec`: source connector +
connection ref, source model/snapshot version, selected objects/columns, target
platform/objects, source→target mappings, type conversions, explicit
transformations, dependencies/order, load strategy, validation results. The
planner **consumes canonical metadata already discovered** — it never re-runs
discovery. Target DDL reuses the existing `export/` generators. Generating target
DDL is *not* executing a pipeline; discovery, mapping, spec, DDL generation, and
execution are kept separate. Execution (Phase 6) is explicitly authorized,
validated, bounded, and never runs unvalidated/AI-generated SQL.

## 8. MCP / AI (future — Phase 9)

Once the contracts are stable, expose narrowly-scoped authorized operations
(`list_connections`, `discover_schema`, `get_model`, `compare_model`,
`generate_pipeline_plan`, `validate_pipeline_plan`). AI output is validated
against these canonical contracts and existing rules; it never bypasses
permissions or executes destructive operations.

---

## Reused existing components (no duplication)

| Existing | Reused for |
|---|---|
| `model/dataTypes.ts` fixed type set | `normalizedType` — the model bridge |
| `import/reverse.ts` `mapSqlType` | native-type → fixed-type normalization |
| `export/migrate.ts` diff/migration | schema-drift comparison (Phase 4) |
| `export/*` DDL generators | pipeline target DDL (Phase 5) |
| `persist/serialize.ts` pattern | deterministic snapshot/spec serialization |
| `persist/schema.ts` Zod + versioning | metadata/snapshot validation + migration |

## Test coverage (Phase 1)

`src/connectors/connectors.test.ts` — 13 tests: registry resolution, capability
declaration, connection test, discovery of composite keys / foreign keys /
self-reference, native-type preservation, schema filtering + `includeViews`,
explicit unsupported-capability error, metadata validation (reject bad shape /
unknown normalized type), snapshot determinism, snapshot round-trip, credential
rejection in snapshots, and credential-leak detection.
