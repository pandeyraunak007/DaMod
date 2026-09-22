import { useEffect, useState } from "react";
import "./App.css";
import { Toolbar } from "./toolbar/Toolbar";
import { Canvas } from "./canvas/Canvas";
import { SidePanel } from "./panels/SidePanel";
import { RelationshipDialog } from "./panels/RelationshipDialog";
import { useModelStore } from "./store/modelStore";

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

export default function App() {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selection = useModelStore((s) => s.selection);
  const relationshipDraft = useModelStore((s) => s.relationshipDraft);
  const closeRelationshipDraft = useModelStore((s) => s.closeRelationshipDraft);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const pushNotice = useModelStore((s) => s.pushNotice);

  // Keyboard shortcuts (FR-4.6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        pushNotice("Saving arrives in Phase 2 — the model is held in memory for now.");
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        if (isEditableTarget(e.target)) return; // let inputs handle their own undo
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
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
  }, [undo, redo, pushNotice]);

  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        <div className="app__canvas">
          <Canvas />
        </div>
        <SidePanel />
      </div>

      <NoticeToasts />

      {relationshipDraft && <RelationshipDialog onClose={closeRelationshipDraft} />}

      {confirmDelete && selection && (
        <DeleteConfirm onClose={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}

function DeleteConfirm({ onClose }: { onClose: () => void }) {
  const selection = useModelStore((s) => s.selection);
  const model = useModelStore((s) => s.model);
  const deleteEntity = useModelStore((s) => s.deleteEntity);
  const deleteRelationship = useModelStore((s) => s.deleteRelationship);

  if (!selection) return null;

  let title = "";
  let detail = "";
  if (selection.kind === "entity") {
    const entity = model.entities.find((e) => e.id === selection.id);
    const rels = model.relationships.filter(
      (r) =>
        r.parentEntity === selection.id ||
        r.childEntity === selection.id ||
        r.junctionEntity === selection.id,
    );
    title = `Delete entity “${entity?.name ?? "?"}”?`;
    detail = rels.length
      ? `${rels.length} relationship${rels.length > 1 ? "s" : ""} (and any junction entity) will also be removed.`
      : "It has no relationships.";
  } else {
    title = "Delete this relationship?";
    detail = "The foreign-key field it created is left in place.";
  }

  const confirm = () => {
    if (selection.kind === "entity") deleteEntity(selection.id);
    else deleteRelationship(selection.id);
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
