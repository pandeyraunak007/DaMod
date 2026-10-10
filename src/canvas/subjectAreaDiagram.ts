// Subject-area diagrams (erwin-style): the canvas can scope to a single subject
// area, showing ONLY its member entities and the relationships among them. Pure
// helpers so the scoping is unit-testable independent of React Flow.

import type { Model } from "../model/model";

/** The entity ids visible in a diagram: a subject area's members, or null for the
 *  whole-model diagram (null = show everything). Unknown/empty areas yield null too
 *  (treated as the full model) so a stale scope never blanks the canvas. */
export function diagramEntityIds(model: Model, diagramId: string | null): Set<string> | null {
  if (!diagramId) return null;
  const area = model.subjectAreas?.find((a) => a.id === diagramId);
  if (!area || area.entities.length === 0) return null;
  // Only ids that still exist in the model (members can be deleted).
  const live = new Set(model.entities.map((e) => e.id));
  const ids = area.entities.filter((id) => live.has(id));
  return ids.length ? new Set(ids) : null;
}
