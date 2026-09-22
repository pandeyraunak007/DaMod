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
// (FR-5.8).
export function TabBar({ onDeleteModel }: { onDeleteModel: (id: string, name: string) => void }) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const model = useModelStore((s) => s.model);

  if (tabs.length === 0) return null;

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
            title={t.loadError ? `${t.fileName}: ${t.loadError}` : name}
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
              title="Delete model"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteModel(t.id, name);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
