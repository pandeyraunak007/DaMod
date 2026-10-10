// Oracle Fusion Cloud application-awareness layer (Req 22 §5/§6/§7).
//
// Fusion metadata is API/extract-oriented, not relational. We model business
// objects as canonical objects (kind "business-object") and carry Fusion specifics
// (application family, module, API path/version) as a typed `native.fusion`
// annotation — the same extension point EBS uses — so the shared metadata contract,
// snapshot, drift and toModel pipeline keep working unchanged. Verified (documented)
// metadata is kept distinct from inferred meaning (§5/§9).

import { z } from "zod";
import type { CanonicalMetadata, CanonicalObject } from "../metadata";
import { allObjects } from "../metadata";
import { metadataToModel, type ToModelResult } from "../toModel";

export const zFusionAnnotation = z.object({
  /** Application family, e.g. "Financials", "Procurement", "SCM", "HCM". */
  family: z.string(),
  /** Module within the family, e.g. "Payables", "Receivables". */
  module: z.string().optional(),
  /** Documented business-object id / REST resource path (stable source key). */
  businessObjectId: z.string().optional(),
  apiPath: z.string().optional(),
  apiVersion: z.string().optional(),
  /** true = documented Fusion metadata; false/undefined = inferred/AI-proposed. */
  verified: z.boolean().optional(),
});
export type FusionAnnotation = z.infer<typeof zFusionAnnotation>;

/** Read the Fusion annotation off a canonical object, if present and valid. */
export function fusionAnnotation(obj: CanonicalObject): FusionAnnotation | undefined {
  const raw = obj.native?.fusion;
  if (!raw) return undefined;
  const parsed = zFusionAnnotation.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface FusionFamily {
  name: string;
  objectCount: number;
}

/** The application-family catalog, derived from actual object annotations (§4:
 *  populate families from discovered metadata, not an assumed fixed list). */
export function fusionFamilies(md: CanonicalMetadata): FusionFamily[] {
  const byName = new Map<string, FusionFamily>();
  for (const { object } of allObjects(md)) {
    const a = fusionAnnotation(object);
    if (!a) continue;
    const cur = byName.get(a.family) ?? { name: a.family, objectCount: 0 };
    cur.objectCount += 1;
    byName.set(a.family, cur);
  }
  return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
}

export interface FusionApiSummary {
  apiResources: number;
  extractDataStores: number;
}

/** Counts of the Fusion API/extract metadata in a discovery (Req 22 §2). */
export function fusionApiSummary(md: CanonicalMetadata): FusionApiSummary {
  return {
    apiResources: md.fusion?.apiResources.length ?? 0,
    extractDataStores: md.fusion?.extractDataStores.length ?? 0,
  };
}

export interface FusionToModelResult extends ToModelResult {
  families: FusionFamily[];
}

/**
 * Reverse-engineer a Fusion snapshot into an editable model, reusing the existing
 * `metadataToModel`. Beyond the physical structure it tags each entity with its
 * application family (`fusion:<FAMILY>`), records the family/module on the entity's
 * discovery provenance, and (ONLY for verified metadata) seeds the description from
 * the documented business purpose — inferred text is never promoted (§5).
 */
export function fusionSnapshotToModel(
  md: CanonicalMetadata,
  modelName: string,
  now: string,
): FusionToModelResult {
  const result = metadataToModel(md, modelName, now);
  const annByName = new Map<string, FusionAnnotation>();
  for (const { object } of allObjects(md)) {
    const a = fusionAnnotation(object);
    if (a) annByName.set(object.name.toLowerCase(), a);
  }
  for (const entity of result.model.entities) {
    const a = annByName.get(entity.name.toLowerCase());
    if (!a) continue;
    const tags = new Set(entity.tags ?? []);
    tags.add(`fusion:${a.family}`);
    entity.tags = [...tags];
    if (entity.source) {
      // Reuse the generic provenance product slot for the family grouping key.
      entity.source.product = a.family;
      if (a.module) entity.source.schema = entity.source.schema ?? a.module;
    }
  }
  return { ...result, families: fusionFamilies(md) };
}
