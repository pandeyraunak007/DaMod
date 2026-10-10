// Source-aware reverse-engineering (Reqs 21/22). One place that turns discovered /
// imported canonical metadata into an editable model, dispatching on the source
// system so each application source gets its enrichment (product/family tags,
// verified descriptions, provenance) while plain relational sources use the base
// mapper. Everything flows through the SAME `metadataToModel` underneath.

import type { CanonicalMetadata } from "./metadata";
import { metadataToModel, type ToModelResult } from "./toModel";
import { ebsSnapshotToModel } from "./oracle/ebs";
import { fusionSnapshotToModel } from "./fusion/fusion";

export function metadataToModelForSource(md: CanonicalMetadata, name: string, now: string): ToModelResult {
  switch (md.source.systemType) {
    case "oracle-ebs":
      return ebsSnapshotToModel(md, name, now);
    case "oracle-fusion":
      return fusionSnapshotToModel(md, name, now);
    default:
      return metadataToModel(md, name, now);
  }
}
