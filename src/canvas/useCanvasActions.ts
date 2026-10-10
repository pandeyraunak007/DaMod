// Shared action descriptors for the bottom and floating toolbars (§13.2/§13.3) so
// both render identical, correctly-wired buttons. Must be used inside the
// ReactFlowProvider (both toolbars are). Each action maps to an EXISTING command.

import { useReactFlow } from "@xyflow/react";
import {
  type LucideIcon,
  Grid3x3,
  ListChecks,
  Maximize2,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Redo2,
  Spline,
  Table,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { useUiStore } from "../store/uiStore";

export interface ToolbarAction {
  id: string;
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

export interface ToolbarGroups {
  tools: ToolbarAction[];
  canvas: ToolbarAction[];
  history: ToolbarAction[];
  panels: ToolbarAction[];
}

export function useCanvasActions(): ToolbarGroups {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const mode = useModelStore((s) => s.canvasMode);
  const setMode = useModelStore((s) => s.setCanvasMode);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const canUndo = useModelStore((s) => s.past.length > 0);
  const canRedo = useModelStore((s) => s.future.length > 0);

  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const showExplorer = useUiStore((s) => s.showExplorer);
  const showProperties = useUiStore((s) => s.showProperties);
  const showValidation = useUiStore((s) => s.showValidation);
  const togglePanel = useUiStore((s) => s.togglePanel);

  const toggleMode = (m: typeof mode) => setMode(mode === m ? "select" : m);

  return {
    tools: [
      { id: "select", label: "Select", Icon: MousePointer2, active: mode === "select", onClick: () => setMode("select") },
      { id: "add-entity", label: "Add entity — then click the canvas", Icon: Table, active: mode === "add-entity", onClick: () => toggleMode("add-entity") },
      { id: "add-relationship", label: "Add relationship — click two entities", Icon: Spline, active: mode === "add-relationship", onClick: () => toggleMode("add-relationship") },
    ],
    canvas: [
      { id: "zoom-out", label: "Zoom out", Icon: ZoomOut, onClick: () => zoomOut() },
      { id: "zoom-in", label: "Zoom in", Icon: ZoomIn, onClick: () => zoomIn() },
      { id: "fit", label: "Fit to screen", Icon: Maximize2, onClick: () => fitView({ duration: 300 }) },
      { id: "grid", label: "Toggle grid", Icon: Grid3x3, active: showGrid, onClick: toggleGrid },
    ],
    history: [
      { id: "undo", label: "Undo (⌘Z)", Icon: Undo2, disabled: !canUndo, onClick: undo },
      { id: "redo", label: "Redo (⇧⌘Z)", Icon: Redo2, disabled: !canRedo, onClick: redo },
    ],
    panels: [
      { id: "validation", label: "Toggle validation panel", Icon: ListChecks, active: showValidation, onClick: () => togglePanel("showValidation") },
      { id: "explorer", label: "Toggle model explorer", Icon: PanelLeft, active: showExplorer, onClick: () => togglePanel("showExplorer") },
      { id: "properties", label: "Toggle properties panel", Icon: PanelRight, active: showProperties, onClick: () => togglePanel("showProperties") },
    ],
  };
}
