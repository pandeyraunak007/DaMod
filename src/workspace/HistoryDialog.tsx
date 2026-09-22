import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { listHistory, type HistoryEntry } from "../persist/fs";

// Browse and restore the last 20 saved versions of the active model (FR-5.9).
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const path = useWorkspaceStore((s) => s.path);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const restoreHistory = useWorkspaceStore((s) => s.restoreHistory);

  const activeTab = tabs.find((t) => t.id === activeId);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    if (!path || !activeTab) return;
    listHistory(path, activeTab.fileName).then(setEntries);
  }, [path, activeTab]);

  const restore = async (entry: HistoryEntry) => {
    await restoreHistory(entry.file);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Version history — {activeTab?.fileName}</h2>
        {entries === null && <p className="modal__text">Loading…</p>}
        {entries && entries.length === 0 && (
          <p className="modal__text">No saved history yet. History builds up as you save.</p>
        )}
        {entries && entries.length > 0 && (
          <ul className="history">
            {entries.map((e, i) => (
              <li key={e.file} className="history__row">
                <span className="history__when">
                  {new Date(e.timestamp).toLocaleString()}
                  {i === 0 && <span className="history__latest"> (latest)</span>}
                </span>
                <button className="btn btn--small" onClick={() => restore(e)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
