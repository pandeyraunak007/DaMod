import { useRef } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";

// Shared chrome for the workspace side panels (Req 16 §1): one drag-to-resize
// handle and one collapsed "rail" with a restore button, reused by the Explorer,
// Properties, and Copilot panels instead of three separate implementations.

/** A thin draggable divider on a panel's canvas-facing edge. */
export function ResizeHandle({
  edge,
  width,
  onResize,
}: {
  edge: "left" | "right"; // which edge of the panel the handle sits on
  width: number;
  onResize: (next: number) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    // Right-edge handle (left panel) widens when dragged right; left-edge
    // handle (right panels) widens when dragged left.
    onResize(edge === "right" ? start.current.w + dx : start.current.w - dx);
  };
  const up = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    start.current = null;
  };
  return (
    <div
      className={`panel-resize panel-resize--${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      title="Drag to resize"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    />
  );
}

/** The collapsed state of a panel: a narrow strip with a restore button. */
export function PanelRail({
  side,
  title,
  onExpand,
}: {
  side: "left" | "right";
  title: string;
  onExpand: () => void;
}) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <div className={`panel-rail panel-rail--${side}`}>
      <button
        className="panel-rail__btn"
        title={`Show ${title}`}
        aria-label={`Show ${title}`}
        onClick={onExpand}
      >
        <Icon size={16} strokeWidth={1.8} aria-hidden />
      </button>
      <span className="panel-rail__label">{title}</span>
    </div>
  );
}
