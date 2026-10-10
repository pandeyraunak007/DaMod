import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import type { Model } from "../model/model";
import { ebsGroups, type EbsGrouping } from "./ebsTree";

// Read-only EBS-aware view of the ACTIVE model (Req 21 §4). Regroups the discovered
// tables by application product or database schema, with counts, search, expand/
// collapse and click-to-reveal. It never mutates the model — creation/editing stays
// in the standard Explorer + Inspector. Scoped to the active model (its caller only
// renders it for the active tab), so it inherits the Req 18 isolation.
export function EbsExplorer({ model }: { model: Model }) {
  const [grouping, setGrouping] = useState<EbsGrouping>("product");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const reveal = (id: string) => useModelStore.getState().revealEntity(id);

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
        <div className="ebsx__seg" role="tablist" aria-label="EBS grouping">
          <button
            role="tab"
            aria-selected={grouping === "product"}
            className={`ebsx__seg-btn ${grouping === "product" ? "ebsx__seg-btn--active" : ""}`}
            onClick={() => setGrouping("product")}
          >
            Products
          </button>
          <button
            role="tab"
            aria-selected={grouping === "schema"}
            className={`ebsx__seg-btn ${grouping === "schema" ? "ebsx__seg-btn--active" : ""}`}
            onClick={() => setGrouping("schema")}
          >
            Schemas
          </button>
        </div>
      </div>
      <input
        className="explorer__filter"
        placeholder="Filter EBS objects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="explorer__tree">
        {groups.length === 0 ? (
          <p className="explorer__empty">No EBS objects match.</p>
        ) : (
          groups.map((g) => {
            const gkey = `g:${grouping}:${g.key}`;
            return (
              <div key={gkey}>
                <div className="tree-row" style={{ paddingLeft: 4 }}>
                  <button className="tree-row__caret" onClick={() => toggle(gkey)}>
                    {isOpen(gkey) ? "▾" : "▸"}
                  </button>
                  <span className="tree-row__label">
                    <span className="tree__group">
                      {grouping === "product" ? `Product ${g.label}` : g.label}{" "}
                      <span className="tree__count">{g.entities.length}</span>
                    </span>
                  </span>
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
