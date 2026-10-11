// Naming Standards (Phase 2) — reusable, configurable identifier conventions that
// can be checked against a model and (later) applied through store ops. This module
// is PURE: the transform engine and the compliance checker never mutate a model.
// Slice A delivers the object + engine + read-only compliance; preview/apply with
// FK-reference propagation and the manager UI follow in later slices.

import { newId } from "../lib/ids";
import type { Model } from "./model";

// Casings we can normalise an identifier to. "preserve" leaves the existing casing
// untouched (only prefix/suffix/length rules then apply).
export const NAME_CASES = ["snake_case", "screaming_snake", "pascal", "camel", "preserve"] as const;
export type NameCase = (typeof NAME_CASES)[number];

// Object kinds a rule can target. Slice A checks entities, attributes and indexes
// (the named objects that exist on every physical model); more targets are additive.
export const NAMING_TARGETS = ["entity", "attribute", "index"] as const;
export type NamingTarget = (typeof NAMING_TARGETS)[number];

export interface NamingRule {
  target: NamingTarget;
  case: NameCase;
  prefix?: string;
  suffix?: string;
  /** Hard identifier length limit; over-length names are flagged (never silently
   *  truncated). Omit for no limit. */
  maxLength?: number;
}

export interface NamingStandard {
  id: string;
  name: string;
  description?: string;
  rules: NamingRule[];
  /** When not false, applying the standard keeps a foreign-key column's name in sync
   *  with the (renamed) parent PK column it derives from. Default on; set false to let
   *  the attribute rule rename FK columns independently. */
  mirrorForeignKeys?: boolean;
}

export function newNamingStandard(name: string): NamingStandard {
  return { id: newId("namingStandard"), name, rules: [] };
}

/** Whether FK-mirroring is active for a standard (default on). */
export function mirrorsForeignKeys(standard: NamingStandard): boolean {
  return standard.mirrorForeignKeys !== false;
}

// ---- transform engine (pure) ------------------------------------------------

/** Split an identifier into lowercase words, understanding snake/kebab/space
 *  separators and camelCase / PascalCase / ACRONYM boundaries. */
export function toWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // fooBar -> foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // APIKey -> API Key
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function cap(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

function recase(words: string[], c: NameCase): string {
  switch (c) {
    case "snake_case":
      return words.join("_");
    case "screaming_snake":
      return words.map((w) => w.toUpperCase()).join("_");
    case "pascal":
      return words.map(cap).join("");
    case "camel":
      return words.map((w, i) => (i === 0 ? w : cap(w))).join("");
    case "preserve":
      return words.join("_"); // not used directly; see applyNamingRule
  }
}

/** The name this rule would produce for `name`. Prefix/suffix are idempotent (added
 *  only when absent) so re-running an applied standard is a no-op. */
export function applyNamingRule(name: string, rule: NamingRule): string {
  let out = rule.case === "preserve" ? name : recase(toWords(name), rule.case);
  if (rule.prefix && !out.startsWith(rule.prefix)) out = rule.prefix + out;
  if (rule.suffix && !out.endsWith(rule.suffix)) out = out + rule.suffix;
  return out;
}

// ---- compliance check (pure, no mutation) -----------------------------------

export interface NamingViolation {
  standardId: string;
  target: NamingTarget;
  entityId?: string;
  fieldId?: string;
  indexId?: string;
  current: string;
  proposed: string;
  /** Which aspects differ: any of "case", "prefix", "suffix", "length". */
  reasons: string[];
}

function reasonsFor(current: string, rule: NamingRule): { proposed: string; reasons: string[] } {
  const proposed = applyNamingRule(current, rule);
  const reasons: string[] = [];
  if (proposed !== current) {
    const prefixAdded = !!rule.prefix && !current.startsWith(rule.prefix);
    const suffixAdded = !!rule.suffix && !current.endsWith(rule.suffix);
    if (prefixAdded) reasons.push("prefix");
    if (suffixAdded) reasons.push("suffix");
    // Whatever remains after accounting for added affixes is a casing change.
    let withAffixes = current;
    if (prefixAdded) withAffixes = rule.prefix + withAffixes;
    if (suffixAdded) withAffixes = withAffixes + rule.suffix;
    if (withAffixes !== proposed) reasons.push("case");
  }
  if (rule.maxLength != null && current.length > rule.maxLength) reasons.push("length");
  return { proposed, reasons };
}

// ---- preview + plan (pure, no mutation) -------------------------------------

export interface NamingChange {
  target: NamingTarget;
  entityId?: string;
  fieldId?: string;
  indexId?: string;
  from: string;
  to: string;
  reasons: string[];
  /** This FK column's new name was taken from its parent PK (mirror), not the rule. */
  mirrored?: boolean;
}

export interface NamingCollision {
  /** Human scope label, e.g. "entity names" or "columns of Order". */
  scope: string;
  name: string;
  /** Display names of the objects that would share `name`. */
  members: string[];
}

export interface NamingPreview {
  changes: NamingChange[];
  collisions: NamingCollision[];
  /** Object ids whose rename is unsafe (would duplicate a name in its scope). The
   *  apply step skips these. */
  collidingIds: string[];
}

function ruleFor(standard: NamingStandard, target: NamingTarget): NamingRule | undefined {
  return standard.rules.find((r) => r.target === target);
}

function proposed(name: string, rule: NamingRule | undefined): string {
  return rule ? applyNamingRule(name, rule) : name;
}

/** Compute the final name every entity/field/index would have under `standard`
 *  (rule + optional FK mirroring), the resulting changes, and any name collisions.
 *  Pure — does not touch the model. Collisions are reported so the caller can skip
 *  the offending renames rather than create duplicates. */
export function previewNaming(model: Model, standard: NamingStandard): NamingPreview {
  const entityRule = ruleFor(standard, "entity");
  const attrRule = ruleFor(standard, "attribute");
  const indexRule = ruleFor(standard, "index");

  // Final name per object id (start from rule-only proposals).
  const fieldFinal = new Map<string, string>();
  const entityFinal = new Map<string, string>();
  const indexFinal = new Map<string, string>();
  for (const e of model.entities) {
    entityFinal.set(e.id, proposed(e.name, entityRule));
    for (const f of e.fields) fieldFinal.set(f.id, proposed(f.name, attrRule));
  }
  for (const i of model.indexes ?? []) indexFinal.set(i.id, proposed(i.name, indexRule));

  // FK mirroring: a child FK column adopts its parent PK column's final name.
  const mirrored = new Set<string>();
  if (mirrorsForeignKeys(standard)) {
    for (const rel of model.relationships) {
      const parent = model.entities.find((e) => e.id === rel.parentEntity);
      if (!parent) continue;
      const pks = parent.fields.filter((f) => f.primaryKey);
      const fks = rel.foreignKeyFields ?? [];
      for (let i = 0; i < Math.min(pks.length, fks.length); i++) {
        const pkFinal = fieldFinal.get(pks[i].id);
        if (pkFinal != null && fieldFinal.has(fks[i])) {
          if (fieldFinal.get(fks[i]) !== pkFinal) mirrored.add(fks[i]);
          fieldFinal.set(fks[i], pkFinal);
        }
      }
    }
  }

  const changes: NamingChange[] = [];
  const nameById = new Map<string, string>();
  for (const e of model.entities) {
    nameById.set(e.id, e.name);
    for (const f of e.fields) nameById.set(f.id, f.name);
  }
  for (const i of model.indexes ?? []) nameById.set(i.id, i.name);

  for (const e of model.entities) {
    const to = entityFinal.get(e.id)!;
    if (to !== e.name) {
      changes.push({ target: "entity", entityId: e.id, from: e.name, to, reasons: reasonsFor(e.name, entityRule!).reasons });
    }
    for (const f of e.fields) {
      const to2 = fieldFinal.get(f.id)!;
      if (to2 !== f.name) {
        const isMirror = mirrored.has(f.id);
        changes.push({
          target: "attribute",
          entityId: e.id,
          fieldId: f.id,
          from: f.name,
          to: to2,
          reasons: isMirror ? ["mirror"] : attrRule ? reasonsFor(f.name, attrRule).reasons : [],
          mirrored: isMirror || undefined,
        });
      }
    }
  }
  for (const i of model.indexes ?? []) {
    const to = indexFinal.get(i.id)!;
    if (to !== i.name) changes.push({ target: "index", indexId: i.id, from: i.name, to, reasons: reasonsFor(i.name, indexRule!).reasons });
  }

  // Collisions: duplicate final names within a scope (entity names, each entity's
  // columns, index names). Counts both renamed and unchanged members; every object
  // in a clashing group is marked colliding so apply skips it (never create a dup).
  const collisions: NamingCollision[] = [];
  const colliding = new Set<string>();
  const collect = (scope: string, pairs: { id: string; final: string; label: string }[]) => {
    const byName = new Map<string, { id: string; label: string }[]>();
    for (const p of pairs) {
      const arr = byName.get(p.final) ?? [];
      arr.push({ id: p.id, label: p.label });
      byName.set(p.final, arr);
    }
    for (const [name, members] of byName) {
      if (members.length > 1) {
        collisions.push({ scope, name, members: members.map((m) => m.label) });
        for (const m of members) colliding.add(m.id);
      }
    }
  };
  collect(
    "entity names",
    model.entities.map((e) => ({ id: e.id, final: entityFinal.get(e.id)!, label: e.name })),
  );
  for (const e of model.entities) {
    collect(
      `columns of ${e.name}`,
      e.fields.map((f) => ({ id: f.id, final: fieldFinal.get(f.id)!, label: f.name })),
    );
  }
  collect(
    "index names",
    (model.indexes ?? []).map((i) => ({ id: i.id, final: indexFinal.get(i.id)!, label: i.name })),
  );

  return { changes, collisions, collidingIds: [...colliding] };
}

/** Every violation of `standard` in `model`. Read-only — never mutates the model. */
export function checkNaming(model: Model, standard: NamingStandard): NamingViolation[] {
  const out: NamingViolation[] = [];
  for (const rule of standard.rules) {
    if (rule.target === "entity") {
      for (const e of model.entities) {
        const { proposed, reasons } = reasonsFor(e.name, rule);
        if (reasons.length) out.push({ standardId: standard.id, target: "entity", entityId: e.id, current: e.name, proposed, reasons });
      }
    } else if (rule.target === "attribute") {
      for (const e of model.entities) {
        for (const f of e.fields) {
          const { proposed, reasons } = reasonsFor(f.name, rule);
          if (reasons.length) out.push({ standardId: standard.id, target: "attribute", entityId: e.id, fieldId: f.id, current: f.name, proposed, reasons });
        }
      }
    } else if (rule.target === "index") {
      for (const i of model.indexes ?? []) {
        const { proposed, reasons } = reasonsFor(i.name, rule);
        if (reasons.length) out.push({ standardId: standard.id, target: "index", indexId: i.id, current: i.name, proposed, reasons });
      }
    }
  }
  return out;
}
