import { useEffect, useState } from "react";
import { useModelStore } from "../../store/modelStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { allObjects } from "../metadata";
import type { SourceSnapshot } from "../snapshot";

// Source-snapshot browser (Req 21/22). Shows the SNAPSHOT-only metadata that is not
// carried into the editable model — source identity + release/API version, discovery
// provenance, the EBS application dictionary (concurrent programs / lookups / program
// units) and the Fusion API resources + extract data stores. Read-only: a snapshot is
// a point-in-time discovery record, kept separate from the maintained model (§11).

/** Pure renderer for one snapshot (testable without the file layer). */
export function SnapshotView({ snapshot }: { snapshot: SourceSnapshot }) {
  const md = snapshot.metadata;
  const src = md.source;
  const objects = allObjects(md);
  const tables = objects.filter((o) => o.object.kind === "table" || o.object.kind === "business-object").length;
  const views = objects.filter((o) => o.object.kind === "view" || o.object.kind === "materialized-view").length;
  const app = md.application;
  const fus = md.fusion;

  const row = (k: string, v?: string) => (v ? <tr key={k}><td className="src-info__k">{k}</td><td className="src-info__v">{v}</td></tr> : null);

  return (
    <div className="snap">
      <table className="src-info">
        <tbody>
          {row("Source system", src.systemType)}
          {row("Instance", src.name)}
          {row("Database version", src.productVersion)}
          {row("EBS release", src.ebsRelease)}
          {row("EBS instance", src.ebsInstance)}
          {row("Fusion API version", src.apiVersion)}
          {row("Discovered by", `${snapshot.provenance.connectorId} ${snapshot.provenance.connectorVersion}`)}
          {row("Discovered at", snapshot.provenance.discoveredAt)}
          {row("Schemas", snapshot.provenance.schemasDiscovered.join(", ") || undefined)}
          {row("Objects", `${tables} table/object(s)${views ? `, ${views} view(s)` : ""}`)}
        </tbody>
      </table>

      {app && (app.concurrentPrograms.length > 0 || app.lookups.length > 0 || app.programUnits.length > 0) && (
        <div className="snap__section">
          <h4 className="snap__h">EBS application dictionary</h4>
          {app.concurrentPrograms.length > 0 && (
            <>
              <p className="field__hint">Concurrent programs ({app.concurrentPrograms.length})</p>
              <ul className="snap__list">
                {app.concurrentPrograms.map((p) => (
                  <li key={p.shortName}><code>{p.shortName}</code> {p.name} <span className="snap__tag">{p.product}</span>{p.description ? ` — ${p.description}` : ""}</li>
                ))}
              </ul>
            </>
          )}
          {app.lookups.length > 0 && (
            <>
              <p className="field__hint">Lookups ({app.lookups.length})</p>
              <ul className="snap__list">
                {app.lookups.map((l) => <li key={l.type}><code>{l.type}</code> <span className="snap__tag">{l.product}</span>{l.description ? ` — ${l.description}` : ""}</li>)}
              </ul>
            </>
          )}
          {app.programUnits.length > 0 && (
            <>
              <p className="field__hint">Program units ({app.programUnits.length})</p>
              <ul className="snap__list">
                {app.programUnits.map((u) => <li key={`${u.schema}.${u.name}`}><code>{u.schema}.{u.name}</code> <span className="snap__tag">{u.kind}</span>{u.product ? ` · ${u.product}` : ""}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {fus && (fus.apiResources.length > 0 || fus.extractDataStores.length > 0) && (
        <div className="snap__section">
          <h4 className="snap__h">Fusion Cloud metadata</h4>
          {fus.apiResources.length > 0 && (
            <>
              <p className="field__hint">REST resources ({fus.apiResources.length})</p>
              <ul className="snap__list">
                {fus.apiResources.map((r) => (
                  <li key={r.path}><code>{r.name}</code> <span className="snap__tag">{r.methods.join(" ")}</span> {r.path}{r.version ? ` · v${r.version}` : ""}</li>
                ))}
              </ul>
            </>
          )}
          {fus.extractDataStores.length > 0 && (
            <>
              <p className="field__hint">Extract data stores ({fus.extractDataStores.length})</p>
              <ul className="snap__list">
                {fus.extractDataStores.map((d) => (
                  <li key={d.name}><code>{d.name}</code> <span className="snap__tag">{d.offering}</span>{d.incremental ? " · incremental" : ""} — {d.fields.length} field(s)</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The dialog: loads the active model's saved snapshot (by model name) and shows it.
export function SnapshotBrowser({ onClose }: { onClose: () => void }) {
  const modelName = useModelStore((s) => s.model.name);
  const loadSnapshot = useWorkspaceStore((s) => s.loadSnapshot);
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadSnapshot(modelName).then((s) => {
      if (!cancelled) {
        setSnapshot(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [modelName, loadSnapshot]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--map" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Source snapshot — {modelName}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {loading ? (
          <p className="side__hint">Loading…</p>
        ) : snapshot ? (
          <SnapshotView snapshot={snapshot} />
        ) : (
          <p className="side__hint">
            No source snapshot saved for “{modelName}”. Snapshots are written when you
            reverse-engineer or import this model from a connector.
          </p>
        )}
      </div>
    </div>
  );
}
