import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FilePlus2, KeyRound, PanelLeftClose } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { fieldTypeLabel } from "../model/fieldDisplay";
import { displayName } from "../model/presentation";
import type { Model } from "../model/model";
import {
  type LevelTerms,
  type ModelLevel,
  levelTerms,
  showsKeys,
  showsPhysicalObjects,
  usesPhysicalTypes,
} from "../model/levels";
import { linksTouching } from "../links/links";
import { validateWorkspace, type Severity } from "../validation/rules";
import { EbsExplorer, FusionExplorer } from "./EbsExplorer";
import { hasEbsContent, hasFusionContent } from "./ebsTree";

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
  onOpenSemantic: () => void;
  onCollapse: () => void;
}

// The dockable workspace tree (FR-12): Workspace → Models → Entities /
// Relationships / Fields, plus a Semantic node. Nodes navigate (click), rename
// (double-click) and can create/delete metaobjects via + buttons and a
// right-click menu (FR-12.6).
export function ModelExplorer({ onNewModel, onDeleteModel, onOpenSemantic, onCollapse }: ExplorerProps) {
  const path = useWorkspaceStore((s) => s.path);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const duplicateModel = useWorkspaceStore((s) => s.duplicateModel);
  const links = useWorkspaceStore((s) => s.links);
  const semantic = useWorkspaceStore((s) => s.semantic);
  const activeModel = useModelStore((s) => s.model);

  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenu: OpenMenu = (x, y, items) => setMenu({ x, y, items });
  // EBS-aware view (Req 21 §4): offered only when the active model carries EBS/Oracle
  // discovery provenance; falls back to the standard tree otherwise.
  const [view, setView] = useState<"model" | "app">("model");

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
  // Req 18: the Explorer is scoped to the ACTIVE model tab only. Other open models
  // stay open (their tabs remain the switcher) but are not shown as sibling roots.
  const activeEntry = models.find((m) => m.tabId === activeId) ?? null;

  // Auto-expand a model's node the first time it becomes active (so switching to a
  // tab reveals its tree), unless the user has already toggled that model's nodes.
  const autoExpanded = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeId) return;
    if (autoExpanded.current.has(activeId)) return;
    autoExpanded.current.add(activeId);
    setExpanded((prev) => {
      if ([...prev].some((k) => k === `m:${activeId}` || k.startsWith(`m:${activeId}:`))) return prev;
      return new Set(prev).add(`m:${activeId}`).add(`m:${activeId}:ents`);
    });
  }, [activeId]);

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
    const keys = new Set<string>(["ws:sem"]);
    if (activeEntry?.model) {
      const { tabId, model } = activeEntry;
      keys.add(`m:${tabId}`);
      keys.add(`m:${tabId}:ents`);
      keys.add(`m:${tabId}:rels`);
      keys.add(`m:${tabId}:views`);
      keys.add(`m:${tabId}:indexes`);
      keys.add(`m:${tabId}:seqs`);
      keys.add(`m:${tabId}:raw`);
      for (const e of model.entities) keys.add(`e:${tabId}:${e.id}`);
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
  const addView = async (tabId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().createView();
    expand(`m:${tabId}`);
    expand(`m:${tabId}:views`);
  };
  const addMatView = async (tabId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().createView(undefined, true);
    expand(`m:${tabId}`);
    expand(`m:${tabId}:matviews`);
  };
  const addSchema = async (tabId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().createSchema();
    expand(`m:${tabId}`);
    expand(`m:${tabId}:schemas`);
  };
  const addIndex = async (tabId: string) => {
    await ensureActive(tabId);
    const first = useModelStore.getState().model.entities[0];
    if (!first) {
      useModelStore.getState().pushNotice("Add an entity before an index.");
      return;
    }
    useModelStore.getState().createIndex(first.id);
    expand(`m:${tabId}:indexes`);
  };
  const addSequence = async (tabId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().createSequence();
    expand(`m:${tabId}:seqs`);
  };
  const addRaw = async (tabId: string) => {
    await ensureActive(tabId);
    useModelStore.getState().createRawObject("postgres");
    expand(`m:${tabId}:raw`);
  };
  const selectObject = async (
    tabId: string,
    sel: { kind: "view" | "index" | "sequence" | "rawObject" | "schema"; id: string },
  ) => {
    await ensureActive(tabId);
    useModelStore.getState().select(sel);
  };
  const deleteObject = async (
    tabId: string,
    kind: "view" | "index" | "sequence" | "rawObject" | "schema",
    oid: string,
  ) => {
    await ensureActive(tabId);
    const st = useModelStore.getState();
    if (kind === "view") st.deleteView(oid);
    else if (kind === "index") st.deleteIndex(oid);
    else if (kind === "sequence") st.deleteSequence(oid);
    else if (kind === "schema") st.deleteSchema(oid);
    else st.deleteRawObject(oid);
  };

  // The active model may carry EBS or Fusion discovery provenance → offer an
  // application-aware view alongside the standard tree.
  const appModel = activeEntry?.model ?? null;
  const appKind: "ebs" | "fusion" | null = appModel
    ? hasEbsContent(appModel)
      ? "ebs"
      : hasFusionContent(appModel)
        ? "fusion"
        : null
    : null;
  const appLabel = appKind === "fusion" ? "Fusion" : "EBS";
  const effectiveView = appKind ? view : "model";

  return (
    <aside className="explorer" onClick={() => menu && setMenu(null)}>
      <div className="explorer__head">
        <span className="explorer__title">Explorer</span>
        <div className="explorer__head-actions">
          {appKind && (
            <div className="explorer__viewseg" role="tablist" aria-label="Explorer view">
              <button
                role="tab"
                aria-selected={effectiveView === "model"}
                className={`explorer__viewseg-btn ${effectiveView === "model" ? "explorer__viewseg-btn--active" : ""}`}
                title="Standard model tree"
                onClick={() => setView("model")}
              >
                Model
              </button>
              <button
                role="tab"
                aria-selected={effectiveView === "app"}
                className={`explorer__viewseg-btn ${effectiveView === "app" ? "explorer__viewseg-btn--active" : ""}`}
                title={`${appLabel}-aware view`}
                onClick={() => setView("app")}
              >
                {appLabel}
              </button>
            </div>
          )}
          <button className="icon-btn" title="New model" aria-label="New model" onClick={onNewModel}>
            <FilePlus2 size={15} strokeWidth={1.8} aria-hidden />
          </button>
          <button className="icon-btn" title="Expand all" onClick={expandAll}>
            ⊞
          </button>
          <button className="icon-btn" title="Collapse all" onClick={collapseAll}>
            ⊟
          </button>
          <button className="icon-btn" title="Hide explorer" aria-label="Hide explorer" onClick={onCollapse}>
            <PanelLeftClose size={15} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      </div>
      {effectiveView === "app" && appModel ? (
        appKind === "fusion" ? <FusionExplorer model={appModel} /> : <EbsExplorer model={appModel} />
      ) : (
      <>
      <input
        className="explorer__filter"
        placeholder="Filter…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="explorer__tree">
        {/* Req 18: show ONLY the active model's tree. Tabs (TabBar) remain the
            switcher between open models; inactive models stay open & untouched. */}
        {activeEntry == null ? (
          <p className="explorer__empty">{path ? "No model open — create one with +." : "Open a workspace to begin."}</p>
        ) : activeEntry.error || !activeEntry.model ? (
          <TreeRow
            depth={0}
            label={<span className="tree__error" title={activeEntry.error ?? ""}>⚠ {activeEntry.fileName}</span>}
          />
        ) : (
          <ModelBranch
            key={activeEntry.tabId}
            tabId={activeEntry.tabId}
            model={activeEntry.model}
            active
            q={q}
            filtering={filtering}
            isOpen={isOpen}
            toggle={toggle}
            openMenu={openMenu}
            marks={marks}
            onSwitch={switchTab}
            onAddEntity={() => addEntity(activeEntry.tabId)}
            onAddField={(eid) => addField(activeEntry.tabId, eid)}
            onAddRelationship={() => addRelationship(activeEntry.tabId)}
            onAddView={() => addView(activeEntry.tabId)}
            onAddMatView={() => addMatView(activeEntry.tabId)}
            onAddSchema={() => addSchema(activeEntry.tabId)}
            onAddIndex={() => addIndex(activeEntry.tabId)}
            onAddSequence={() => addSequence(activeEntry.tabId)}
            onAddRaw={() => addRaw(activeEntry.tabId)}
            onSelectObject={(sel) => selectObject(activeEntry.tabId, sel)}
            onDeleteObject={(kind, oid) => deleteObject(activeEntry.tabId, kind, oid)}
            onDuplicateModel={() => duplicateModel(activeEntry.tabId)}
            onDeleteModel={() => onDeleteModel(activeEntry.tabId, activeEntry.model!.name)}
          />
        )}

        {/* Subject areas (Req 21/22 §6) — database-agnostic entity groupings for the
            active model; available for every source, not just EBS/Fusion. */}
        {activeEntry?.model && (
          <SubjectAreasSection model={activeEntry.model} isOpen={isOpen} toggle={toggle} openMenu={openMenu} />
        )}

        {/* Semantic layer is a workspace-wide concern — shown as a sibling root. */}
        <TreeRow
          depth={0}
          open={isOpen("ws:sem")}
          hasChildren
          label={<span className="tree__group">Semantic layer</span>}
          onToggle={() => toggle("ws:sem")}
          onClick={onOpenSemantic}
        />
        {isOpen("ws:sem") && (
          <>
            <TreeRow depth={1} onClick={onOpenSemantic} label={<span className="tree__muted">Terms ({semantic.terms.length})</span>} />
            <TreeRow depth={1} onClick={onOpenSemantic} label={<span className="tree__muted">Dimensions ({semantic.dimensions.length})</span>} />
            <TreeRow depth={1} onClick={onOpenSemantic} label={<span className="tree__muted">Metrics ({semantic.metrics.length})</span>} />
          </>
        )}
      </div>
      </>
      )}

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

/** Compact cardinality for a relationship badge (1:1 / 1:N / N:M). */
function cardShort(c: string): string {
  if (c === "one-to-one") return "1:1";
  if (c === "many-to-many") return "N:M";
  return "1:N";
}

/** The key marker cell for a field row. */
function keyMark(primaryKey: boolean, isFk: boolean, unique: boolean, withKeys: boolean): ReactNode {
  if (!withKeys) return <span className="tree__key-dot" />;
  if (primaryKey) return <KeyRound size={11} className="tree__key tree__key--pk" aria-label="PK" />;
  if (isFk) return <span className="tree__key-badge tree__key--fk">FK</span>;
  if (unique) return <span className="tree__key-badge tree__key--u">U</span>;
  return <span className="tree__key-dot" />;
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
  onAddView,
  onAddMatView,
  onAddSchema,
  onAddIndex,
  onAddSequence,
  onAddRaw,
  onSelectObject,
  onDeleteObject,
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
  onAddView: () => void;
  onAddMatView: () => void;
  onAddSchema: () => void;
  onAddIndex: () => void;
  onAddSequence: () => void;
  onAddRaw: () => void;
  onSelectObject: (sel: { kind: "view" | "index" | "sequence" | "rawObject" | "schema"; id: string }) => void;
  onDeleteObject: (kind: "view" | "index" | "sequence" | "rawObject" | "schema", id: string) => void;
  onDuplicateModel: () => void;
  onDeleteModel: () => void;
}) {
  const terms = levelTerms(model.level);
  const showPhysical = showsPhysicalObjects(model.level);
  const entityName = (id: string) => model.entities.find((e) => e.id === id)?.name ?? "?";
  const entityMatches = (e: Model["entities"][number]) =>
    !filtering ||
    matches(e.name, q) ||
    (e.logicalName ? matches(e.logicalName, q) : false) ||
    e.fields.some((f) => matches(f.name, q) || (f.logicalName ? matches(f.logicalName, q) : false));
  const relText = (r: Model["relationships"][number]) =>
    `${entityName(r.parentEntity)} → ${entityName(r.childEntity)} (${r.cardinality})`;
  const relMatches = (r: Model["relationships"][number]) => !filtering || matches(relText(r), q);

  const anyEntity = model.entities.some(entityMatches);
  const anyRel = model.relationships.some(relMatches);
  if (filtering && !matches(model.name, q) && !anyEntity && !anyRel) return null;

  const modelMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: `Add ${terms.entity.toLowerCase()}`, onClick: onAddEntity },
      { label: "Duplicate model", onClick: onDuplicateModel },
      { label: "Delete model", danger: true, onClick: onDeleteModel },
    ]);
  };

  return (
    <>
      <TreeRow
        depth={0}
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
          {/* Entities / Tables / Business Entities */}
          <TreeRow
            depth={1}
            open={isOpen(`m:${tabId}:ents`)}
            hasChildren
            label={
              <span className="tree__group">
                {terms.entityPlural} <span className="tree__count">{model.entities.length}</span>
              </span>
            }
            onToggle={() => toggle(`m:${tabId}:ents`)}
            actions={
              <RowAction title={`Add ${terms.entity.toLowerCase()}`} onClick={onAddEntity}>
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
                terms={terms}
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
            depth={1}
            open={isOpen(`m:${tabId}:rels`)}
            hasChildren
            label={
              <span className="tree__group">
                Relationships <span className="tree__count">{model.relationships.length}</span>
              </span>
            }
            onToggle={() => toggle(`m:${tabId}:rels`)}
            actions={
              <RowAction title="Add relationship" onClick={onAddRelationship}>
                +
              </RowAction>
            }
          />
          {isOpen(`m:${tabId}:rels`) &&
            model.relationships.filter(relMatches).map((r) => (
              <RelationshipRow
                key={r.id}
                tabId={tabId}
                relId={r.id}
                parent={entityName(r.parentEntity)}
                child={entityName(r.childEntity)}
                card={cardShort(r.cardinality)}
                title={relText(r)}
                openMenu={openMenu}
              />
            ))}

          {/* Physical-only objects — hidden at Conceptual/Logical (§4.1/§4.2). */}
          {showPhysical && (
            <>
              <ObjectGroup
                open={isOpen(`m:${tabId}:schemas`)}
                onToggle={() => toggle(`m:${tabId}:schemas`)}
                name="Schemas"
                count={model.schemas?.length ?? 0}
                onAdd={onAddSchema}
                items={(model.schemas ?? []).filter((v) => !filtering || matches(v.name, q))}
                onSelect={(id) => onSelectObject({ kind: "schema", id })}
                onDelete={(id) => onDeleteObject("schema", id)}
                openMenu={openMenu}
              />
              <ObjectGroup
                open={isOpen(`m:${tabId}:views`)}
                onToggle={() => toggle(`m:${tabId}:views`)}
                name="Views"
                count={(model.views ?? []).filter((v) => !v.materialized).length}
                onAdd={onAddView}
                items={(model.views ?? []).filter((v) => !v.materialized).filter((v) => !filtering || matches(v.name, q))}
                onSelect={(id) => onSelectObject({ kind: "view", id })}
                onDelete={(id) => onDeleteObject("view", id)}
                openMenu={openMenu}
              />
              <ObjectGroup
                open={isOpen(`m:${tabId}:matviews`)}
                onToggle={() => toggle(`m:${tabId}:matviews`)}
                name="Materialized views"
                count={(model.views ?? []).filter((v) => v.materialized).length}
                onAdd={onAddMatView}
                items={(model.views ?? []).filter((v) => v.materialized).filter((v) => !filtering || matches(v.name, q))}
                onSelect={(id) => onSelectObject({ kind: "view", id })}
                onDelete={(id) => onDeleteObject("view", id)}
                openMenu={openMenu}
              />
              <ObjectGroup
                open={isOpen(`m:${tabId}:indexes`)}
                onToggle={() => toggle(`m:${tabId}:indexes`)}
                name="Indexes"
                count={model.indexes?.length ?? 0}
                onAdd={onAddIndex}
                items={(model.indexes ?? []).filter((v) => !filtering || matches(v.name, q))}
                onSelect={(id) => onSelectObject({ kind: "index", id })}
                onDelete={(id) => onDeleteObject("index", id)}
                openMenu={openMenu}
              />
              <ObjectGroup
                open={isOpen(`m:${tabId}:seqs`)}
                onToggle={() => toggle(`m:${tabId}:seqs`)}
                name="Sequences"
                count={model.sequences?.length ?? 0}
                onAdd={onAddSequence}
                items={(model.sequences ?? []).filter((v) => !filtering || matches(v.name, q))}
                onSelect={(id) => onSelectObject({ kind: "sequence", id })}
                onDelete={(id) => onDeleteObject("sequence", id)}
                openMenu={openMenu}
              />
              <ObjectGroup
                open={isOpen(`m:${tabId}:raw`)}
                onToggle={() => toggle(`m:${tabId}:raw`)}
                name="Raw objects"
                count={model.rawObjects?.length ?? 0}
                onAdd={onAddRaw}
                items={(model.rawObjects ?? []).filter((v) => !filtering || matches(v.name, q))}
                onSelect={(id) => onSelectObject({ kind: "rawObject", id })}
                onDelete={(id) => onDeleteObject("rawObject", id)}
                openMenu={openMenu}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

// Database-agnostic subject areas for the active model (Req 21/22 §6). Create an
// empty area (+), add the selected entity to an area, expand to see/reveal/remove
// members, rename (double-click) and delete. Works for any source.
function SubjectAreasSection({
  model,
  isOpen,
  toggle,
  openMenu,
}: {
  model: Model;
  isOpen: (k: string) => boolean;
  toggle: (k: string) => void;
  openMenu: OpenMenu;
}) {
  const areas = model.subjectAreas ?? [];
  const create = () => useModelStore.getState().createSubjectArea("new_area");
  return (
    <>
      <TreeRow
        depth={0}
        open={isOpen("ws:areas")}
        hasChildren
        label={
          <span className="tree__group">
            Subject areas <span className="tree__count">{areas.length}</span>
          </span>
        }
        onToggle={() => toggle("ws:areas")}
        actions={
          <RowAction title="New subject area" onClick={create}>
            +
          </RowAction>
        }
      />
      {isOpen("ws:areas") &&
        areas.map((a) => (
          <SubjectAreaRow key={a.id} area={a} model={model} open={isOpen(`a:${a.id}`)} onToggle={() => toggle(`a:${a.id}`)} openMenu={openMenu} />
        ))}
    </>
  );
}

function SubjectAreaRow({
  area,
  model,
  open,
  onToggle,
  openMenu,
}: {
  area: NonNullable<Model["subjectAreas"]>[number];
  model: Model;
  open: boolean;
  onToggle: () => void;
  openMenu: OpenMenu;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(area.name);
  const entityName = (id: string) => model.entities.find((e) => e.id === id)?.name ?? "?";
  // Clicking a subject area OPENS its diagram (erwin-style) — the canvas scopes to
  // just this area's tables. Expand the row to see/reveal individual members.
  const openDiagram = () => useModelStore.getState().setActiveDiagram(area.id);
  const addSelected = () => {
    const sel = useModelStore.getState().selection;
    if (sel?.kind === "entity") useModelStore.getState().addEntityToSubjectArea(area.id, sel.id);
    else useModelStore.getState().pushNotice("Select a table first, then add it to the subject area.");
  };
  const commitRename = () => {
    useModelStore.getState().updateSubjectArea(area.id, { name: draft });
    setRenaming(false);
  };
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: "Open diagram", onClick: openDiagram },
      { label: "Add selected table", onClick: addSelected },
      { label: "Rename", onClick: () => (setDraft(area.name), setRenaming(true)) },
      { label: "Delete subject area", danger: true, onClick: () => useModelStore.getState().deleteSubjectArea(area.id) },
    ]);
  };
  return (
    <>
      <TreeRow
        depth={1}
        open={open}
        hasChildren={area.entities.length > 0}
        onToggle={onToggle}
        onClick={openDiagram}
        onContextMenu={menu}
        actions={
          <>
            <RowAction title="Add selected table" onClick={addSelected}>+</RowAction>
            <RowAction title="Delete subject area" onClick={() => useModelStore.getState().deleteSubjectArea(area.id)}>✕</RowAction>
          </>
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
              title={area.description ?? area.name}
              onDoubleClick={(e) => (e.stopPropagation(), setDraft(area.name), setRenaming(true))}
            >
              {area.name} <span className="tree__count">{area.entities.length}</span>
              {area.product && <span className="tree__badge"> {area.product}</span>}
            </span>
          )
        }
      />
      {open &&
        area.entities.map((eid) => (
          <TreeRow
            key={eid}
            depth={2}
            onClick={() => useModelStore.getState().revealEntity(eid)}
            actions={
              <RowAction
                title="Remove from subject area"
                onClick={() =>
                  useModelStore.getState().updateSubjectArea(area.id, { entities: area.entities.filter((x) => x !== eid) })
                }
              >
                –
              </RowAction>
            }
            label={<span className="tree__entity">{entityName(eid)}</span>}
          />
        ))}
    </>
  );
}

function ObjectGroup({
  open,
  onToggle,
  name,
  count,
  onAdd,
  items,
  onSelect,
  onDelete,
  openMenu,
}: {
  open: boolean;
  onToggle: () => void;
  name: string;
  count: number;
  onAdd: () => void;
  items: { id: string; name: string }[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  openMenu: OpenMenu;
}) {
  return (
    <>
      <TreeRow
        depth={1}
        open={open}
        hasChildren
        label={
          <span className="tree__group">
            {name} <span className="tree__count">{count}</span>
          </span>
        }
        onToggle={onToggle}
        actions={
          <RowAction title={`Add`} onClick={onAdd}>
            +
          </RowAction>
        }
      />
      {open &&
        items.map((it) => (
          <TreeRow
            key={it.id}
            depth={2}
            label={<span className="tree__obj">{it.name}</span>}
            onClick={() => onSelect(it.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(e.clientX, e.clientY, [
                { label: "Delete", danger: true, onClick: () => onDelete(it.id) },
              ]);
            }}
          />
        ))}
    </>
  );
}

function EntityBranch({
  tabId,
  model,
  entity,
  terms,
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
  terms: LevelTerms;
  q: string;
  filtering: boolean;
  open: boolean;
  onToggle: () => void;
  openMenu: OpenMenu;
  marks: ExplorerMarks;
  onAddField: () => void;
  onAddRelationship: () => void;
}) {
  const addFieldLabel = `Add ${terms.field.toLowerCase()}`;
  const withKeys = showsKeys(model.level);
  // Foreign-key field ids for this entity (for FK markers, like the canvas).
  const fkIds = new Set<string>();
  for (const r of model.relationships) {
    if (r.childEntity === entity.id) r.foreignKeyFields.forEach((id) => fkIds.add(id));
  }
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entity.name);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const activeId = useWorkspaceStore((s) => s.activeId);

  const reveal = async () => {
    if (tabId !== activeId) await switchTab(tabId);
    useModelStore.getState().revealEntity(entity.id);
  };
  const openChecks = async () => {
    await reveal();
    useModelStore.getState().openProperties();
  };
  // At Conceptual/Logical the tree shows the business name, so rename edits
  // logicalName; at Physical levels it renames the physical identifier.
  const editsLogical = !usesPhysicalTypes(model.level);
  const commitRename = () => {
    if (editsLogical) useModelStore.getState().updateEntity(entity.id, { logicalName: draft });
    else useModelStore.getState().renameEntity(entity.id, draft);
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
      {
        label: "Properties…",
        onClick: async () => {
          await reveal();
          useModelStore.getState().openProperties();
        },
      },
      { label: addFieldLabel, onClick: onAddField },
      { label: "Add relationship", onClick: onAddRelationship },
      {
        label: "New subject area from this",
        onClick: () => {
          const st = useModelStore.getState();
          const id = st.createSubjectArea(`${entity.name}_area`);
          st.addEntityToSubjectArea(id, entity.id);
        },
      },
      { label: "Rename", onClick: () => (setDraft(displayName(entity, model.level)), setRenaming(true)) },
      { label: "Delete entity", danger: true, onClick: deleteEntity },
    ]);
  };

  return (
    <>
      <TreeRow
        depth={2}
        open={open}
        hasChildren={entity.fields.length > 0}
        onToggle={onToggle}
        onClick={reveal}
        onContextMenu={entityMenu}
        actions={
          <RowAction title={addFieldLabel} onClick={onAddField}>
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
                setDraft(displayName(entity, model.level));
                setRenaming(true);
              }}
            >
              {displayName(entity, model.level)}
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
            depth={3}
            onClick={reveal}
            label={
              <span className="tree__field">
                <span className="tree__field-key">
                  {keyMark(f.primaryKey, fkIds.has(f.id), f.unique, withKeys)}
                </span>
                <span className="tree__field-name">{displayName(f, model.level)}</span>
                <span className="tree__field-type">{fieldTypeLabel(f, model.level)}</span>
              </span>
            }
          />
        ))}
      {/* CHECK constraints under the table (physical only) — click opens the
          table's Checks tab (Req 19). */}
      {open &&
        withKeys &&
        (entity.checks ?? []).map((c) => (
          <TreeRow
            key={c.id}
            depth={3}
            onClick={openChecks}
            label={
              <span className="tree__field">
                <span className="tree__key-badge tree__key--chk">CK</span>
                <span className="tree__field-name">{c.name}</span>
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
  parent,
  child,
  card,
  title,
  openMenu,
}: {
  tabId: string;
  relId: string;
  parent: string;
  child: string;
  card: string;
  title: string;
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
        label: "Properties…",
        onClick: async () => {
          await reveal();
          useModelStore.getState().openProperties();
        },
      },
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
    <TreeRow
      depth={2}
      onClick={reveal}
      onContextMenu={menu}
      label={
        <span className="tree__rel" title={title}>
          <span className="tree__card">{card}</span>
          <span className="tree__rel-name">{parent}</span>
          <span className="tree__rel-arrow">→</span>
          <span className="tree__rel-name">{child}</span>
        </span>
      }
    />
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
