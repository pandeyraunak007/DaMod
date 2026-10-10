# Oracle E-Business Suite (EBS) Support — Capability Matrix & Roadmap (Req 21)

> Reference: Oracle eTRM User Guide and EBS documentation (see Req 21 §1).
> This increment delivers **Phase 1, offline/mock only** — no Oracle driver, no Rust,
> no network, fully unit-tested. It is the foundation the live connector plugs into.

## What "offline foundation" means here

A live Oracle/EBS connector needs a **Rust Oracle driver** (the `oracle` crate ⇒ Oracle
**Instant Client** native libraries, a real licensing + packaging + Apple-Silicon
distribution concern) **and an Oracle/EBS instance to verify against** (Claude cannot
self-drive a live DB). Per the project's dependency rule (NFR-8, same gate used for
`tokio-postgres`) adding that driver needs **author sign-off first**. So this phase
builds everything that does NOT require the driver — the contract, the canonical EBS
snapshot shape, a mock connector with an eTRM-style fixture, Oracle type mapping, and
reverse-engineering from a snapshot — so the live adapter is a drop-in later.

## Capability matrix (§14)

Legend: **Done** = implemented + tested here · **Mock** = works against the mock/imported
snapshot, awaits the live driver · **Live** = needs an accessible Oracle/EBS instance ·
**Imported** = needs documented/eTRM metadata · **Deferred** = not yet built.

| Capability | Status | Notes |
|---|---|---|
| Connector contract for EBS | **Done** | Reuses `Connector`/`CanonicalMetadata`; `oracle-ebs` registered. |
| Canonical EBS snapshot shape | **Done** | Source identity incl. **EBS release + instance kept separate from Oracle DB version**; relationship **provenance + confidence**; per-object `native.ebs` annotation. |
| Oracle → canonical type mapping | **Done** | `oracleTypes.mapOracleType` (NUMBER/VARCHAR2/CHAR/CLOB/DATE/TIMESTAMP/…); unmappable (BLOB/RAW/spatial) preserved as native. |
| Mock EBS connector + eTRM fixture | **Done** | Payables (AP) + General Ledger (GL): suppliers, invoices, invoice lines (composite PK), code combinations, journals. |
| Reverse-engineer snapshot → model | **Done** | `ebsSnapshotToModel` reuses `metadataToModel`; product tags (`ebs:<CODE>`), verified business descriptions, composite keys, FK→relationships; byte-identical round-trip. |
| Product catalog from metadata | **Done** | `ebsProducts` derives products from actual annotations (not an assumed fixed list). |
| Idempotent re-discovery (no dupes) | **Done** | `computeDrift(prev, next)` — re-discovering an unchanged snapshot yields zero changes. |
| Offline import of a metadata package | **Done** | `ebsMockMetadata()` ⇄ `parseMetadata`; any eTRM-derived JSON validating against the contract imports the same way. |
| EBS connection setup + reverse + refresh (UI) | **Done (mock)** | Connections dialog is connector-generic: "+ Oracle EBS (mock)" creates an `oracle-ebs` connection (instance only, no credentials); Test reports EBS release + DB version; Reverse-engineer imports an EBS-enriched model; Refresh & compare works via the existing drift/apply path. |
| Verified vs inferred distinction | **Done** | `EbsAnnotation.verified`; inferred descriptions are NOT promoted into model text (§5). |
| Live connection + permission checks | **Live / Deferred** | Needs the Rust Oracle driver + instance. Contract method `testConnection` exists (mock). |
| DB object discovery (tables/cols/keys/indexes/views) | **Mock → Live** | Canonical shapes support all of these; live catalog-view queries (`ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS`, `ALL_CONS_COLUMNS`, `ALL_INDEXES`, `ALL_VIEWS`) are deferred to the driver. |
| Packages/procedures/functions/triggers/synonyms/types | **Deferred** | Needs the live driver + new canonical object kinds (Phase 2/3). |
| EBS application dictionary (products, concurrent programs, lookups, program units) | **Done (mock)** | Products via `native.ebs`; concurrent programs / lookups / program units (packages/procedures/triggers/synonyms/types) carried on `metadata.application`, discovered by the mock, counted in the reverse preview (`ebsApplicationSummary`), persisted in the snapshot. Kept OUT of the model (they're not tables, §11). Live FND discovery awaits the Oracle adapter. |
| Snapshot preserves EBS release + FK provenance + app metadata | **Done** | Fixed `metadataToPlain` (had silently dropped `ebsRelease`/`ebsInstance` and FK `provenance`/`confidence`); now serializes them + the `application` block deterministically, byte-identical round-trip. |
| EBS-aware Model Explorer view | **Done** | `EbsExplorer` — Model/EBS toggle (shown when the active model has EBS provenance); groups discovered tables by **product** or **schema** with counts, search, expand/collapse, click-to-reveal; scoped to the active tab; read-only. |
| EBS provenance in Properties Inspector | **Done** | Entity General tab shows a read-only discovery-source block (system/product/schema/nativeId/provenance/confidence), labelled verified-vs-inferred. Full EBS-specific property panels are Phase 3. |
| Source-identifier provenance on model objects | **Done** | `Entity.source` ({system, schema, nativeId, product, provenance, confidence}); set by `metadataToModel` for all connectors, enriched for EBS; serialize + Zod optional, round-trips. |
| Idempotent re-discovery (in-place merge) | **Done** | `reconcileDiscoveredModel` matches by `source.nativeId`, preserves stable ids + manual edits (logical names, descriptions, layout, tags, verb phrases); removed objects kept pending review (§11). |
| Snapshot compare / refresh preserving manual edits | **Done (engine)** | `computeDrift` reports changes; `reconcileDiscoveredModel` merges preserving manual edits. EBS refresh *UX* wiring is Phase 4. |
| Copilot EBS context + reviewed actions | **Deferred** | Phase 5. |
| Pipeline planning from EBS metadata | **Deferred** | Phase 6 — the planner already consumes canonical metadata, so this is mostly wiring + Oracle→target type mapping. |
| Live Rust Oracle adapter | **Deferred (sign-off)** | See the driver decision below. |

## Delivered files (Phase 1)

- `src/connectors/oracle/oracleTypes.ts` — `mapOracleType` (+ test).
- `src/connectors/oracle/ebs.ts` — EBS annotations, `ebsProducts`, `ebsSnapshotToModel`.
- `src/connectors/oracle/mockEbsConnector.ts` — mock connector + `ebsMockMetadata` fixture.
- `src/connectors/metadata.ts` — optional `source.ebsRelease`/`ebsInstance`, FK
  `provenance`/`confidence` (all backward-compatible, no migration of existing snapshots).
- `src/connectors/registry.ts` — registers `oracle-ebs` → mock connector.
- `src/connectors/oracle/oracleEbs.test.ts` — 12 tests (type mapping, discovery, provenance, RE→model, round-trip, idempotency).

## Driver decision (needs author sign-off before the live connector)

| Option | Pros | Cons |
|---|---|---|
| `oracle` crate (ODPI-C) | Mature, full-featured | Requires Oracle **Instant Client** native libs at build + runtime → bundle/licensing/Apple-Silicon packaging burden |
| Thin external worker (e.g. a small JDBC/Python sidecar) | Isolates the native dependency; easier licensing story | Extra process to ship + manage; IPC surface |
| Imported-metadata-only (no live driver) | Zero native deps; works offline today | No live discovery/refresh; relies on eTRM/exported metadata |

**Recommendation to evaluate:** start with imported-metadata-only (already working) +
decide `oracle` crate vs worker when a live instance is available to test against.
Document the final choice here and in `DECISIONS.md` before adding any dependency.

## Phased roadmap (Req 21 §12) — build later

- **Phase 2** — *DONE (do-now track):* source provenance + idempotent re-discovery
  (`Entity.source` + `reconcileDiscoveredModel`), the **EBS-aware Explorer view**
  (`EbsExplorer`), EBS provenance in the Inspector, and the **connector-generic
  Connections UI** — create/test/reverse/refresh an `oracle-ebs` (mock) connection
  end-to-end. *Remaining (driver-gated):* live DB discovery via the Rust Oracle adapter
  and reverse-engineering selected tables from a live instance.
- **Phase 3** — EBS application awareness: *DONE (mock/offline):* `metadata.application`
  (concurrent programs, lookups, program units) discovered by the mock, surfaced in the
  reverse preview, persisted in the snapshot; snapshot serialization fixed to keep EBS
  release + FK provenance. *Remaining:* live FND/eTRM discovery (driver-gated), and a
  snapshot browser showing app metadata for an already-imported model (per §11 app
  metadata is shown at discovery time, not grafted into the model).
- **Phase 4** — logical/conceptual generation; snapshot compare/refresh UX that never
  overwrites manual edits (the diff engine already keys by name).
- **Phase 5** — Copilot EBS context (scoped to instance/product/schema/objects; cites
  object names; verified-vs-inferred; reviewed actions through the command layer).
- **Phase 6** — pipeline planning from EBS metadata (Oracle→target type mapping,
  transformations, lineage), reusing the existing planner.

## Security posture (Req 21 §10) — honored by design

Metadata-only (no row reads); credentials stay in the OS keychain (never in snapshots,
model JSON, or logs — the contract stores only a non-sensitive source `name`); the mock
performs no writes; discovery is read-only. The live adapter must use least-privilege
read-only access and must never alter EBS tables/metadata.
