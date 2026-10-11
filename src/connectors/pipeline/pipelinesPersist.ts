// Persistence for pipeline specs (`pipelines.json`). One file for all pipelines,
// mirroring connections.json — versioned, deterministic, Git-friendly.

import { z } from "zod";
import { type PipelineSpec, specToPlain, zSpec } from "./spec";
import { deriveStarterGraph } from "./graphDerive";
import type { ParseResult } from "../metadata";

export const PIPELINES_FORMAT_VERSION = 1;

const zDoc = z.object({
  formatVersion: z.literal(PIPELINES_FORMAT_VERSION),
  pipelines: z.array(zSpec),
});

export interface PipelinesDoc {
  formatVersion: 1;
  pipelines: PipelineSpec[];
}

export function emptyPipelinesDoc(): PipelinesDoc {
  return { formatVersion: 1, pipelines: [] };
}

export function serializePipelines(doc: PipelinesDoc): string {
  const out = {
    formatVersion: doc.formatVersion,
    pipelines: [...doc.pipelines].sort((a, b) => a.id.localeCompare(b.id)).map(specToPlain),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Version gate (mirrors persist/schema.ts): a clear message for files from a newer
 *  app, rather than a cryptic Zod literal mismatch. */
function checkVersion(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "File is not a JSON object" };
  const v = (raw as Record<string, unknown>).formatVersion;
  if (typeof v !== "number") return { ok: false, error: "Missing or invalid formatVersion" };
  if (v > PIPELINES_FORMAT_VERSION) {
    return {
      ok: false,
      error: `pipelines.json format version ${v} is newer than this app supports (${PIPELINES_FORMAT_VERSION}). Update DaMod to open it.`,
    };
  }
  return { ok: true };
}

/** Migrate an older pipelines doc up to the current format. The doc wrapper
 *  (`formatVersion`) is unchanged; the migration is per-SPEC: a v1 spec is upgraded to
 *  v2 and, if it has no transform DAG yet, seeded with a starter graph derived from its
 *  flat objects (Phase 3 Slice D). Returns `raw` unchanged (same ref) when nothing needs
 *  upgrading, so a current-version doc is a true no-op. */
export function migratePipelinesDoc(raw: Record<string, unknown>): Record<string, unknown> {
  const list = Array.isArray(raw.pipelines) ? (raw.pipelines as Record<string, unknown>[]) : [];
  let changed = false;
  const pipelines = list.map((p) => {
    if (!p || typeof p !== "object" || p.specVersion !== 1) return p;
    changed = true;
    const up: Record<string, unknown> = { ...p, specVersion: 2 };
    if (!Array.isArray(up.nodes) || (up.nodes as unknown[]).length === 0) {
      const g = deriveStarterGraph(up as unknown as PipelineSpec);
      up.nodes = g.nodes;
      up.edges = g.edges;
    }
    return up;
  });
  return changed ? { ...raw, pipelines } : raw;
}

export function parsePipelinesFile(text: string): ParseResult<PipelinesDoc> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const version = checkVersion(raw);
  if (!version.ok) return version;
  const migrated = migratePipelinesDoc(raw as Record<string, unknown>);
  const parsed = zDoc.safeParse(migrated);
  return parsed.success
    ? { ok: true, value: parsed.data as PipelinesDoc }
    : { ok: false, error: firstIssue(parsed.error) };
}
