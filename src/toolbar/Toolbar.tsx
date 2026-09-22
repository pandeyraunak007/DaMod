import { useEffect, useState } from "react";
import { useModelStore } from "../store/modelStore";

export function Toolbar() {
  const modelName = useModelStore((s) => s.model.name);
  const setModelName = useModelStore((s) => s.setModelName);
  const createEntity = useModelStore((s) => s.createEntity);
  const arrange = useModelStore((s) => s.arrange);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const canUndo = useModelStore((s) => s.past.length > 0);
  const canRedo = useModelStore((s) => s.future.length > 0);
  const search = useModelStore((s) => s.search);

  const [nameDraft, setNameDraft] = useState(modelName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  // Resync the draft when the model name changes underneath us (undo/redo, load).
  useEffect(() => {
    setNameDraft(modelName);
    setNameError(null);
  }, [modelName]);

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <span className="toolbar__brand">DaMod</span>
        <div className="toolbar__model">
          <input
            data-model-name
            className={`toolbar__model-input ${nameError ? "is-error" : ""}`}
            value={nameDraft}
            onChange={(e) => {
              setNameDraft(e.target.value);
              const err = setModelName(e.target.value);
              setNameError(err);
            }}
            title="Model name"
          />
          {nameError && <span className="toolbar__model-error">{nameError}</span>}
        </div>
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
