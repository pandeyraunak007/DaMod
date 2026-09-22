// Deterministic serialization and validation for links.json (FR-5.5–5.7).

import { z } from "zod";
import { type ParseResult, CURRENT_FORMAT_VERSION } from "../persist/schema";
import type { ConceptGroup, Link, LinksDoc, Ref } from "./links";

function serializeRef(r: Ref): Record<string, unknown> {
  const out: Record<string, unknown> = { model: r.model, entity: r.entity };
  if (r.field) out.field = r.field;
  return out;
}

function serializeLink(l: Link): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: l.id,
    type: l.type,
    from: serializeRef(l.from),
    to: serializeRef(l.to),
  };
  if (l.fieldMappings && l.fieldMappings.length) {
    out.fieldMappings = l.fieldMappings.map((m) => ({ from: m.from, to: m.to }));
  }
  return out;
}

function serializeGroup(g: ConceptGroup): Record<string, unknown> {
  return {
    id: g.id,
    name: g.name,
    canonical: { model: g.canonical.model, entity: g.canonical.entity },
  };
}

export function serializeLinks(doc: LinksDoc): string {
  const out = {
    formatVersion: doc.formatVersion,
    links: doc.links.map(serializeLink),
    conceptGroups: doc.conceptGroups.map(serializeGroup),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

const zRef = z.object({
  model: z.string(),
  entity: z.string(),
  field: z.string().optional(),
});

const zLink = z.object({
  id: z.string(),
  type: z.enum(["same-as", "references", "derived-from"]),
  from: zRef,
  to: zRef,
  fieldMappings: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
});

const zGroup = z.object({
  id: z.string(),
  name: z.string(),
  canonical: z.object({ model: z.string(), entity: z.string() }),
});

const zLinksDoc = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  links: z.array(zLink).optional().default([]),
  conceptGroups: z.array(zGroup).optional().default([]),
});

export function parseLinksFile(text: string): ParseResult<LinksDoc> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "links.json is not a JSON object" };
  }
  const version = (raw as Record<string, unknown>).formatVersion;
  if (typeof version !== "number") return { ok: false, error: "Missing formatVersion" };
  if (version > CURRENT_FORMAT_VERSION) {
    return { ok: false, error: `links.json format ${version} is newer than supported` };
  }
  const parsed = zLinksDoc.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    return { ok: false, error: path ? `${path}: ${issue.message}` : issue.message };
  }
  return { ok: true, value: parsed.data as LinksDoc };
}
