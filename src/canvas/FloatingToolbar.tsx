import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useUiStore, clampToBounds } from "../store/uiStore";
import { useCanvasActions } from "./useCanvasActions";
import { ToolbarButton } from "./ToolbarButton";

// Floating toolbar over the canvas (§13.3). Icon-first, draggable ONLY by the
// grip handle (buttons keep their click action), clamped inside the canvas, and
// marked `nopan`/`nodrag` so it never initiates React Flow pan/selection.
export function FloatingToolbar() {
  const groups = useCanvasActions();
  const pos = useUiStore((s) => s.floatingPos);
  const setPos = useUiStore((s) => s.setFloatingPos);
  const ref = useRef<HTMLDivElement>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const bounds = (): { w: number; h: number } => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    return { w: parent?.clientWidth ?? window.innerWidth, h: parent?.clientHeight ?? window.innerHeight };
  };
  const size = (): { w: number; h: number } => ({
    w: ref.current?.offsetWidth ?? 320,
    h: ref.current?.offsetHeight ?? 44,
  });

  // Re-clamp to stay visible when the window/canvas is resized (§13.3, AC #8).
  useEffect(() => {
    const onResize = () => setPos(clampToBounds(useUiStore.getState().floatingPos, size(), bounds()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setPos]);

  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    setDragPos(pos);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = clampToBounds(
      { x: drag.current.originX + (e.clientX - drag.current.startX), y: drag.current.originY + (e.clientY - drag.current.startY) },
      size(),
      bounds(),
    );
    setDragPos(next);
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (dragPos) setPos(dragPos); // commit + persist once, at drop
    drag.current = null;
    setDragPos(null);
  };

  const shown = dragPos ?? pos;

  return (
    <div
      ref={ref}
      className="ftoolbar nopan nodrag"
      style={{ left: shown.x, top: shown.y }}
      role="toolbar"
      aria-label="Floating modeling toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="ftoolbar__handle"
        aria-label="Drag toolbar"
        title="Drag to move"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      >
        <GripVertical size={15} strokeWidth={1.75} aria-hidden />
      </button>
      {[groups.tools, groups.canvas, groups.history].map((grp, i) => (
        <span key={i} className="tbar__group">
          {grp.map((a) => (
            <ToolbarButton key={a.id} action={a} />
          ))}
          {i < 2 && <span className="tbar__sep" />}
        </span>
      ))}
    </div>
  );
}
