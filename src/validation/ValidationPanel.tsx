import { useMemo, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { validateWorkspace, type Issue } from "./rules";

// The validation panel (FR-10.1): lists every issue in the workspace with
// severity, message and a go-to action. Reruns whenever the active model or the
// links change (FR-10.4); it never blocks saving.
export function ValidationPanel() {
  const activeModel = useModelStore((s) => s.model);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const links = useWorkspaceStore((s) => s.links);
  const switchTab = useWorkspaceStore((s) => s.switchTab);

  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(() => {
    const models = tabs
      .filter((t) => !t.loadError)
      .map((t) => (t.id === activeId ? activeModel : t.model))
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map((m) => ({ id: m.id, name: m.name, model: m }));
    if (models.length === 0) return [];
    return validateWorkspace({ models, links: links.links, conceptGroups: links.conceptGroups });
  }, [activeModel, tabs, activeId, links]);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const goTo = async (issue: Issue) => {
    const t = issue.target;
    if (t.model && t.model !== activeId) await switchTab(t.model);
    if (t.entity) useModelStore.getState().revealEntity(t.entity);
    else if (t.relationship) useModelStore.getState().revealRelationship(t.relationship);
  };

  return (
    <div className={`vpanel ${expanded ? "vpanel--open" : ""}`}>
      <button className="vpanel__bar" onClick={() => setExpanded((v) => !v)}>
        <span className={`vpanel__count ${errors.length ? "is-error" : ""}`}>
          ● {errors.length} error{errors.length === 1 ? "" : "s"}
        </span>
        <span className={`vpanel__count ${warnings.length ? "is-warn" : ""}`}>
          ▲ {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        </span>
        <span className="vpanel__spacer" />
        <span className="vpanel__toggle">{expanded ? "▾ Validation" : "▸ Validation"}</span>
      </button>
      {expanded && (
        <div className="vpanel__list">
          {issues.length === 0 && <p className="vpanel__empty">No issues. 🎉</p>}
          {issues.map((i) => (
            <button key={i.id} className="vpanel__issue" onClick={() => goTo(i)}>
              <span className={`vpanel__sev vpanel__sev--${i.severity}`}>
                {i.severity === "error" ? "●" : "▲"}
              </span>
              <span className="vpanel__msg">{i.message}</span>
              <span className="vpanel__goto">go to →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
