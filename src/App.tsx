import { useEffect, useState } from "react";
import "./App.css";
import "@xyflow/react/dist/style.css";
import { Toolbar } from "./toolbar/Toolbar";
import { TabBar } from "./workspace/TabBar";
import { NewModelDialog } from "./workspace/NewModelDialog";
import { HistoryDialog } from "./workspace/HistoryDialog";
import { ExternalChangeBanner } from "./workspace/ExternalChangeBanner";
import { ModelExplorer } from "./explorer/ModelExplorer";
import { Welcome } from "./workspace/Welcome";
import { ValidationPanel } from "./validation/ValidationPanel";
import { SemanticView } from "./semantic/SemanticView";
import { WorkspaceMap } from "./links/WorkspaceMap";
import { ExportDialog } from "./export/ExportDialog";
import { Canvas } from "./canvas/Canvas";
import { SidePanel } from "./panels/SidePanel";
import { RelationshipDialog } from "./panels/RelationshipDialog";
import { PropertiesDialog } from "./panels/PropertiesDialog";
import { LinkDialog } from "./links/LinkDialog";
import { useModelStore } from "./store/modelStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { linksTouching } from "./links/links";

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

export default function App() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [semanticOpen, setSemanticOpen] = useState(false);
  const [deleteModel, setDeleteModel] = useState<{ id: string; name: string } | null>(null);

  const selection = useModelStore((s) => s.selection);
  const relationshipDraft = useModelStore((s) => s.relationshipDraft);
  const closeRelationshipDraft = useModelStore((s) => s.closeRelationshipDraft);
  const linkDraft = useModelStore((s) => s.linkDraft);
  const closeLinkDraft = useModelStore((s) => s.closeLinkDraft);
  const propertiesOpen = useModelStore((s) => s.propertiesOpen);
  const closeProperties = useModelStore((s) => s.closeProperties);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);

  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const wsPath = useWorkspaceStore((s) => s.path);
  const activeTab = tabs.find((t) => t.id === activeId);

  // Restore the last workspace on startup (FR-1.1).
  useEffect(() => {
    useWorkspaceStore.getState().restoreLastWorkspace();
  }, []);

  // Autosave 2s after the last change (FR-5.4): schedule on every model edit.
  useEffect(() => {
    return useModelStore.subscribe((state, prev) => {
      if (state.model !== prev.model) useWorkspaceStore.getState().scheduleAutosave();
    });
  }, []);

  // Poll for on-disk changes (FR-5.8).
  useEffect(() => {
    const id = setInterval(() => useWorkspaceStore.getState().checkExternalChanges(), 1500);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcuts (FR-4.6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        useWorkspaceStore.getState().saveActive(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Escape") {
        useModelStore.getState().setCanvasMode("select");
        return;
      }
      if (e.key === "Enter" && !isEditableTarget(e.target)) {
        const sel = useModelStore.getState().selection;
        if (sel?.kind === "entity" || sel?.kind === "relationship") {
          e.preventDefault();
          useModelStore.getState().openProperties();
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditableTarget(e.target)) {
        if (useModelStore.getState().selection) {
          e.preventDefault();
          setConfirmDelete(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="app">
      <Toolbar
        onNewModel={() => setNewModelOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenMap={() => setMapOpen(true)}
        onOpenExport={() => setExportOpen(true)}
        onToggleSemantic={() => setSemanticOpen((v) => !v)}
        semanticActive={semanticOpen}
      />
      <TabBar onDeleteModel={(id, name) => setDeleteModel({ id, name })} />
      <ExternalChangeBanner />
      {!wsPath ? (
        <div className="app__body">
          <Welcome onNewModel={() => setNewModelOpen(true)} />
        </div>
      ) : semanticOpen ? (
        <div className="app__body">
          <ModelExplorer
            onNewModel={() => setNewModelOpen(true)}
            onDeleteModel={(id, name) => setDeleteModel({ id, name })}
            onOpenSemantic={() => setSemanticOpen(true)}
          />
          <SemanticView />
        </div>
      ) : (
        <div className="app__body">
          <ModelExplorer
            onNewModel={() => setNewModelOpen(true)}
            onDeleteModel={(id, name) => setDeleteModel({ id, name })}
            onOpenSemantic={() => setSemanticOpen(true)}
          />
          <div className="app__canvas">
            {activeTab?.loadError ? (
              <div className="canvas-error">
                <p className="canvas-error__title">Couldn't open {activeTab.fileName}</p>
                <p className="canvas-error__reason">{activeTab.loadError}</p>
                <button
                  className="btn"
                  onClick={() => useWorkspaceStore.getState().reloadFromDisk(activeTab.id)}
                >
                  Retry
                </button>
              </div>
            ) : activeId ? (
              <Canvas />
            ) : (
              <div className="canvas-error">
                <p className="canvas-error__title">No models yet</p>
                <p className="canvas-error__reason">
                  Create your first model and choose its type to open the canvas.
                </p>
                <button className="btn btn--primary" onClick={() => setNewModelOpen(true)}>
                  New model
                </button>
              </div>
            )}
          </div>
          <SidePanel />
        </div>
      )}
      {wsPath && <ValidationPanel />}

      <NoticeToasts />

      {relationshipDraft && <RelationshipDialog onClose={closeRelationshipDraft} />}
      {linkDraft && <LinkDialog from={linkDraft} onClose={closeLinkDraft} />}
      {propertiesOpen && <PropertiesDialog onClose={closeProperties} />}
      {newModelOpen && <NewModelDialog onClose={() => setNewModelOpen(false)} />}
      {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
      {mapOpen && <WorkspaceMap onClose={() => setMapOpen(false)} />}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {confirmDelete && selection && <DeleteConfirm onClose={() => setConfirmDelete(false)} />}
      {deleteModel && (
        <DeleteModelConfirm
          id={deleteModel.id}
          name={deleteModel.name}
          onClose={() => setDeleteModel(null)}
        />
      )}
    </div>
  );
}

function DeleteConfirm({ onClose }: { onClose: () => void }) {
  const selection = useModelStore((s) => s.selection);
  const model = useModelStore((s) => s.model);
  const deleteEntity = useModelStore((s) => s.deleteEntity);
  const deleteRelationship = useModelStore((s) => s.deleteRelationship);
  const links = useWorkspaceStore((s) => s.links);
  const removeLinksForRef = useWorkspaceStore((s) => s.removeLinksForRef);

  if (!selection) return null;

  let title = "";
  let detail = "";
  let linkCount = 0;
  if (selection.kind === "entity") {
    const entity = model.entities.find((e) => e.id === selection.id);
    const rels = model.relationships.filter(
      (r) =>
        r.parentEntity === selection.id ||
        r.childEntity === selection.id ||
        r.junctionEntity === selection.id,
    );
    linkCount = linksTouching(links.links, { model: model.id, entity: selection.id }).length;
    title = `Delete entity “${entity?.name ?? "?"}”?`;
    const parts: string[] = [];
    if (rels.length)
      parts.push(`${rels.length} relationship${rels.length > 1 ? "s" : ""} (and any junction entity)`);
    if (linkCount) parts.push(`${linkCount} cross-model link${linkCount > 1 ? "s" : ""}`);
    detail = parts.length ? `${parts.join(" and ")} will also be removed.` : "It has no relationships.";
  } else {
    title = "Delete this relationship?";
    detail = "The foreign-key field it created is left in place.";
  }

  const confirm = () => {
    if (selection.kind === "entity") {
      if (linkCount) removeLinksForRef({ model: model.id, entity: selection.id });
      deleteEntity(selection.id);
    } else {
      deleteRelationship(selection.id);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--small" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        <p className="modal__text">{detail}</p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--danger" onClick={confirm} autoFocus>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModelConfirm({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const deleteModel = useWorkspaceStore((s) => s.deleteModel);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--small" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Delete model “{name}”?</h2>
        <p className="modal__text">Its file is removed from the workspace folder. This cannot be undone.</p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--danger"
            autoFocus
            onClick={async () => {
              await deleteModel(id);
              onClose();
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeToasts() {
  const notices = useModelStore((s) => s.notices);
  const dismiss = useModelStore((s) => s.dismissNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((n) => setTimeout(() => dismiss(n.id), 7000));
    return () => timers.forEach(clearTimeout);
  }, [notices, dismiss]);

  if (notices.length === 0) return null;
  return (
    <div className="toasts">
      {notices.map((n) => (
        <div key={n.id} className="toast" onClick={() => dismiss(n.id)}>
          {n.message}
        </div>
      ))}
    </div>
  );
}
