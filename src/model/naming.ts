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
}

export function newNamingStandard(name: string): NamingStandard {
  return { id: newId("namingStandard"), name, rules: [] };
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
