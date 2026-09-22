import { create } from "zustand";
import {
  type DbDialect,
  type Entity,
  type Field,
  type Index,
  type Model,
  type Notation,
  type Position,
  type RawObject,
  type Relationship,
  type Sequence,
  type View,
  findEntity,
  findField,
  newEntity,
  newField,
  newIndex,
  newModel,
  newRawObject,
  newSequence,
  newView,
} from "../model/model";
import { paramShape, withTypeDefaults } from "../model/dataTypes";
import {
  type AmbiguousField,
  type CreateRelationshipInput,
  type CreateRelationshipResult,
  type DeleteEntityResult,
  type TypeChange,
  createRelationship as createRelationshipOp,
  deleteEntity as deleteEntityOp,
  reconcileForeignKeyTypes,
  relevelModel,
} from "../model/operations";
import {
  type ModelLevel,
  isConceptual,
  usesLogicalTypes,
  usesPhysicalTypes,
} from "../model/levels";
import type { Ref } from "../links/links";
import { validateIdentifier } from "../model/identifiers";
import { newId } from "../lib/ids";

const HISTORY_LIMIT = 100; // FR-4.5 asks for at least 50 steps.

export type Selection =
  | { kind: "entity"; id: string }
  | { kind: "relationship"; id: string }
  | { kind: "view"; id: string }
  | { kind: "index"; id: string }
  | { kind: "sequence"; id: string }
  | { kind: "rawObject"; id: string }
  | null;

export interface Notice {
  id: string;
  message: string;
}

export interface FocusRequest {
  entityId: string;
  token: number;
}

export type CanvasMode = "select" | "add-entity" | "add-relationship";

interface ModelStore {
  model: Model;
  past: Model[];
  future: Model[];
  selection: Selection;
  notices: Notice[];
  focus: FocusRequest | null;
  relationshipDraft: { source: string; target: string } | null;
  linkDraft: Ref | null;
  canvasMode: CanvasMode;
  propertiesOpen: boolean;
  _dragSnapshot: Model | null;

  // model
  setModelName: (name: string) => string | null;
  setModelLevel: (level: ModelLevel) => AmbiguousField[];
  setNotation: (notation: Notation) => void;

  // entities
  createEntity: (position?: Position) => string;
  renameEntity: (id: string, name: string) => string | null;
  updateEntity: (
    id: string,
    patch: Partial<Pick<Entity, "description" | "tags" | "stereotype" | "note" | "udps">>,
  ) => void;
  deleteEntity: (id: string) => DeleteEntityResult;

  // fields
  addField: (entityId: string) => string | null;
  updateField: (entityId: string, fieldId: string, patch: Partial<Field>) => void;
  deleteField: (entityId: string, fieldId: string) => void;
  reorderField: (entityId: string, from: number, to: number) => void;
  syncFields: (entityId: string, sourceFields: Field[]) => number;

  // other database objects (views, indexes, sequences, raw objects)
  createView: (position?: Position) => string;
  updateView: (id: string, patch: Partial<View>) => void;
  deleteView: (id: string) => void;
  createIndex: (entityId: string) => string | null;
  updateIndex: (id: string, patch: Partial<Index>) => void;
  deleteIndex: (id: string) => void;
  createSequence: () => string;
  updateSequence: (id: string, patch: Partial<Sequence>) => void;
  deleteSequence: (id: string) => void;
  createRawObject: (dialect: DbDialect) => string;
  updateRawObject: (id: string, patch: Partial<RawObject>) => void;
  deleteRawObject: (id: string) => void;

  // relationships
  openRelationshipDraft: (source: string, target: string) => void;
  closeRelationshipDraft: () => void;
  openLinkDraft: (ref: Ref) => void;
  closeLinkDraft: () => void;
  createRelationship: (params: CreateRelationshipInput) => CreateRelationshipResult;
  updateRelationship: (id: string, patch: Partial<Relationship>) => void;
  deleteRelationship: (id: string) => void;

  // canvas interaction
  applyNodePositions: (updates: { id: string; position: Position }[]) => void;
  beginInteraction: () => void;
  endInteraction: () => void;
  arrange: () => void;
  arrangeStar: () => void;

  // canvas interaction mode (floating toolbar)
  setCanvasMode: (mode: CanvasMode) => void;

  // ERwin-style properties dialog
  openProperties: () => void;
  closeProperties: () => void;

  // selection / focus / notices
  select: (selection: Selection) => void;
  revealEntity: (id: string) => void;
  revealRelationship: (id: string) => void;
  search: (query: string) => boolean;
  pushNotice: (message: string) => void;
  dismissNotice: (id: string) => void;

  // history
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // testing / reset
  loadModel: (model: Model) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pushPast(past: Model[], snapshot: Model): Model[] {
  const next = [...past, snapshot];
  if (next.length > HISTORY_LIMIT) next.shift();
  return next;
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** Ensure a field's parameters match its type kind. */
function normalizeFieldParams(field: Field): void {
  if (!field.type) {
    delete field.length;
    delete field.precision;
    delete field.scale;
    return;
  }
  const shape = paramShape(field.type);
  const defaults = withTypeDefaults(field.type);
  if (shape === "length") {
    if (field.length === undefined) field.length = defaults.length;
    delete field.precision;
    delete field.scale;
  } else if (shape === "decimal") {
    if (field.precision === undefined) field.precision = defaults.precision;
    if (field.scale === undefined) field.scale = defaults.scale;
    delete field.length;
  } else {
    delete field.length;
    delete field.precision;
    delete field.scale;
  }
}

function typeNoticeMessage(changes: TypeChange[]): string {
  const list = changes
    .map((c) => `${c.entityName}.${c.fieldName} → ${c.to}`)
    .join(", ");
  const noun = changes.length === 1 ? "foreign key" : "foreign keys";
  return `Updated ${changes.length} ${noun} to match the referenced key: ${list}`;
}

export const useModelStore = create<ModelStore>((set, get) => {
  /** Apply a producer to a cloned model and commit it as a new history step. */
  function commit(producer: (model: Model) => void): void {
    set((s) => {
      const next = structuredClone(s.model);
      producer(next);
      next.updatedAt = nowIso();
      return { past: pushPast(s.past, s.model), model: next, future: [] };
    });
  }

  return {
    model: newModel("untitled", nowIso()),
    past: [],
    future: [],
    selection: null,
    notices: [],
    focus: null,
    relationshipDraft: null,
    linkDraft: null,
    canvasMode: "select",
    propertiesOpen: false,
    _dragSnapshot: null,

    setModelName: (name) => {
      const error = validateIdentifier(name);
      if (error) return error;
      commit((m) => {
        m.name = name;
      });
      return null;
    },

    setModelLevel: (level) => {
      const result = relevelModel(get().model, level);
      set((s) => ({
        past: pushPast(s.past, s.model),
        model: { ...result.model, updatedAt: nowIso() },
        future: [],
      }));
      return result.ambiguous;
    },

    setNotation: (notation) => {
      commit((m) => {
        m.notation = notation;
      });
    },

    createEntity: (position) => {
      const state = get();
      const taken = new Set(state.model.entities.map((e) => e.name));
      const name = uniqueName("NewEntity", taken);
      const count = state.model.entities.length;
      const pos =
        position ?? { x: 80 + (count % 5) * 280, y: 80 + Math.floor(count / 5) * 220 };
      const entity = newEntity(name, pos);
      commit((m) => {
        m.entities.push(entity);
      });
      set({ selection: { kind: "entity", id: entity.id } });
      return entity.id;
    },

    renameEntity: (id, name) => {
      const error = validateIdentifier(name);
      if (error) return error; // reject; name unchanged (AT-1.2)
      commit((m) => {
        const e = findEntity(m, id);
        if (e) e.name = name;
      });
      return null;
    },

    updateEntity: (id, patch) => {
      commit((m) => {
        const e = findEntity(m, id);
        if (!e) return;
        if ("description" in patch) e.description = patch.description || undefined;
        if ("tags" in patch) e.tags = patch.tags?.length ? patch.tags : undefined;
        if ("stereotype" in patch) e.stereotype = patch.stereotype || undefined;
        if ("note" in patch) e.note = patch.note || undefined;
        if ("udps" in patch) e.udps = patch.udps?.length ? patch.udps : undefined;
      });
    },

    deleteEntity: (id) => {
      const result = deleteEntityOp(get().model, id);
      set((s) => ({
        past: pushPast(s.past, s.model),
        model: { ...result.model, updatedAt: nowIso() },
        future: [],
        selection: null,
      }));
      return result;
    },

    addField: (entityId) => {
      const state = get();
      const entity = findEntity(state.model, entityId);
      if (!entity) return null;
      const taken = new Set(entity.fields.map((f) => f.name));
      const name = uniqueName("field", taken);
      const level = state.model.level;
      // The new field's type shape follows the model's level (FR-11).
      let field: Field;
      if (isConceptual(level)) {
        field = newField(name);
      } else if (usesPhysicalTypes(level)) {
        field = newField(name, "string", usesLogicalTypes(level) ? { logicalType: "Text" } : {});
      } else {
        field = newField(name, undefined, { logicalType: "Text" });
      }
      commit((m) => {
        const e = findEntity(m, entityId);
        e?.fields.push(field);
      });
      return field.id;
    },

    updateField: (entityId, fieldId, patch) => {
      set((s) => {
        const next = structuredClone(s.model);
        const entity = findEntity(next, entityId);
        const field = entity ? findField(entity, fieldId) : undefined;
        if (!entity || !field) return {};
        const wasPk = field.primaryKey;
        Object.assign(field, patch);
        normalizeFieldParams(field);
        // Realign dependent foreign keys when a primary key's type changes (FR-3.7).
        let changes: TypeChange[] = [];
        if (wasPk || field.primaryKey) {
          changes = reconcileForeignKeyTypes(next);
        }
        next.updatedAt = nowIso();
        const notices = changes.length
          ? [...s.notices, { id: newId("field"), message: typeNoticeMessage(changes) }]
          : s.notices;
        return {
          past: pushPast(s.past, s.model),
          model: next,
          future: [],
          notices,
        };
      });
    },

    deleteField: (entityId, fieldId) => {
      commit((m) => {
        const entity = findEntity(m, entityId);
        if (!entity) return;
        entity.fields = entity.fields.filter((f) => f.id !== fieldId);
        for (const rel of m.relationships) {
          rel.foreignKeyFields = rel.foreignKeyFields.filter((id) => id !== fieldId);
        }
      });
    },

    reorderField: (entityId, from, to) => {
      commit((m) => {
        const entity = findEntity(m, entityId);
        if (!entity) return;
        const fields = entity.fields;
        if (from < 0 || from >= fields.length || to < 0 || to >= fields.length) return;
        const [moved] = fields.splice(from, 1);
        fields.splice(to, 0, moved);
      });
    },

    // Copy fields that exist on a source (canonical) entity but not here, by name
    // (FR-6.10). Always explicit. Returns how many fields were added.
    syncFields: (entityId, sourceFields) => {
      let added = 0;
      commit((m) => {
        const entity = findEntity(m, entityId);
        if (!entity) return;
        const have = new Set(entity.fields.map((f) => f.name));
        for (const src of sourceFields) {
          if (have.has(src.name)) continue;
          entity.fields.push({ ...structuredClone(src), id: newId("field") });
          added++;
        }
      });
      return added;
    },

    createView: (position) => {
      const state = get();
      const taken = new Set((state.model.views ?? []).map((v) => v.name));
      const count = state.model.views?.length ?? 0;
      const pos = position ?? { x: 120 + (count % 4) * 260, y: 520 + Math.floor(count / 4) * 180 };
      const view = newView(uniqueName("new_view", taken), pos);
      commit((m) => {
        m.views = [...(m.views ?? []), view];
      });
      set({ selection: { kind: "view", id: view.id } });
      return view.id;
    },
    updateView: (id, patch) => {
      commit((m) => {
        m.views = (m.views ?? []).map((v) => (v.id === id ? { ...v, ...patch } : v));
      });
    },
    deleteView: (id) => {
      commit((m) => {
        m.views = (m.views ?? []).filter((v) => v.id !== id);
      });
      set((s) => (s.selection?.kind === "view" && s.selection.id === id ? { selection: null } : {}));
    },

    createIndex: (entityId) => {
      const entity = findEntity(get().model, entityId);
      if (!entity) return null;
      const taken = new Set((get().model.indexes ?? []).map((i) => i.name));
      const index = newIndex(uniqueName(`idx_${entity.name.toLowerCase()}`, taken), entityId);
      commit((m) => {
        m.indexes = [...(m.indexes ?? []), index];
      });
      set({ selection: { kind: "index", id: index.id } });
      return index.id;
    },
    updateIndex: (id, patch) => {
      commit((m) => {
        m.indexes = (m.indexes ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i));
      });
    },
    deleteIndex: (id) => {
      commit((m) => {
        m.indexes = (m.indexes ?? []).filter((i) => i.id !== id);
      });
      set((s) => (s.selection?.kind === "index" && s.selection.id === id ? { selection: null } : {}));
    },

    createSequence: () => {
      const taken = new Set((get().model.sequences ?? []).map((s) => s.name));
      const seq = newSequence(uniqueName("new_seq", taken));
      commit((m) => {
        m.sequences = [...(m.sequences ?? []), seq];
      });
      set({ selection: { kind: "sequence", id: seq.id } });
      return seq.id;
    },
    updateSequence: (id, patch) => {
      commit((m) => {
        m.sequences = (m.sequences ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s));
      });
    },
    deleteSequence: (id) => {
      commit((m) => {
        m.sequences = (m.sequences ?? []).filter((s) => s.id !== id);
      });
      set((s) =>
        s.selection?.kind === "sequence" && s.selection.id === id ? { selection: null } : {},
      );
    },

    createRawObject: (dialect) => {
      const taken = new Set((get().model.rawObjects ?? []).map((o) => o.name));
      const obj = newRawObject(uniqueName(`new_${dialect}_object`, taken), dialect);
      commit((m) => {
        m.rawObjects = [...(m.rawObjects ?? []), obj];
      });
      set({ selection: { kind: "rawObject", id: obj.id } });
      return obj.id;
    },
    updateRawObject: (id, patch) => {
      commit((m) => {
        m.rawObjects = (m.rawObjects ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o));
      });
    },
    deleteRawObject: (id) => {
      commit((m) => {
        m.rawObjects = (m.rawObjects ?? []).filter((o) => o.id !== id);
      });
      set((s) =>
        s.selection?.kind === "rawObject" && s.selection.id === id ? { selection: null } : {},
      );
    },

    openRelationshipDraft: (source, target) =>
      set({ relationshipDraft: { source, target } }),

    closeRelationshipDraft: () => set({ relationshipDraft: null }),

    openLinkDraft: (ref) => set({ linkDraft: ref }),
    closeLinkDraft: () => set({ linkDraft: null }),

    createRelationship: (params) => {
      const result = createRelationshipOp(get().model, params);
      set((s) => ({
        past: pushPast(s.past, s.model),
        model: { ...result.model, updatedAt: nowIso() },
        future: [],
        selection: { kind: "relationship", id: result.relationshipId },
      }));
      return result;
    },

    updateRelationship: (id, patch) => {
      commit((m) => {
        const rel = m.relationships.find((r) => r.id === id);
        if (!rel) return;
        Object.assign(rel, patch);
        if ("label" in patch && !patch.label) rel.label = undefined;
        if ("description" in patch && !patch.description) rel.description = undefined;
      });
    },

    deleteRelationship: (id) => {
      commit((m) => {
        m.relationships = m.relationships.filter((r) => r.id !== id);
      });
      set((s) =>
        s.selection?.kind === "relationship" && s.selection.id === id
          ? { selection: null }
          : {},
      );
    },

    applyNodePositions: (updates) => {
      set((s) => {
        const next = structuredClone(s.model);
        for (const u of updates) {
          const e = findEntity(next, u.id);
          if (e) {
            e.position = u.position;
            continue;
          }
          const v = next.views?.find((view) => view.id === u.id);
          if (v) v.position = u.position;
        }
        return { model: next };
      });
    },

    beginInteraction: () => set((s) => ({ _dragSnapshot: s.model })),

    endInteraction: () =>
      set((s) =>
        s._dragSnapshot && s._dragSnapshot !== s.model
          ? {
              past: pushPast(s.past, s._dragSnapshot),
              future: [],
              _dragSnapshot: null,
              model: { ...s.model, updatedAt: nowIso() },
            }
          : { _dragSnapshot: null },
      ),

    arrange: () => {
      commit((m) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(m.entities.length)));
        const gapX = 300;
        const gapY = 240;
        m.entities.forEach((e, i) => {
          e.position = {
            x: 80 + (i % cols) * gapX,
            y: 80 + Math.floor(i / cols) * gapY,
          };
        });
      });
    },

    // Star-schema layout: facts in the centre, dimensions (and others) in a ring.
    arrangeStar: () => {
      commit((m) => {
        const facts = m.entities.filter((e) => e.stereotype === "fact");
        const ring = m.entities.filter((e) => e.stereotype !== "fact");
        const cx = 560;
        const cy = 380;
        facts.forEach((f, i) => {
          f.position = { x: cx - 90, y: cy - 60 + i * 170 };
        });
        const R = 320;
        ring.forEach((d, i) => {
          const a = (2 * Math.PI * i) / Math.max(1, ring.length) - Math.PI / 2;
          d.position = {
            x: Math.round(cx + R * Math.cos(a) - 90),
            y: Math.round(cy + R * Math.sin(a) - 60),
          };
        });
      });
    },

    setCanvasMode: (mode) => set({ canvasMode: mode }),

    openProperties: () => set({ propertiesOpen: true }),
    closeProperties: () => set({ propertiesOpen: false }),

    select: (selection) => set({ selection }),

    revealEntity: (id) =>
      set((s) => ({
        selection: { kind: "entity", id },
        focus: { entityId: id, token: (s.focus?.token ?? 0) + 1 },
      })),

    revealRelationship: (id) => set({ selection: { kind: "relationship", id } }),

    search: (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return false;
      const match = get().model.entities.find((e) =>
        e.name.toLowerCase().includes(q),
      );
      if (!match) return false;
      set((s) => ({
        selection: { kind: "entity", id: match.id },
        focus: { entityId: match.id, token: (s.focus?.token ?? 0) + 1 },
      }));
      return true;
    },

    pushNotice: (message) =>
      set((s) => ({ notices: [...s.notices, { id: newId("field"), message }] })),

    dismissNotice: (id) =>
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return {};
        const previous = s.past[s.past.length - 1];
        return {
          past: s.past.slice(0, -1),
          model: previous,
          future: [s.model, ...s.future],
          selection: null,
        };
      }),

    redo: () =>
      set((s) => {
        if (s.future.length === 0) return {};
        const [nextModel, ...rest] = s.future;
        return {
          past: pushPast(s.past, s.model),
          model: nextModel,
          future: rest,
          selection: null,
        };
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    loadModel: (model) =>
      set({
        model,
        past: [],
        future: [],
        selection: null,
        notices: [],
        focus: null,
        relationshipDraft: null,
        linkDraft: null,
        canvasMode: "select",
        propertiesOpen: false,
      }),
  };
});
