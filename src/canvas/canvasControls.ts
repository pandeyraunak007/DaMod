// A tiny bridge so UI outside the ReactFlowProvider (the top View menu) can drive
// the canvas viewport through React Flow's OWN API — no competing zoom logic
// (§13.7). A component inside the provider registers the handlers on mount.

export interface CanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
  resetZoom: () => void;
}

let controls: CanvasControls | null = null;

export function registerCanvasControls(c: CanvasControls | null): void {
  controls = c;
}

export function canvasControls(): CanvasControls | null {
  return controls;
}
