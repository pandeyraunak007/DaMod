import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import type { Model } from "../model/model";
import { ebsGroups, type EbsGrouping } from "./ebsTree";

// Read-only application-aware view of the ACTIVE model (Req 21 §4 / Req 22 §4).
// Regroups the discovered tables by their application grouping (EBS product /
// database schema, or Fusion family / module) using the discovery provenance, with
// counts, search, expand/collapse and click-to-reveal. Never mutates the model —
// creation/editing stays in the standard Explorer + Inspector. Scoped to the active
// model (its caller only renders it for the active tab), so it inherits Req 18.

export interface AppExplorerLabels {
  /** Short source noun, e.g. "EBS" / "Fusion" (filter + empty text). */
  noun: string;
  /** Primary grouping (source.product): plural toggle label + per-row prefix. */
  primaryPlural: string; // "Products" / "Families"
  primaryPrefix: string; // "Product"  / "Family"
  /** Secondary grouping (source.schema): plural toggle label. */
  secondaryPlural: string; // "Schemas" / "Modules"
}

const EBS_LABELS: AppExplorerLabels = { noun: "EBS", primaryPlural: "Products", primaryPrefix: "Product", secondaryPlural: "Schemas" };
const FUSION_LABELS: AppExplorerLabels = { noun: "Fusion", primaryPlural: "Families", primaryPrefix: "Family", secondaryPlural: "Modules" };

export function AppExplorer({ model, labels }: { model: Model; labels: AppExplorerLabels }) {
  const [grouping, setGrouping] = useState<EbsGrouping>("product");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const reveal = (id: string) => useModelStore.getState().revealEntity(id);
  const makeArea = (product: string) => useModelStore.getState().createSubjectAreaFromProduct(product);
  const openDiagram = (id: string) => useModelStore.getState().setActiveDiagram(id);
  const deleteArea = (id: string) => useModelStore.getState().deleteSubjectArea(id);
  const areas = model.subjectAreas ?? [];

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const isOpen = (k: string) => filtering || open.has(k);
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const matches = (e: Model["entities"][number]) =>
    !filtering ||
    e.name.toLowerCase().includes(q) ||
    (e.logicalName?.toLowerCase().includes(q) ?? false) ||
    e.fields.some((f) => f.name.toLowerCase().includes(q));

  const groups = ebsGroups(model, grouping)
    .map((g) => ({ ...g, entities: g.entities.filter(matches) }))
    .filter((g) => g.entities.length > 0);

  return (
    <div className="ebsx">
      <div className="ebsx__controls">
        <div className="ebsx__seg" role="tablist" aria-label={`${labels.noun} grouping`}>
          <button
            role="tab"
            aria-selected={grouping === "product"}
            className={`ebsx__seg-btn ${grouping === "product" ? "ebsx__seg-btn--active" : ""}`}
            onClick={() => setGrouping("product")}
          >
            {labels.primaryPlural}
          </button>
          <button
            role="tab"
            aria-selected={grouping === "schema"}
            className={`ebsx__seg-btn ${grouping === "schema" ? "ebsx__seg-btn--active" : ""}`}
            onClick={() => setGrouping("schema")}
          >
            {labels.secondaryPlural}
          </button>
        </div>
      </div>
      <input
        className="explorer__filter"
        placeholder={`Filter ${labels.noun} objects…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="explorer__tree">
        {/* Subject areas (Req 21 §6) — named groupings; click opens their diagram. */}
        {areas.length > 0 && (
          <>
            <div className="tree-row" style={{ paddingLeft: 4 }}>
              <span className="tree-row__caret tree-row__caret--empty" />
              <span className="tree-row__label"><span className="tree__group">Subject areas <span className="tree__count">{areas.length}</span></span></span>
            </div>
            {areas.map((a) => (
              <div key={a.id} className="tree-row" style={{ paddingLeft: 4 + 14 }}>
                <span className="tree-row__caret tree-row__caret--empty" />
                <span
                  className="tree-row__label tree__entity"
                  title={a.description ?? `${a.entities.length} tables — open diagram`}
                  onClick={() => openDiagram(a.id)}
                >
                  {a.name} <span className="tree__count">{a.entities.length}</span>
                </span>
                <span className="tree-row__actions">
                  <button className="tree-row__add" title="Delete subject area" onClick={() => deleteArea(a.id)}>✕</button>
                </span>
              </div>
            ))}
          </>
        )}
        {groups.length === 0 ? (
          <p className="explorer__empty">No {labels.noun} objects match.</p>
        ) : (
          groups.map((g) => {
            const gkey = `g:${grouping}:${g.key}`;
            const isPrimaryGroup = grouping === "product" && g.key !== "ÿ";
            return (
              <div key={gkey}>
                <div className="tree-row" style={{ paddingLeft: 4 }}>
                  <button className="tree-row__caret" onClick={() => toggle(gkey)}>
                    {isOpen(gkey) ? "▾" : "▸"}
                  </button>
                  <span className="tree-row__label">
                    <span className="tree__group">
                      {grouping === "product" ? `${labels.primaryPrefix} ${g.label}` : g.label}{" "}
                      <span className="tree__count">{g.entities.length}</span>
                    </span>
                  </span>
                  {isPrimaryGroup && (
                    <span className="tree-row__actions">
                      <button className="tree-row__add" title={`Create subject area for ${g.label}`} onClick={() => makeArea(g.key)}>
                        + area
                      </button>
                    </span>
                  )}
                </div>
                {isOpen(gkey) &&
                  g.entities.map((e) => {
                    const ekey = `e:${gkey}:${e.id}`;
                    return (
                      <div key={e.id}>
                        <div className="tree-row" style={{ paddingLeft: 4 + 14 }}>
                          <button className="tree-row__caret" onClick={() => toggle(ekey)}>
                            {isOpen(ekey) ? "▾" : "▸"}
                          </button>
                          <span
                            className="tree-row__label tree__entity"
                            title={e.description ?? e.source?.nativeId ?? e.name}
                            onClick={() => reveal(e.id)}
                          >
                            {e.name}
                            {grouping === "product" && e.source?.schema && (
                              <span className="tree__count"> {e.source.schema}</span>
                            )}
                          </span>
                        </div>
                        {isOpen(ekey) &&
                          e.fields.map((f) => (
                            <div key={f.id} className="tree-row" style={{ paddingLeft: 4 + 28 }} onClick={() => reveal(e.id)}>
                              <span className="tree-row__caret tree-row__caret--empty" />
                              <span className="tree-row__label tree__field">
                                <span className="tree__field-name">{f.name}</span>
                                <span className="tree__field-type">{fieldTypeLabel(f, model.level)}</span>
                              </span>
                            </div>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function EbsExplorer({ model }: { model: Model }) {
  return <AppExplorer model={model} labels={EBS_LABELS} />;
}

export function FusionExplorer({ model }: { model: Model }) {
  return <AppExplorer model={model} labels={FUSION_LABELS} />;
}
