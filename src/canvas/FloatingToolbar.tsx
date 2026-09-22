import { useReactFlow } from "@xyflow/react";
import { useModelStore, type CanvasMode } from "../store/modelStore";

// A Figma-style floating toolbar over the canvas with the core modeling actions.
// Tools (Select / Add entity / Add relationship) are modes; the rest are one-shot
// actions. Escape returns to Select (handled in App).
export function FloatingToolbar({ connecting }: { connecting: boolean }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const mode = useModelStore((s) => s.canvasMode);
  const setMode = useModelStore((s) => s.setCanvasMode);
  const arrange = useModelStore((s) => s.arrange);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const canUndo = useModelStore((s) => s.past.length > 0);
  const canRedo = useModelStore((s) => s.future.length > 0);

  const toggle = (m: CanvasMode) => setMode(mode === m ? "select" : m);

  return (
    <div className="ftoolbar">
      <ToolButton
        label="Select"
        icon="⌖"
        active={mode === "select"}
        onClick={() => setMode("select")}
      />
      <ToolButton
        label="Add entity — then click the canvas"
        icon="▭"
        active={mode === "add-entity"}
        onClick={() => toggle("add-entity")}
      />
      <ToolButton
        label={
          connecting
            ? "Now click the second entity"
            : "Add relationship — click two entities"
        }
        icon="⇢"
        active={mode === "add-relationship"}
        onClick={() => toggle("add-relationship")}
      />
      <span className="ftoolbar__sep" />
      <ToolButton label="Fit to view" icon="⤢" onClick={() => fitView({ duration: 300 })} />
      <ToolButton label="Auto-arrange" icon="▦" onClick={arrange} />
      <span className="ftoolbar__sep" />
      <ToolButton label="Undo (⌘Z)" icon="↶" disabled={!canUndo} onClick={undo} />
      <ToolButton label="Redo (⇧⌘Z)" icon="↷" disabled={!canRedo} onClick={redo} />
      <span className="ftoolbar__sep" />
      <ToolButton label="Zoom out" icon="−" onClick={() => zoomOut()} />
      <ToolButton label="Zoom in" icon="+" onClick={() => zoomIn()} />
    </div>
  );
}

function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`ftool ${active ? "ftool--active" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
