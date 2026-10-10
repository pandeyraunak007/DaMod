// Oracle E-Business Suite application-awareness layer (Req 21 §3C/§4/§5).
//
// EBS application metadata (which product owns a table, its business purpose) is
// NOT discoverable from standard Oracle catalog views — it comes from the EBS
// application dictionary / eTRM. We carry it as a typed annotation inside each
// canonical object's `native.ebs` bag (an existing extension point), so the shared
// metadata contract, snapshot storage, drift and toModel pipeline all keep working
// unchanged. Verified (documented) metadata is kept distinct from inferred meaning
// (§5): we never promote an inferred description into authoritative model text.

import { z } from "zod";
import type { CanonicalMetadata, CanonicalObject } from "../metadata";
import { allObjects } from "../metadata";
import { metadataToModel, type ToModelResult } from "../toModel";

export const zEbsAnnotation = z.object({
  /** Module short code, e.g. "AP" (Payables), "GL" (General Ledger). */
  product: z.string(),
  productName: z.string().optional(),
  businessDescription: z.string().optional(),
  /** true = documented EBS/eTRM metadata; false/undefined = inferred/AI-proposed. */
  verified: z.boolean().optional(),
});
export type EbsAnnotation = z.infer<typeof zEbsAnnotation>;

/** Read the EBS annotation off a canonical object, if present and valid. */
export function ebsAnnotation(obj: CanonicalObject): EbsAnnotation | undefined {
  const raw = obj.native?.ebs;
  if (!raw) return undefined;
  const parsed = zEbsAnnotation.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface EbsProduct {
  code: string;
  name?: string;
  objectCount: number;
}

/** The EBS product catalog, derived from actual object annotations (Req 21 §4:
 *  populate products from discovered metadata, not an assumed fixed list). */
export function ebsProducts(md: CanonicalMetadata): EbsProduct[] {
  const byCode = new Map<string, EbsProduct>();
  for (const { object } of allObjects(md)) {
    const a = ebsAnnotation(object);
    if (!a) continue;
    const cur = byCode.get(a.product) ?? { code: a.product, name: a.productName, objectCount: 0 };
    cur.objectCount += 1;
    if (!cur.name && a.productName) cur.name = a.productName;
    byCode.set(a.product, cur);
  }
  return [...byCode.values()].sort((x, y) => x.code.localeCompare(y.code));
}

export interface EbsToModelResult extends ToModelResult {
  products: EbsProduct[];
}

/**
 * Reverse-engineer an EBS snapshot into an editable model, reusing the existing
 * `metadataToModel`. Beyond the physical structure it tags each entity with its
 * owning product (`ebs:<CODE>`) and, ONLY for verified metadata, seeds the entity
 * description from the documented business purpose. Inferred descriptions are left
 * out of the model so they are never mistaken for authoritative EBS metadata (§5).
 */
export function ebsSnapshotToModel(
  md: CanonicalMetadata,
  modelName: string,
  now: string,
): EbsToModelResult {
  const result = metadataToModel(md, modelName, now);
  const annByName = new Map<string, EbsAnnotation>();
  for (const { object } of allObjects(md)) {
    const a = ebsAnnotation(object);
    if (a) annByName.set(object.name.toLowerCase(), a);
  }
  for (const entity of result.model.entities) {
    const a = annByName.get(entity.name.toLowerCase());
    if (!a) continue;
    const tags = new Set(entity.tags ?? []);
    tags.add(`ebs:${a.product}`);
    entity.tags = [...tags];
    // Record the owning product on the provenance set by metadataToModel.
    if (entity.source) entity.source.product = a.product;
    if (a.verified && a.businessDescription && !entity.description) {
      entity.description = a.businessDescription;
    }
  }
  return { ...result, products: ebsProducts(md) };
}
