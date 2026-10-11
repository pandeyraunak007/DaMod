import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { serializeModel } from "../persist/serialize";
import { modelNameFromFile } from "../persist/filenames";
import type { ModelLevel } from "../model/levels";

const LEVEL_BADGE: Record<ModelLevel, string> = {
  Conceptual: "C",
  Logical: "L",
  "Physical/Logical": "P/L",
  Physical: "P",
};

// The row of open model tabs (FR-1.3). Exactly one is active. Shows each model's
// level badge (FR-11.1), an unsaved marker (FR-5.4) and an on-disk-change marker
// (FR-5.8). The ✕ CLOSES the tab (keeps the file); Delete is on the right-click menu
// (and in the Model Explorer). A trailing + reopens a closed model from the folder.
export function TabBar({ onDeleteModel }: { onDeleteModel: (id: string, name: string) => void }) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const availableFiles = useWorkspaceStore((s) => s.availableFiles);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openModelFile = useWorkspaceStore((s) => s.openModelFile);
  const model = useModelStore((s) => s.model);
  const [openMenu, setOpenMenu] = useState(false);

  // Models in the folder that aren't currently open as tabs.
  const openFiles = new Set(tabs.map((t) => t.fileName));
  const closedFiles = availableFiles.filter((f) => !openFiles.has(f));

  if (tabs.length === 0 && closedFiles.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeId);
  const activeDirty =
    activeTab && !activeTab.loadError
      ? serializeModel(model) !== activeTab.lastSavedText
      : false;

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const dirty = active && activeDirty;
        const name = modelNameFromFile(t.fileName);
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            className={`tab ${active ? "tab--active" : ""} ${t.loadError ? "tab--error" : ""}`}
            onClick={() => switchTab(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onDeleteModel(t.id, name); // right-click = delete the model file (confirmed)
            }}
            title={t.loadError ? `${t.fileName}: ${t.loadError}` : `${name} — click to open, right-click to delete`}
          >
            {t.loadError ? (
              <span className="tab__badge tab__badge--error" title="Failed to load">
                !
              </span>
            ) : (
              t.model && <span className="tab__badge">{LEVEL_BADGE[t.model.level]}</span>
            )}
            <span className="tab__name">{name}</span>
            {t.externalChange && (
              <span className="tab__external" title="Changed on disk">
                ⟳
              </span>
            )}
            {dirty && <span className="tab__dirty" title="Unsaved changes">●</span>}
            <button
              className="tab__close"
              title="Close tab (keeps the file; right-click the tab to delete the model)"
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(t.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}

      {closedFiles.length > 0 && (
        <div className="tab-open">
          <button
            className="tab-open__btn"
            title="Open another model from this workspace"
            onClick={() => setOpenMenu((v) => !v)}
          >
            +
          </button>
          {openMenu && (
            <div className="tab-open__menu" onMouseLeave={() => setOpenMenu(false)}>
              {closedFiles.map((f) => (
                <button
                  key={f}
                  className="tab-open__item"
                  onClick={() => {
                    setOpenMenu(false);
                    void openModelFile(f);
                  }}
                >
                  {modelNameFromFile(f)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
