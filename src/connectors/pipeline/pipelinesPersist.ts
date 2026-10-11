// Persistence for pipeline specs (`pipelines.json`). One file for all pipelines,
// mirroring connections.json — versioned, deterministic, Git-friendly.

import { z } from "zod";
import { type PipelineSpec, specToPlain, zSpec } from "./spec";
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

/** Migrate an older pipelines doc up to the current format version. No-op for v1;
 *  future migrations switch on `raw.formatVersion` here. The shim exists now so any
 *  later spec change has a home (and old pipelines.json keeps loading). */
export function migratePipelinesDoc(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
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
