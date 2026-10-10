# Oracle Fusion Cloud Support — Capability Matrix & Roadmap (Req 22)

> References (Req 22 §2): Fusion REST APIs, Financials/Procurement API catalogs, BICC.
> This increment delivers **Phase 1 + a tested reverse-engineering path, offline/mock
> only** — no live tenant, no OAuth, no network. Mirrors the Oracle EBS approach
> (`docs/ORACLE_EBS.md`) and plugs into the same connector framework.

## Why offline/mock first

A live Fusion connector needs a tenant, OAuth/token auth, and REST pagination / rate-limit
/ retry handling — none of which can be built or verified here (no tenant; Claude can't
drive live network auth). Per §14 ("start with read-only discovery for one family → a
tested path to a logical model; don't build the whole catalog"), this phase builds the
contract + a representative **Financials** mock + the reverse-engineering path, all
unit-tested. A live REST connector slots onto the same canonical contract later.

## Capability matrix (§14)

Legend: **Done** = implemented + tested here (mock/offline) · **Live** = needs a tenant +
OAuth · **Deferred** = not yet built.

| Capability | Status | Notes |
|---|---|---|
| Fusion connector contract | **Done** | `oracle-fusion` registered; reuses `Connector`/`CanonicalMetadata`. |
| Fusion → canonical type mapping | **Done** | `fusion/fusionTypes.mapFusionType` (string/number/integer/long/boolean/date/date-time/…); unmappable (binary/attachment) preserved as native. |
| Mock Fusion connector + fixture | **Done** | Financials family: Supplier, InvoiceHeader, InvoiceLine (nested child), with documented (non-DB-FK) relationships. |
| Business-object metadata discovery | **Done (mock)** | Objects (kind `business-object`), attributes, required/optional (via nullable), business/primary keys, parent-child via FKs (`fusion-metadata` provenance). Live describe-endpoint discovery is **Live**. |
| Fusion REST API discovery | **Done (mock)** | `metadata.fusion.apiResources` (path/methods/version/family) on the snapshot; counted in the reverse preview. Live resource-catalog discovery is **Live**. |
| Bulk extraction metadata (BICC / Data Extraction) | **Done (mock)** | `metadata.fusion.extractDataStores` (offering/fields/incremental) on the snapshot. Live BICC/Data-Extraction discovery + job status is **Deferred**. |
| Reverse-engineer → logical model | **Done** | `fusion/fusion.fusionSnapshotToModel` reuses `metadataToModel`; family tags (`fusion:<FAMILY>`), family/module on `entity.source`, parent-child relationships, composite keys, byte-identical round-trip. |
| Source identity / API version / provenance | **Done** | `source.apiVersion` kept separate; `entity.source` provenance; snapshot serialization preserves it (deterministic round-trip). |
| Idempotent re-discovery (no duplicates) | **Done** | `reconcileDiscoveredModel` matches by `source.nativeId` (shared with EBS/PG). |
| Connection setup + test + reverse (UI) | **Done (mock)** | Connections dialog: "+ Oracle Fusion (mock)" (instance URL only, no credentials); Test reports API version; Reverse-engineer imports a Fusion-enriched model; offline "Import metadata file…" works too. |
| Offline metadata-file import | **Done** | Any canonical JSON (incl. a Fusion package) imports via "Import metadata file…" (`parseMetadataFile`, rejects credential leaks). |
| Fusion-aware Model Explorer view | **Done** | `FusionExplorer` — a Model/Fusion toggle (shown when the active model has Fusion provenance); groups business objects by **family** or **module** with counts, search, expand/collapse, click-to-reveal; subject-area shortcuts; scoped to the active tab; read-only. Shares the `AppExplorer` component with the EBS view. |
| Fusion-specific Properties Inspector panels | **Deferred** | `entity.source` provenance shows in the General tab today; API-resource / extract-data-store panels are later. |
| Source-to-target mapping | **Deferred** | The pipeline planner already consumes canonical metadata; Fusion→target mapping UI is Phase 5. |
| Live data extraction / pipeline execution | **Deferred** | Out of scope by design — discovery, planning and execution stay separate (§8/§11). |
| Live REST connector (tenant + OAuth) | **Deferred** | Same contract; add when a tenant is available to verify. |

## Delivered files (Phase 1 + reverse)

- `src/connectors/fusion/fusionTypes.ts` — `mapFusionType`.
- `src/connectors/fusion/fusion.ts` — Fusion annotations, families, `fusionSnapshotToModel`, `fusionApiSummary`.
- `src/connectors/fusion/mockFusionConnector.ts` — mock connector + `fusionMockMetadata`.
- `src/connectors/metadata.ts` — `source.apiVersion`, `fusion-metadata` provenance, optional `metadata.fusion` (API resources + extract data stores); all backward-compatible.
- `src/connectors/buildModel.ts` — source-aware `metadataToModelForSource` (EBS/Fusion/plain).
- `src/connectors/registry.ts` — registers `oracle-fusion`.
- Connections dialog — connector-generic app-mock editor now covers Fusion.
- Tests: `fusion/fusion.test.ts` (11) + `ui/FusionConnection.render.test.tsx` (3).

## Roadmap — deferred phases (Req 22 §12)

- **Phase 2/3 (more):** *DONE:* the Fusion-aware Explorer view (family / module grouping,
  `FusionExplorer`). *Remaining:* Fusion Properties panels (business object / attribute /
  API resource / extract data store); API-resource / extract-definition tree nodes
  (they live on the snapshot, so they need a snapshot-reading surface); more families
  (Procurement, SCM, HCM, Sales) via fixtures.
- **Phase 4:** live BICC / Data Extraction metadata (offerings, data stores, extract
  fields, full/incremental indicators) — kept separate from model discovery.
- **Phase 5:** source-to-target mapping UI + type conversions; Copilot Fusion context +
  reviewed actions (subject areas, entities, mappings, descriptions, semantic models).
- **Phase 6:** metadata refresh/compare UX on `reconcileDiscoveredModel`; permission /
  rate-limit / partial-discovery handling; the live REST connector.

## Security posture (Req 22 §11) — honored by design

Metadata-only (no business records read); credentials would live in the OS keychain
(never in snapshots/model JSON/logs — the contract stores only a non-sensitive instance
label); the mock performs no writes; discovery is read-only. A live connector must use
least-privilege tokens, honor rate limits, and never modify the Fusion environment.
