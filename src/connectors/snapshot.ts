// Source snapshots and provenance (§3.5, §3.6, §3.7). A snapshot records what a
// source contained at one discovery point. It separates STABLE content (the
// canonical metadata — what we diff across refreshes) from OPERATIONAL provenance
// (when/by-what it was discovered), so stable content serializes deterministically
// and volatile timestamps never create meaningless diffs.
//
// Snapshots carry a connection REFERENCE (an id), never credentials.

import { z } from "zod";
import { CAPABILITIES } from "./capabilities";
import { findSecretLeaks } from "./connection";
import {
  type CanonicalMetadata,
  type ParseResult,
  parseMetadata,
  zCanonicalMetadata,
} from "./metadata";

export const SNAPSHOT_VERSION = 1;

const zProvenance = z.object({
  connectorId: z.string(),
  connectorVersion: z.string(),
  /** Operational only — kept out of the stable, diffable content. */
  discoveredAt: z.string(),
  schemasDiscovered: z.array(z.string()).default([]),
  capabilitiesUsed: z
    .array(z.enum(CAPABILITIES as unknown as [string, ...string[]]))
    .default([]),
});
export type Provenance = z.infer<typeof zProvenance>;

export const zSourceSnapshot = z.object({
  snapshotVersion: z.literal(SNAPSHOT_VERSION),
  id: z.string(),
  /** Id of the ConnectionProfile this came from. Never the credentials. */
  connectionRef: z.string(),
  /** Stable, deterministic content — the thing refresh/drift compares. */
  metadata: zCanonicalMetadata,
  /** Operational metadata, stored alongside but excluded from the stable view. */
  provenance: zProvenance,
});
export type SourceSnapshot = z.infer<typeof zSourceSnapshot>;

// ---- deterministic serialization (mirrors persist/serialize.ts) -------------
//
// Canonical plain objects are built with keys inserted in a FIXED order and
// optional keys omitted when empty. This is independent of the key order of the
// input (which differs between a freshly-discovered object and one re-parsed by
// Zod), so serialize → parse → serialize is byte-identical.

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function columnToPlain(c: CanonicalMetadata["catalogs"][number]["schemas"][number]["objects"][number]["columns"][number]) {
  const out: Record<string, unknown> = { name: c.name, ordinal: c.ordinal, nativeType: c.nativeType };
  if (c.normalizedType) {
    const t = c.normalizedType;
    const nt: Record<string, unknown> = { type: t.type };
    if (t.length !== undefined) nt.length = t.length;
    if (t.precision !== undefined) nt.precision = t.precision;
    if (t.scale !== undefined) nt.scale = t.scale;
    out.normalizedType = nt;
  }
  out.nullable = c.nullable;
  if (c.default !== undefined) out.default = c.default;
  if (c.generated !== undefined) out.generated = c.generated;
  if (c.comment) out.comment = c.comment;
  if (c.nativeId) out.nativeId = c.nativeId;
  return out;
}

function metadataToPlain(md: CanonicalMetadata): Record<string, unknown> {
  const source: Record<string, unknown> = {
    systemType: md.source.systemType,
    name: md.source.name,
  };
  if (md.source.productVersion) source.productVersion = md.source.productVersion;
  // EBS identity is part of the stable snapshot content (Req 21 §11) — kept
  // separate from the DB version.
  if (md.source.ebsRelease) source.ebsRelease = md.source.ebsRelease;
  if (md.source.ebsInstance) source.ebsInstance = md.source.ebsInstance;
  if (md.source.apiVersion) source.apiVersion = md.source.apiVersion;
  const out: Record<string, unknown> = {
    metadataVersion: md.metadataVersion,
    source,
    capabilities: [...md.capabilities].sort(),
    catalogs: [...md.catalogs].sort(byName).map((cat) => ({
      name: cat.name,
      schemas: [...cat.schemas].sort(byName).map((sch) => ({
        name: sch.name,
        objects: [...sch.objects].sort(byName).map((obj) => {
          const o: Record<string, unknown> = { name: obj.name, kind: obj.kind };
          // Columns keep source order (ordinal); keys/indexes sort for stability.
          o.columns = [...obj.columns].sort((a, b) => a.ordinal - b.ordinal).map(columnToPlain);
          if (obj.primaryKey && obj.primaryKey.length) o.primaryKey = [...obj.primaryKey];
          o.foreignKeys = [...obj.foreignKeys]
            .sort((a, b) => (a.name ?? a.columns.join()).localeCompare(b.name ?? b.columns.join()))
            .map((fk) => {
              const f: Record<string, unknown> = {};
              if (fk.name) f.name = fk.name;
              f.columns = [...fk.columns];
              if (fk.refSchema) f.refSchema = fk.refSchema;
              f.refObject = fk.refObject;
              f.refColumns = [...fk.refColumns];
              if (fk.onDelete) f.onDelete = fk.onDelete;
              if (fk.onUpdate) f.onUpdate = fk.onUpdate;
              if (fk.provenance) f.provenance = fk.provenance;
              if (fk.confidence !== undefined) f.confidence = fk.confidence;
              return f;
            });
          o.indexes = [...obj.indexes]
            .sort(byName)
            .map((ix) => ({ name: ix.name, columns: [...ix.columns], unique: ix.unique }));
          if (obj.comment) o.comment = obj.comment;
          if (obj.nativeId) o.nativeId = obj.nativeId;
          if (obj.native) o.native = obj.native;
          return o;
        }),
      })),
    })),
  };

  // EBS application-dictionary metadata (Req 21 §3C) — deterministic, omit-empty.
  const app = md.application;
  if (app && (app.concurrentPrograms.length || app.lookups.length || app.programUnits.length)) {
    out.application = {
      concurrentPrograms: [...app.concurrentPrograms]
        .sort((a, b) => a.shortName.localeCompare(b.shortName))
        .map((p) => {
          const r: Record<string, unknown> = { shortName: p.shortName, name: p.name, product: p.product };
          if (p.description) r.description = p.description;
          return r;
        }),
      lookups: [...app.lookups]
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((l) => {
          const r: Record<string, unknown> = { type: l.type, product: l.product };
          if (l.description) r.description = l.description;
          return r;
        }),
      programUnits: [...app.programUnits]
        .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`))
        .map((u) => {
          const r: Record<string, unknown> = { name: u.name, kind: u.kind, schema: u.schema };
          if (u.product) r.product = u.product;
          if (u.description) r.description = u.description;
          return r;
        }),
    };
  }

  // Fusion Cloud API/extract metadata (Req 22 §5) — deterministic, omit-empty.
  const fus = md.fusion;
  if (fus && (fus.apiResources.length || fus.extractDataStores.length)) {
    out.fusion = {
      apiResources: [...fus.apiResources]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((r) => {
          const o: Record<string, unknown> = { name: r.name, path: r.path, methods: [...r.methods] };
          if (r.version) o.version = r.version;
          if (r.family) o.family = r.family;
          if (r.description) o.description = r.description;
          return o;
        }),
      extractDataStores: [...fus.extractDataStores]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => {
          const o: Record<string, unknown> = { name: d.name, offering: d.offering, fields: [...d.fields] };
          if (d.incremental !== undefined) o.incremental = d.incremental;
          if (d.description) o.description = d.description;
          return o;
        }),
    };
  }
  return out;
}

/**
 * Deterministic JSON for the STABLE part of a snapshot (metadata only), used for
 * content hashing and drift diffs — provenance timestamps are deliberately
 * excluded so an unchanged schema produces byte-identical output.
 */
export function serializeMetadata(md: CanonicalMetadata): string {
  return JSON.stringify(metadataToPlain(md), null, 2) + "\n";
}

/** Full snapshot file text (stable metadata + operational provenance). */
export function serializeSnapshot(snap: SourceSnapshot): string {
  const p = snap.provenance;
  const out = {
    snapshotVersion: snap.snapshotVersion,
    id: snap.id,
    connectionRef: snap.connectionRef,
    provenance: {
      connectorId: p.connectorId,
      connectorVersion: p.connectorVersion,
      discoveredAt: p.discoveredAt,
      schemasDiscovered: [...p.schemasDiscovered],
      capabilitiesUsed: [...p.capabilitiesUsed],
    },
    metadata: metadataToPlain(snap.metadata),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Validate an imported METADATA-package file (Req 21 §3C/§10: offline modeling from
 * eTRM-derived / exported metadata when no live connection is available). Rejects any
 * file carrying a credential, then validates against the canonical contract.
 */
export function parseMetadataFile(text: string): ParseResult<CanonicalMetadata> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const leaks = findSecretLeaks(raw);
  if (leaks.length) {
    return { ok: false, error: `Refusing to import: the file appears to contain a credential (${leaks[0]}).` };
  }
  return parseMetadata(raw);
}

/** Validate snapshot file text (§7: validate every imported snapshot). */
export function parseSnapshot(text: string): ParseResult<SourceSnapshot> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  // A snapshot that somehow carries a credential is rejected outright.
  const leaks = findSecretLeaks(raw);
  if (leaks.length) {
    return { ok: false, error: `Snapshot contains credential-like fields: ${leaks.join(", ")}` };
  }
  const parsed = zSourceSnapshot.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: firstIssue(parsed.error) };
}
