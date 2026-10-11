import { useState } from "react";
import { useModelStore } from "../store/modelStore";

// Dependency-aware domain deletion (Slice 2). Shown when a domain delete is
// requested; lists the columns bound to the domain and requires an explicit
// resolution — detach (keep current type) or reassign to another domain — before
// removing it. No silent conversion. One undo entry via deleteDomainResolved.
export function DomainDeleteDialog() {
  const pendingId = useModelStore((s) => s.domainDeletePending);
  // Stable refs; derive OUTSIDE the selector (CLAUDE.md §5.1).
  const domains = useModelStore((s) => s.model.domains);
  const entities = useModelStore((s) => s.model.entities);
  const cancel = useModelStore((s) => s.cancelDomainDelete);
  const resolve = useModelStore((s) => s.deleteDomainResolved);

  const domainList = domains ?? [];
  const domain = pendingId ? domainList.find((d) => d.id === pendingId) : undefined;

  const dependents = domain
    ? entities.flatMap((e) =>
        e.fields.filter((f) => f.domainId === domain.id).map((f) => `${e.name}.${f.name}`),
      )
    : [];
  const others = domain ? domainList.filter((d) => d.id !== domain.id) : [];

  const [mode, setMode] = useState<"detach" | "reassign">("detach");
  const [replacementId, setReplacementId] = useState<string>("");

  if (!pendingId) return null;
  if (!domain) {
    // Domain already gone (e.g. undo/redo) — just clear the request.
    cancel();
    return null;
  }

  const canReassign = others.length > 0;
  const confirmDelete = () => {
    if (mode === "reassign" && canReassign) {
      resolve(domain.id, "reassign", replacementId || others[0].id);
    } else {
      resolve(domain.id, "detach");
    }
  };

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Delete domain “{domain.name}”?</h2>
          <button className="icon-btn" onClick={cancel}>✕</button>
        </div>
        <div className="props__body">
          {dependents.length === 0 ? (
            <p className="side__hint">Not used by any column. Deleting it is safe.</p>
          ) : (
            <>
              <p className="field__hint field__hint--warn">
                {dependents.length} column(s) are bound to this domain:
              </p>
              <ul className="whereused">
                {dependents.map((d) => (
                  <li key={d} className="whereused__row"><span>{d}</span></li>
                ))}
              </ul>
              <div className="field">
                <label className="checkbox">
                  <input
                    type="radio"
                    name="domain-del-mode"
                    checked={mode === "detach"}
                    onChange={() => setMode("detach")}
                  />
                  Detach — columns keep their current type
                </label>
                <label className="checkbox">
                  <input
                    type="radio"
                    name="domain-del-mode"
                    checked={mode === "reassign"}
                    disabled={!canReassign}
                    onChange={() => setMode("reassign")}
                  />
                  Reassign to another domain
                </label>
                {mode === "reassign" && canReassign && (
                  <select
                    className="editor__input"
                    value={replacementId || others[0].id}
                    onChange={(e) => setReplacementId(e.target.value)}
                  >
                    {others.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                )}
                {!canReassign && (
                  <p className="field__hint">No other domain to reassign to — detach only.</p>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal__actions">
          <button className="btn btn--ghost btn--small" onClick={cancel}>Cancel</button>
          <button className="btn btn--danger btn--small" onClick={confirmDelete}>Delete domain</button>
        </div>
      </div>
    </div>
  );
}
