# PostgreSQL Object Support — Capability Matrix & Roadmap (Req 19)

> Reference inventory: erwin Data Modeler **PostgreSQL Support Summary**
> (https://bookshelf.quest.com/bookshelf/public_html/15.0/Content/User%20Guides/erwin%20Help/PostgreSQL_Support_Summary.html).
> This file is the human-readable view of the canonical registry in
> `src/model/objectRegistry.ts` (which is kept honest by `objectRegistry.test.ts`).
> **Do not mark a row supported here without the registry + a lifecycle test to match.**

Status legend: **Full** = create → edit → validate → persist → DDL, all implemented + tested ·
**Partial** = some of the lifecycle · **None** = catalogued for the roadmap, not built ·
**N/A** = not applicable at this modeling level.

## Capability matrix

| Object | Status | Create | Props | Validate | DDL | Reverse-eng | Compare | Backing |
|---|---|---|---|---|---|---|---|---|
| Table | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `entities` |
| Column | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `entities[].fields` |
| Primary key | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `fields[].primaryKey` |
| Foreign key | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `relationships` |
| Unique constraint | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `fields[].unique` |
| Check constraint | **Full** | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `entities[].checks` |
| Index | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `indexes` |
| View | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `views` |
| Materialized view | **Full** | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `views[].materialized` |
| Sequence | **Full** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `sequences` |
| Schema | **Full** | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `schemas` |
| Domain | **Full** | ✓ | ✓ | ✓ | partial | ✗ | ✓ | `domains` |
| Raw/dialect object | **Full** | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | `rawObjects` |
| Comment | **Partial** | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | object `description` |
| Database | **Partial** | — | ✓ | — | — | — | — | `model.name`+`dialect` |
| Trigger | None | | | | | | | — (Phase 4) |
| Function | None | | | | | | | — (Phase 4) |
| Stored procedure | None | | | | | | | — (Phase 4) |
| Event trigger | None | | | | | | | — (Phase 4) |
| User-defined type (enum/composite/range) | None | | | | | | | — (Phase 3) |
| Cast | None | | | | | | | — (Phase 3) |
| Collation | None | | | | | | | — (Phase 3) |
| Extension | None | | | | | | | — (Phase 3) |
| Language | None | | | | | | | — (Phase 3) |
| Access method | None | | | | | | | — (Phase 5) |
| Foreign server | None | | | | | | | — (Phase 5) |
| Tablespace | None | | | | | | | — (Phase 5) |
| Transform | None | | | | | | | — (Phase 5) |
| Role | None | | | | | | | — (Phase 5) |
| Permission (grant/revoke) | None | | | | | | | — (Phase 5) |
| Statistics | None | | | | | | | — (Phase 5) |

## PostgreSQL data types (Req 19 §4)

**Current:** a fixed generic set — `string, text, integer, bigint, decimal, boolean,
date, timestamp, uuid, json` (`src/model/dataTypes.ts`), rendered to per-dialect SQL
spellings in `src/export/dialects.ts`. **Status: Partial.** This covers the common cases
but is NOT the full PostgreSQL type vocabulary.

**Deferred (type-system expansion):** real PG spellings and families —
`smallint/real/double precision/smallserial/serial/bigserial`, `money`,
`char/varchar/text`, `bytea`, date/time family (`timestamptz/time/timetz/interval`),
geometric (`point/line/lseg/box/path/polygon/circle`), network
(`inet/cidr/macaddr/macaddr8`), bit strings (`bit/bit varying`), text search
(`tsvector/tsquery`), `xml`, `jsonb`, `pg_snapshot/txid_snapshot`, arrays, and
user-defined types. Must use correct canonical spellings (never `Iseg`/`pg_Isn`).
This is a bounded, high-value next increment: extend `DATA_TYPE_KINDS`, add a
type-aware Inspector, extend `mapSqlType` (reverse-eng) and the dialect renderers.

## Delivered this increment (Req 19, option-3 batch)

- **Object registry + capability matrix** (`objectRegistry.ts`, this file) — Phase 1.
- **Check constraints** — table-owned name + expression; inline `CONSTRAINT … CHECK (…)`
  DDL; validation (empty/dup); Explorer node under the table; Checks tab in the table
  Inspector; undo/redo; byte-identical round-trip.
- **Schemas** — first-class `CREATE SCHEMA [AUTHORIZATION] … ` + `COMMENT ON SCHEMA`;
  Explorer "Schemas" category; schema Inspector (name/owner/comment); a table's General
  tab assigns its schema; delete detaches tables (never deletes them); validation
  (identifier/dup/dangling); round-trip.
- **Materialized views** — `materialized` + `WITH NO DATA`; separate Explorer category;
  Inspector toggles; `CREATE MATERIALIZED VIEW … [WITH NO DATA]` DDL.

## Roadmap — deferred phases (build later)

Follow the existing lifecycle for each new object: model type + factory → store ops
(via `commit`, so undo/redo is free) → serialize (`serialize.ts`) + Zod (`schema.ts`,
optional field, no silent migration) → validation rule(s) → DDL (`ddl.ts`, dependency
ordering) → Explorer category + context menu → Inspector editor → reverse-eng
(`import/reverse.ts`) + diff (`migrate.ts`) → tests. Register each in `objectRegistry.ts`
and flip its `support`/`caps` only when the lifecycle is real.

- **Phase 2 (polish):** PK/unique/check as fully inspectable constraint objects with
  their own selection; index method/predicate/included columns; alternate keys.
- **Phase 3 — reusable types & config objects:** user-defined types (enum/composite/
  range), `CREATE DOMAIN` DDL, collations, casts, extensions, languages. + the §4 type
  registry expansion above.
- **Phase 4 — programmable objects:** functions, stored procedures, triggers (timing/
  event/level/function), event triggers — with dependency tracking (trigger→function,
  function→referenced objects).
- **Phase 5 — security & admin:** roles (cluster-level), permissions/grants/revokes on
  schema/table/column/function/sequence, ownership & role membership, tablespaces,
  foreign servers, access methods, transforms, statistics objects.
- **Phase 6 — round-trip & quality:** extend the SQL parser to recognise the new object
  definitions (preserving anything it can't parse as a raw object — never discard),
  dependency-aware DDL ordering + `DROP … RESTRICT/CASCADE`, and schema-comparison/
  migration coverage for every implemented object. Target-version-aware validation.

## Dependency & deletion semantics (Req 19 §6) — current state

- FK ↔ tables, view→sources, index→table/columns, check→table columns, table→schema
  are modeled; `validateWorkspace` flags dangling references and the diff engine orders
  tables topologically (`orderTables`) and drops in reverse order.
- Deleting a **schema** detaches its tables (keeps them) rather than cascading.
- Deeper dependent-aware delete prompts (warn-before-delete with a dependents list) and
  full `RESTRICT/CASCADE` emission are deferred with the programmable/security objects.
