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

export function parsePipelinesFile(text: string): ParseResult<PipelinesDoc> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const parsed = zDoc.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data as PipelinesDoc }
    : { ok: false, error: firstIssue(parsed.error) };
}
