// Cross-model links (FR-6). A link never copies or moves anything — it records
// that two things in different models are related. Everything else (badges,
// validation, the semantic layer) reads from these records.
//
// Three link types:
//   same-as     entity → entity   both represent the same real-world thing
//   references  field  → entity   the field is a foreign key to another model
//   derived-from field → field    computed from the other; lineage only

import { newId } from "../lib/ids";
import type { Model } from "../model/model";

export type LinkType = "same-as" | "references" | "derived-from";

/** A reference into a model; carries the model ID plus the item IDs (FR-5.2). */
export interface Ref {
  model: string;
  entity: string;
  field?: string;
}

export interface FieldMapping {
  from: string; // field id on the `from` entity
  to: string; // field id on the `to` entity
}

export interface Link {
  id: string;
  type: LinkType;
  from: Ref;
  to: Ref;
  fieldMappings?: FieldMapping[]; // same-as only
}

export interface ConceptGroup {
  id: string;
  name: string;
  canonical: { model: string; entity: string };
}

export interface LinksDoc {
  formatVersion: 1;
  links: Link[];
  conceptGroups: ConceptGroup[];
}

export function emptyLinksDoc(): LinksDoc {
  return { formatVersion: 1, links: [], conceptGroups: [] };
}

export function newLink(type: LinkType, from: Ref, to: Ref, fieldMappings?: FieldMapping[]): Link {
  const link: Link = { id: newId("link"), type, from, to };
  if (type === "same-as" && fieldMappings && fieldMappings.length) {
    link.fieldMappings = fieldMappings;
  }
  return link;
}

export function entityKey(model: string, entity: string): string {
  return `${model}:${entity}`;
}

export function refKey(ref: Ref): string {
  return ref.field ? `${ref.model}:${ref.entity}:${ref.field}` : `${ref.model}:${ref.entity}`;
}

// ---- concept groups (same-as transitivity, FR-6.7) --------------------------

/**
 * Connected components of entities joined by same-as links. Each component is a
 * list of entity refs; A–B and B–C put A, B and C in one component.
 */
export function sameAsComponents(links: Link[]): { model: string; entity: string }[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  const nodes = new Map<string, { model: string; entity: string }>();
  const touch = (m: string, e: string) => {
    const k = entityKey(m, e);
    if (!parent.has(k)) parent.set(k, k);
    nodes.set(k, { model: m, entity: e });
    return k;
  };

  for (const l of links) {
    if (l.type !== "same-as") continue;
    const a = touch(l.from.model, l.from.entity);
    const b = touch(l.to.model, l.to.entity);
    union(a, b);
  }

  const groups = new Map<string, { model: string; entity: string }[]>();
  for (const [k, ref] of nodes) {
    const root = find(k);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ref);
  }
  return [...groups.values()];
}

/** The same-as component that contains a given entity, or null. */
export function componentFor(
  links: Link[],
  model: string,
  entity: string,
): { model: string; entity: string }[] | null {
  const key = entityKey(model, entity);
  for (const comp of sameAsComponents(links)) {
    if (comp.some((r) => entityKey(r.model, r.entity) === key)) return comp;
  }
  return null;
}

// ---- field-mapping proposal (FR-6.2) ----------------------------------------

/**
 * Propose field pairs for a same-as link by matching names (case-insensitive).
 * The author confirms, edits or clears each pair, and adds any whose names
 * differ (e.g. email ↔ email_address).
 */
export function proposeFieldMappings(
  fromModel: Model,
  fromEntityId: string,
  toModel: Model,
  toEntityId: string,
): FieldMapping[] {
  const fromEntity = fromModel.entities.find((e) => e.id === fromEntityId);
  const toEntity = toModel.entities.find((e) => e.id === toEntityId);
  if (!fromEntity || !toEntity) return [];
  const mappings: FieldMapping[] = [];
  for (const ff of fromEntity.fields) {
    const match = toEntity.fields.find((tf) => tf.name.toLowerCase() === ff.name.toLowerCase());
    if (match) mappings.push({ from: ff.id, to: match.id });
  }
  return mappings;
}

// ---- lookups for badges, where-used and deletion cascade --------------------

/** Links that reference the given entity or field (either endpoint). */
export function linksTouching(links: Link[], ref: Ref): Link[] {
  const key = refKey(ref);
  const entKey = entityKey(ref.model, ref.entity);
  return links.filter((l) => {
    const ends = [l.from, l.to];
    return ends.some((r) => {
      if (ref.field) {
        // A field ref is touched by a field-level endpoint, or by a same-as
        // whose mapping includes it.
        if (refKey(r) === key) return true;
        if (l.type === "same-as" && l.fieldMappings) {
          const onFrom = entityKey(l.from.model, l.from.entity) === entKey;
          const onTo = entityKey(l.to.model, l.to.entity) === entKey;
          return l.fieldMappings.some(
            (m) => (onFrom && m.from === ref.field) || (onTo && m.to === ref.field),
          );
        }
        return false;
      }
      return entityKey(r.model, r.entity) === entKey;
    });
  });
}

/** True when an entity or field has any link (for badges, FR-6.4). */
export function hasLinks(links: Link[], ref: Ref): boolean {
  return linksTouching(links, ref).length > 0;
}

/** Remove every link touching a deleted entity or field (FR-6.6). */
export function removeLinksTouching(links: Link[], ref: Ref): { kept: Link[]; removed: Link[] } {
  const removed = linksTouching(links, ref);
  const removedIds = new Set(removed.map((l) => l.id));
  return { kept: links.filter((l) => !removedIds.has(l.id)), removed };
}
