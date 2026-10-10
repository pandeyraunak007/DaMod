// EBS-aware grouping of the active model (Req 21 Phase 2, §4). Pure + DB-free so it
// is unit-testable. Drives the read-only EBS Explorer view: the same discovered
// tables, regrouped by their application PRODUCT or by database SCHEMA (the two
// sibling branches the eTRM-style hierarchy calls for), using the discovery
// provenance (`entity.source`) stamped at reverse-engineering time.

import type { Entity, Model } from "../model/model";

export type EbsGrouping = "product" | "schema";

export interface EbsGroup {
  key: string;
  label: string;
  entities: Entity[];
}

/** The EBS product code for an entity, from provenance or an `ebs:<CODE>` tag. */
export function ebsEntityProduct(e: Entity): string | undefined {
  if (e.source?.product) return e.source.product;
  const tag = (e.tags ?? []).find((t) => t.startsWith("ebs:"));
  return tag ? tag.slice("ebs:".length) : undefined;
}

/** The source schema for an entity (discovery provenance, then modeled schema). */
export function ebsEntitySchema(e: Entity): string | undefined {
  return e.source?.schema ?? e.schema ?? undefined;
}

/** True when the active model carries EBS/Oracle discovery provenance. */
export function hasEbsContent(model: Model): boolean {
  return model.entities.some(
    (e) => !!ebsEntityProduct(e) || e.source?.system === "oracle-ebs" || e.source?.system === "oracle",
  );
}

const UNGROUPED = "ÿ"; // sorts last

/** Group the model's entities by product or schema, sorted, each sorted by name. */
export function ebsGroups(model: Model, grouping: EbsGrouping): EbsGroup[] {
  const by = new Map<string, EbsGroup>();
  for (const e of model.entities) {
    const raw = grouping === "product" ? ebsEntityProduct(e) : ebsEntitySchema(e);
    const key = raw ?? UNGROUPED;
    const label = raw ?? (grouping === "product" ? "(no product)" : "(no schema)");
    const g = by.get(key) ?? { key, label, entities: [] };
    g.entities.push(e);
    by.set(key, g);
  }
  const groups = [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const g of groups) g.entities.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}
