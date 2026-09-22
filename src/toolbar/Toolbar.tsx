import { useEffect, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  MODEL_LEVELS,
  type ModelLevel,
  canExportDdl,
  exportDisabledReason,
} from "../model/levels";

interface Props {
  onNewModel: () => void;
  onOpenHistory: () => void;
}

export function Toolbar({ onNewModel, onOpenHistory }: Props) {
  const modelName = useModelStore((s) => s.model.name);
  const level = useModelStore((s) => s.model.level);
  const setModelName = useModelStore((s) => s.setModelName);
  const setModelLevel = useModelStore((s) => s.setModelLevel);
  const createEntity = useModelStore((s) => s.createEntity);
  const arrange = useModelStore((s) => s.arrange);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const canUndo = useModelStore((s) => s.past.length > 0);
  const canRedo = useModelStore((s) => s.future.length > 0);
  const search = useModelStore((s) => s.search);
  const pushNotice = useModelStore((s) => s.pushNotice);

  const wsName = useWorkspaceStore((s) => s.name);
  const wsPath = useWorkspaceStore((s) => s.path);
  const openPicker = useWorkspaceStore((s) => s.openWorkspacePicker);
  const duplicateModel = useWorkspaceStore((s) => s.duplicateModel);
  const activeId = useWorkspaceStore((s) => s.activeId);

  const [nameDraft, setNameDraft] = useState(modelName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  useEffect(() => {
    setNameDraft(modelName);
    setNameError(null);
  }, [modelName]);

  const changeLevel = (next: ModelLevel) => {
    const ambiguous = setModelLevel(next);
    if (ambiguous.length) {
      const list = ambiguous.map((a) => `${a.entityName}.${a.fieldName}→${a.chosen.type}`).join(", ");
      pushNotice(`Chose a physical type for ${ambiguous.length} field(s); adjust if needed: ${list}`);
    }
  };

  const exportReason = exportDisabledReason(level);

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <span className="toolbar__brand">DaMod</span>
        <button className="btn btn--small" onClick={openPicker} title="Open a workspace folder">
          {wsPath ? "Change…" : "Open workspace"}
        </button>
        {wsPath && <span className="toolbar__ws" title={wsPath}>{wsName}</span>}
        <button className="btn btn--small" onClick={onNewModel} disabled={!wsPath}>
          + Model
        </button>
        <button
          className="btn btn--small"
          onClick={() => activeId && duplicateModel(activeId)}
          disabled={!wsPath || !activeId}
        >
          Duplicate
        </button>
        <button className="btn btn--small" onClick={onOpenHistory} disabled={!wsPath}>
          History
        </button>
      </div>

      <div className="toolbar__group">
        <input
          className={`toolbar__model-input ${nameError ? "is-error" : ""}`}
          value={nameDraft}
          onChange={(e) => {
            setNameDraft(e.target.value);
            setNameError(setModelName(e.target.value));
          }}
          title="Model name"
        />
        {nameError && <span className="toolbar__model-error">{nameError}</span>}
        <select
          className="toolbar__level"
          value={level}
          onChange={(e) => changeLevel(e.target.value as ModelLevel)}
          title="Modeling level"
        >
          {MODEL_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar__group">
        <button className="btn" onClick={() => createEntity()}>
          + Entity
        </button>
        <button className="btn" onClick={arrange} title="Auto-arrange layout">
          Arrange
        </button>
        <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          Undo
        </button>
        <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          Redo
        </button>
        <button
          className="btn"
          disabled={!canExportDdl(level)}
          title={exportReason ?? "Export Postgres DDL"}
          onClick={() => pushNotice("DDL export arrives in Phase 4.")}
        >
          Export DDL
        </button>
      </div>

      <div className="toolbar__group toolbar__group--right">
        <input
          className={`toolbar__search ${noMatch ? "is-error" : ""}`}
          placeholder="Search entities…"
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            if (v.trim()) setNoMatch(!search(v));
            else setNoMatch(false);
          }}
        />
      </div>
    </div>
  );
}
