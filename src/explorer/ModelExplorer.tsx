import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import type { Model } from "../model/model";
import type { ModelLevel } from "../model/levels";
import { linksTouching } from "../links/links";
import { validateWorkspace, type Severity } from "../validation/rules";

export interface ExplorerMarks {
  modelSeverity: (modelId: string) => Severity | null;
  entitySeverity: (modelId: string, entityId: string) => Severity | null;
  entityHasLink: (modelId: string, entityId: string) => boolean;
}

function sevDot(sev: Severity | null): ReactNode {
  if (!sev) return null;
  return <span className={`tree__sev tree__sev--${sev}`}>{sev === "error" ? "●" : "▲"}</span>;
}

const LEVEL_BADGE: Record<ModelLevel, string> = {
  Conceptual: "C",
  Logical: "L",
  "Physical/Logical": "P/L",
  Physical: "P",
};

interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}
type OpenMenu = (x: number, y: number, items: MenuItem[]) => void;

interface ExplorerProps {
  onNewModel: () => void;
  onDeleteModel: (id: string, name: string) => void;
}

// The dockable workspace tree (FR-12): Workspace → Models → Entities /
// Relationships / Fields, plus a Semantic node. Nodes navigate (click), rename
// (double-click) and can create/delete metaobjects via + buttons and a
// right-click menu (FR-12.6).
export function ModelExplorer({ onNewModel, onDeleteModel }: ExplorerProps) {
  const path = useWorkspaceStore((s) => s.path);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const duplicateModel = useWorkspaceStore((s) => s.duplicateModel);
  const links = useWorkspaceStore((s) => s.links);
  const activeModel = useModelStore((s) => s.model);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenu: OpenMenu = (x, y, items) => setMenu({ x, y, items });

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

  const marks: ExplorerMarks = useMemo(() => {
    const named = models
      .filter((m) => m.model && !m.error)
      .map((m) => ({ id: m.model!.id, name: m.model!.name, model: m.model! }));
    const issues = validateWorkspace({
      models: named,
      links: links.links,
      conceptGroups: links.conceptGroups,
    });
    const errM = new Set<string>();
    const warnM = new Set<string>();
    const errE = new Set<string>();
    const warnE = new Set<string>();
    for (const i of issues) {
      if (i.target.model) (i.severity === "error" ? errM : warnM).add(i.target.model);
      if (i.target.model && i.target.entity) {
        (i.severity === "error" ? errE : warnE).add(`${i.target.model}:${i.target.entity}`);
      }
    }
    return {
      modelSeverity: (m) => (errM.has(m) ? "error" : warnM.has(m) ? "warning" : null),
      entitySeverity: (m, e) =>
        errE.has(`${m}:${e}`) ? "error" : warnE.has(`${m}:${e}`) ? "warning" : null,
      entityHasLink: (m, e) => linksTouching(links.links, { model: m, entity: e }).length > 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId, activeModel, links]);

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const isOpen = (key: string) => filtering || expanded.has(key);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const expand = (key: string) => setExpanded((prev) => new Set(prev).add(key));

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

  // --- actions (switch to the node's model tab first) ---
  const ensureActive = async (tabId: string) => {
    if (tabId !== activeId) await switchTab(tabId);
  };
  const addEntity = async (tabId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().createEntity();
    expand(`m:${tabId}`);
    expand(`m:${tabId}:ents`);
  };
  const addField = async (tabId: string, entityId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().addField(entityId);
    useModelStore.getState().revealEntity(entityId);
    expand(`e:${tabId}:${entityId}`);
  };
  const addRelationship = async (tabId: string) => {
    await ensureActive(tabId);
    const model = useModelStore.getState().model;
    if (model.entities.length < 2) {
      useModelStore.getState().pushNotice("Add at least two entities before a relationship.");
      return;
    }
    useModelStore.getState().openRelationshipDraft(model.entities[0].id, model.entities[1].id);
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
    <aside className="explorer" onClick={() => menu && setMenu(null)}>
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
          actions={
            <RowAction title="New model" onClick={onNewModel}>
              +
            </RowAction>
          }
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
                openMenu={openMenu}
                marks={marks}
                onSwitch={switchTab}
                onAddEntity={() => addEntity(m.tabId)}
                onAddField={(eid) => addField(m.tabId, eid)}
                onAddRelationship={() => addRelationship(m.tabId)}
                onDuplicateModel={() => duplicateModel(m.tabId)}
                onDeleteModel={() => onDeleteModel(m.tabId, m.model!.name)}
              />
            ),
          )}
      </div>

      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.items.map((it, i) => (
            <button
              key={i}
              className={`ctx__item ${it.danger ? "ctx__item--danger" : ""}`}
              onClick={() => {
                setMenu(null);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
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
  openMenu,
  marks,
  onSwitch,
  onAddEntity,
  onAddField,
  onAddRelationship,
  onDuplicateModel,
  onDeleteModel,
}: {
  tabId: string;
  model: Model;
  active: boolean;
  q: string;
  filtering: boolean;
  isOpen: (k: string) => boolean;
  toggle: (k: string) => void;
  openMenu: OpenMenu;
  marks: ExplorerMarks;
  onSwitch: (tabId: string) => void;
  onAddEntity: () => void;
  onAddField: (entityId: string) => void;
  onAddRelationship: () => void;
  onDuplicateModel: () => void;
  onDeleteModel: () => void;
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

  const modelMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: "Add entity", onClick: onAddEntity },
      { label: "Duplicate model", onClick: onDuplicateModel },
      { label: "Delete model", danger: true, onClick: onDeleteModel },
    ]);
  };

  return (
    <>
      <TreeRow
        depth={1}
        open={isOpen(`m:${tabId}`)}
        hasChildren
        active={active}
        onContextMenu={modelMenu}
        label={
          <>
            <span className="tree__badge">{LEVEL_BADGE[model.level]}</span>
            <span className="tree__model">{model.name}</span>
            {sevDot(marks.modelSeverity(tabId))}
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
            actions={
              <RowAction title="Add entity" onClick={onAddEntity}>
                +
              </RowAction>
            }
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
                openMenu={openMenu}
                marks={marks}
                onAddField={() => onAddField(e.id)}
                onAddRelationship={onAddRelationship}
              />
            ))}

          {/* Relationships */}
          <TreeRow
            depth={2}
            open={isOpen(`m:${tabId}:rels`)}
            hasChildren
            label={<span className="tree__group">Relationships ({model.relationships.length})</span>}
            onToggle={() => toggle(`m:${tabId}:rels`)}
            actions={
              <RowAction title="Add relationship" onClick={onAddRelationship}>
                +
              </RowAction>
            }
          />
          {isOpen(`m:${tabId}:rels`) &&
            model.relationships.filter(relMatches).map((r) => (
              <RelationshipRow key={r.id} tabId={tabId} relId={r.id} text={relText(r)} openMenu={openMenu} />
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
  tabId,
  model,
  entity,
  q,
  filtering,
  open,
  onToggle,
  openMenu,
  marks,
  onAddField,
  onAddRelationship,
}: {
  tabId: string;
  model: Model;
  entity: Model["entities"][number];
  q: string;
  filtering: boolean;
  open: boolean;
  onToggle: () => void;
  openMenu: OpenMenu;
  marks: ExplorerMarks;
  onAddField: () => void;
  onAddRelationship: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entity.name);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const activeId = useWorkspaceStore((s) => s.activeId);

  const reveal = async () => {
    if (tabId !== activeId) await switchTab(tabId);
    useModelStore.getState().revealEntity(entity.id);
  };
  const commitRename = () => {
    useModelStore.getState().renameEntity(entity.id, draft);
    setRenaming(false);
  };
  const deleteEntity = async () => {
    if (tabId !== activeId) await switchTab(tabId);
    useModelStore.getState().deleteEntity(entity.id);
  };

  const fields = entity.fields.filter((f) => !filtering || matches(f.name, q) || matches(entity.name, q));

  const entityMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: "Add field", onClick: onAddField },
      { label: "Add relationship", onClick: onAddRelationship },
      { label: "Rename", onClick: () => (setDraft(entity.name), setRenaming(true)) },
      { label: "Delete entity", danger: true, onClick: deleteEntity },
    ]);
  };

  return (
    <>
      <TreeRow
        depth={3}
        open={open}
        hasChildren={entity.fields.length > 0}
        onToggle={onToggle}
        onClick={reveal}
        onContextMenu={entityMenu}
        actions={
          <RowAction title="Add field" onClick={onAddField}>
            +
          </RowAction>
        }
        label={
          renaming ? (
            <input
              autoFocus
              className="tree__rename"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
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
              {marks.entityHasLink(tabId, entity.id) && <span className="tree__link"> 🔗</span>}
              {sevDot(marks.entitySeverity(tabId, entity.id))}
            </span>
          )
        }
      />
      {open &&
        fields.map((f) => (
          <TreeRow
            key={f.id}
            depth={4}
            onClick={reveal}
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

function RelationshipRow({
  tabId,
  relId,
  text,
  openMenu,
}: {
  tabId: string;
  relId: string;
  text: string;
  openMenu: OpenMenu;
}) {
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const activeId = useWorkspaceStore((s) => s.activeId);

  const reveal = async () => {
    if (tabId !== activeId) await switchTab(tabId);
    useModelStore.getState().revealRelationship(relId);
  };
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      {
        label: "Delete relationship",
        danger: true,
        onClick: async () => {
          if (tabId !== activeId) await switchTab(tabId);
          useModelStore.getState().deleteRelationship(relId);
        },
      },
    ]);
  };
  return (
    <TreeRow depth={3} label={<span className="tree__rel">{text}</span>} onClick={reveal} onContextMenu={menu} />
  );
}

function RowAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="tree-row__add"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function TreeRow({
  depth,
  label,
  open,
  hasChildren,
  active,
  actions,
  onToggle,
  onClick,
  onContextMenu,
}: {
  depth: number;
  label: ReactNode;
  open?: boolean;
  hasChildren?: boolean;
  active?: boolean;
  actions?: ReactNode;
  onToggle?: () => void;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`tree-row ${active ? "tree-row--active" : ""}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
      {actions && <span className="tree-row__actions">{actions}</span>}
    </div>
  );
}
