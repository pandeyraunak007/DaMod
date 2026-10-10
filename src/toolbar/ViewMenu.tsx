import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Maximize2,
  Minus,
  Plus,
  Scan,
} from "lucide-react";
import { useUiStore, type ToolbarMode } from "../store/uiStore";
import { canvasControls } from "../canvas/canvasControls";

// The View menu (§13.1). Toggles panels/grid/snap, chooses the toolbar placement,
// and runs canvas zoom/fit actions through React Flow's own controls. Every item
// reflects the current UI state (a check mark for toggles, a dot for the active
// toolbar mode).
export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const ui = useUiStore();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const zoom = (fn: "zoomIn" | "zoomOut" | "fitView" | "resetZoom") => () => canvasControls()?.[fn]();

  return (
    <div className="viewmenu" ref={ref}>
      <button
        className="btn btn--small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="View options"
      >
        View <ChevronDown size={13} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div className="viewmenu__panel" role="menu">
          <p className="viewmenu__label">Panels</p>
          <Toggle label="Model Explorer" on={ui.showExplorer} onClick={() => ui.togglePanel("showExplorer")} />
          <Toggle label="Properties panel" on={ui.showProperties} onClick={() => ui.togglePanel("showProperties")} />
          <Toggle label="Validation panel" on={ui.showValidation} onClick={() => ui.togglePanel("showValidation")} />

          <div className="viewmenu__sep" />
          <p className="viewmenu__label">Toolbar</p>
          {(["bottom", "floating", "hidden"] as ToolbarMode[]).map((m) => (
            <Radio key={m} label={m[0].toUpperCase() + m.slice(1)} on={ui.toolbarMode === m} onClick={() => ui.setToolbarMode(m)} />
          ))}

          <div className="viewmenu__sep" />
          <p className="viewmenu__label">Canvas</p>
          <Toggle label="Grid" on={ui.showGrid} onClick={ui.toggleGrid} />
          <Toggle label="Snap to grid" on={ui.snapToGrid} onClick={ui.toggleSnap} />
          <Item label="Zoom in" Icon={Plus} onClick={zoom("zoomIn")} />
          <Item label="Zoom out" Icon={Minus} onClick={zoom("zoomOut")} />
          <Item label="Fit to screen" Icon={Maximize2} onClick={zoom("fitView")} />
          <Item label="Reset zoom" Icon={Scan} onClick={zoom("resetZoom")} />
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className="viewmenu__item" role="menuitemcheckbox" aria-checked={on} onClick={onClick}>
      <span className="viewmenu__check">{on && <Check size={14} strokeWidth={2.5} aria-hidden />}</span>
      {label}
    </button>
  );
}

function Radio({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className="viewmenu__item" role="menuitemradio" aria-checked={on} onClick={onClick}>
      <span className="viewmenu__check">{on ? "●" : ""}</span>
      {label}
    </button>
  );
}

function Item({ label, Icon, onClick }: { label: string; Icon: typeof Plus; onClick: () => void }) {
  return (
    <button className="viewmenu__item" role="menuitem" onClick={onClick}>
      <span className="viewmenu__check"><Icon size={14} strokeWidth={2} aria-hidden /></span>
      {label}
    </button>
  );
}
