import { useWorkspaceStore } from "../store/workspaceStore";

// When the active model's file changes on disk, offer reload or keep-mine (FR-5.8).
export function ExternalChangeBanner() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const reloadFromDisk = useWorkspaceStore((s) => s.reloadFromDisk);
  const keepMine = useWorkspaceStore((s) => s.keepMine);

  const active = tabs.find((t) => t.id === activeId);
  if (!active || !active.externalChange) return null;

  return (
    <div className="banner">
      <span className="banner__text">
        <strong>{active.fileName}</strong> changed on disk.
      </span>
      <div className="banner__actions">
        <button className="btn btn--small" onClick={() => reloadFromDisk(active.id)}>
          Reload
        </button>
        <button className="btn btn--small" onClick={() => keepMine(active.id)}>
          Keep mine
        </button>
      </div>
    </div>
  );
}
