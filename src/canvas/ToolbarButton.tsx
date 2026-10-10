import type { ToolbarAction } from "./useCanvasActions";

// Icon-only toolbar button with an accessible name, tooltip, and explicit
// hover/active/disabled/focus states (§13.5/§13.8). Icon size + stroke are fixed
// for visual consistency.
export function ToolbarButton({ action }: { action: ToolbarAction }) {
  const { label, Icon, onClick, active, disabled } = action;
  return (
    <button
      type="button"
      className={`tbtn ${active ? "tbtn--active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
