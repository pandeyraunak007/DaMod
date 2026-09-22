import { useEffect, useRef, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import type { Model } from "../model/model";
import type { ModelLevel } from "../model/levels";

const LEVEL_BADGE: Record<ModelLevel, string> = {
  Conceptual: "C",
  Logical: "L",
  "Physical/Logical": "P/L",
  Physical: "P",
};

// The dockable workspace tree (FR-12): Workspace → Models → Entities /
// Relationships / Fields, plus a Semantic node. Clicking navigates and centres;
// a filter hides non-matching nodes across every model.
export function ModelExplorer() {
  const path = useWorkspaceStore((s) => s.path);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const activeModel = useModelStore((s) => s.model);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  // Expansion state, persisted per workspace (FR-12.3).
  const storageKey = path ? `damod.explorer.${path}` : "damod.explorer.none";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const loadedKey = useRef<string>("");
  useEffect(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    try {
      const raw = localStorage.getItem(storageKey);
      setExpanded(new Set(raw ? (JSON.parse(raw) as string[]) : ["ws"]));
    } catch {
      setExpanded(new Set(["ws"]));
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded, storageKey]);

  const models: { tabId: string; model: Model | null; fileName: string; error: string | null }[] =
    tabs.map((t) => ({
      tabId: t.id,
      model: t.id === activeId ? activeModel : t.model,
      fileName: t.fileName,
      error: t.loadError,
    }));

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;

  const isOpen = (key: string) => filtering || expanded.has(key);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const expandAll = () => {
    const keys = new Set<string>(["ws"]);
    for (const m of models) {
      if (!m.model) continue;
      keys.add(`m:${m.tabId}`);
      keys.add(`m:${m.tabId}:ents`);
      keys.add(`m:${m.tabId}:rels`);
      keys.add(`m:${m.tabId}:sem`);
      for (const e of m.model.entities) keys.add(`e:${m.tabId}:${e.id}`);
    }
    setExpanded(keys);
  };
  const collapseAll = () => setExpanded(new Set());

  const revealEntity = async (tabId: string, entityId: string) => {
    if (tabId !== activeId) await switchTab(tabId);
    useModelStore.getState().revealEntity(entityId);
  };
  const revealRelationship = async (tabId: string, relId: string) => {
    if (tabId !== activeId) await switchTab(tabId);
    useModelStore.getState().revealRelationship(relId);
  };

  if (collapsed) {
    return (
      <div className="explorer explorer--collapsed">
        <button className="explorer__toggle" title="Show explorer" onClick={() => setCollapsed(false)}>
          ›
        </button>
      </div>
    );
  }

  return (
    <aside className="explorer">
      <div className="explorer__head">
        <span className="explorer__title">Explorer</span>
        <div className="explorer__head-actions">
          <button className="icon-btn" title="Expand all" onClick={expandAll}>
            ⊞
          </button>
          <button className="icon-btn" title="Collapse all" onClick={collapseAll}>
            ⊟
          </button>
          <button className="icon-btn" title="Hide explorer" onClick={() => setCollapsed(true)}>
            ‹
          </button>
        </div>
      </div>
      <input
        className="explorer__filter"
        placeholder="Filter…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="explorer__tree">
        <TreeRow
          depth={0}
          open={isOpen("ws")}
          hasChildren
          label={<span className="tree__ws">Workspace</span>}
          onToggle={() => toggle("ws")}
        />
        {isOpen("ws") &&
          models.map((m) =>
            m.error || !m.model ? (
              <TreeRow
                key={m.tabId}
                depth={1}
                label={<span className="tree__error" title={m.error ?? ""}>⚠ {m.fileName}</span>}
                onClick={() => switchTab(m.tabId)}
              />
            ) : (
              <ModelBranch
                key={m.tabId}
                tabId={m.tabId}
                model={m.model}
                active={m.tabId === activeId}
                q={q}
                filtering={filtering}
                isOpen={isOpen}
                toggle={toggle}
                onRevealEntity={revealEntity}
                onRevealRelationship={revealRelationship}
                onSwitch={switchTab}
              />
            ),
          )}
      </div>
    </aside>
  );
}

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q);
}

function ModelBranch({
  tabId,
  model,
  active,
  q,
  filtering,
  isOpen,
  toggle,
  onRevealEntity,
  onRevealRelationship,
  onSwitch,
}: {
  tabId: string;
  model: Model;
  active: boolean;
  q: string;
  filtering: boolean;
  isOpen: (k: string) => boolean;
  toggle: (k: string) => void;
  onRevealEntity: (tabId: string, entityId: string) => void;
  onRevealRelationship: (tabId: string, relId: string) => void;
  onSwitch: (tabId: string) => void;
}) {
  const entityName = (id: string) => model.entities.find((e) => e.id === id)?.name ?? "?";

  const entityMatches = (e: Model["entities"][number]) =>
    !filtering || matches(e.name, q) || e.fields.some((f) => matches(f.name, q));
  const relText = (r: Model["relationships"][number]) =>
    `${entityName(r.parentEntity)} → ${entityName(r.childEntity)} (${r.cardinality})`;
  const relMatches = (r: Model["relationships"][number]) => !filtering || matches(relText(r), q);

  const anyEntity = model.entities.some(entityMatches);
  const anyRel = model.relationships.some(relMatches);
  if (filtering && !matches(model.name, q) && !anyEntity && !anyRel) return null;

  return (
    <>
      <TreeRow
        depth={1}
        open={isOpen(`m:${tabId}`)}
        hasChildren
        active={active}
        label={
          <>
            <span className="tree__badge">{LEVEL_BADGE[model.level]}</span>
            <span className="tree__model">{model.name}</span>
          </>
        }
        onToggle={() => toggle(`m:${tabId}`)}
        onClick={() => onSwitch(tabId)}
      />
      {isOpen(`m:${tabId}`) && (
        <>
          {/* Entities */}
          <TreeRow
            depth={2}
            open={isOpen(`m:${tabId}:ents`)}
            hasChildren
            label={<span className="tree__group">Entities ({model.entities.length})</span>}
            onToggle={() => toggle(`m:${tabId}:ents`)}
          />
          {isOpen(`m:${tabId}:ents`) &&
            model.entities.filter(entityMatches).map((e) => (
              <EntityBranch
                key={e.id}
                tabId={tabId}
                model={model}
                entity={e}
                q={q}
                filtering={filtering}
                open={isOpen(`e:${tabId}:${e.id}`)}
                onToggle={() => toggle(`e:${tabId}:${e.id}`)}
                onReveal={() => onRevealEntity(tabId, e.id)}
              />
            ))}

          {/* Relationships */}
          <TreeRow
            depth={2}
            open={isOpen(`m:${tabId}:rels`)}
            hasChildren
            label={<span className="tree__group">Relationships ({model.relationships.length})</span>}
            onToggle={() => toggle(`m:${tabId}:rels`)}
          />
          {isOpen(`m:${tabId}:rels`) &&
            model.relationships.filter(relMatches).map((r) => (
              <TreeRow
                key={r.id}
                depth={3}
                label={<span className="tree__rel">{relText(r)}</span>}
                onClick={() => onRevealRelationship(tabId, r.id)}
              />
            ))}

          {/* Semantic (populated in Phase 4) */}
          <TreeRow
            depth={2}
            open={isOpen(`m:${tabId}:sem`)}
            hasChildren
            label={<span className="tree__group">Semantic layer</span>}
            onToggle={() => toggle(`m:${tabId}:sem`)}
          />
          {isOpen(`m:${tabId}:sem`) && (
            <>
              <TreeRow depth={3} label={<span className="tree__muted">Terms (0)</span>} />
              <TreeRow depth={3} label={<span className="tree__muted">Dimensions (0)</span>} />
              <TreeRow depth={3} label={<span className="tree__muted">Metrics (0)</span>} />
            </>
          )}
        </>
      )}
    </>
  );
}

function EntityBranch({
  model,
  entity,
  q,
  filtering,
  open,
  onToggle,
  onReveal,
}: {
  tabId: string;
  model: Model;
  entity: Model["entities"][number];
  q: string;
  filtering: boolean;
  open: boolean;
  onToggle: () => void;
  onReveal: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entity.name);
  const renameEntity = useModelStore((s) => s.renameEntity);

  const fields = entity.fields.filter((f) => !filtering || matches(f.name, q) || matches(entity.name, q));

  return (
    <>
      <TreeRow
        depth={3}
        open={open}
        hasChildren={entity.fields.length > 0}
        onToggle={onToggle}
        onClick={onReveal}
        label={
          renaming ? (
            <input
              autoFocus
              className="tree__rename"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                renameEntity(entity.id, draft);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameEntity(entity.id, draft);
                  setRenaming(false);
                }
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <span
              className="tree__entity"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setDraft(entity.name);
                setRenaming(true);
              }}
            >
              {entity.name}
            </span>
          )
        }
      />
      {open &&
        fields.map((f) => (
          <TreeRow
            key={f.id}
            depth={4}
            onClick={onReveal}
            label={
              <span className="tree__field">
                <span className="tree__field-key">{f.primaryKey ? "🔑" : f.unique ? "◈" : "•"}</span>
                {f.name}
                <span className="tree__field-type">{fieldTypeLabel(f, model.level)}</span>
              </span>
            }
          />
        ))}
    </>
  );
}

function TreeRow({
  depth,
  label,
  open,
  hasChildren,
  active,
  onToggle,
  onClick,
}: {
  depth: number;
  label: React.ReactNode;
  open?: boolean;
  hasChildren?: boolean;
  active?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={`tree-row ${active ? "tree-row--active" : ""}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={onClick}
    >
      {hasChildren ? (
        <button
          className="tree-row__caret"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
        >
          {open ? "▾" : "▸"}
        </button>
      ) : (
        <span className="tree-row__caret tree-row__caret--empty" />
      )}
      <span className="tree-row__label">{label}</span>
    </div>
  );
}
