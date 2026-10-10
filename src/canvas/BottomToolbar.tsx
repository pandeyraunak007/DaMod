import { useCanvasActions } from "./useCanvasActions";
import { ToolbarButton } from "./ToolbarButton";

// Bottom-anchored modeling toolbar (§13.2). Icon buttons grouped by purpose with
// separators; adapts to width (flex + wrap) and never covers the canvas center.
export function BottomToolbar() {
  const groups = useCanvasActions();
  return (
    <div className="btoolbar" role="toolbar" aria-label="Modeling toolbar">
      <Group actions={groups.tools} />
      <span className="tbar__sep" />
      <Group actions={groups.canvas} />
      <span className="tbar__sep" />
      <Group actions={groups.history} />
      <span className="tbar__sep" />
      <Group actions={groups.panels} />
    </div>
  );
}

function Group({ actions }: { actions: ReturnType<typeof useCanvasActions>["tools"] }) {
  return (
    <div className="tbar__group">
      {actions.map((a) => (
        <ToolbarButton key={a.id} action={a} />
      ))}
    </div>
  );
}
