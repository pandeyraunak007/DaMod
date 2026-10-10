import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useModelStore } from "../../store/modelStore";
import { newId } from "../../lib/ids";
import { validateIdentifier } from "../../model/identifiers";
import type { ConnectionProfile } from "../connection";
import { getConnector } from "../registry";
import { pgTestConnection, secretStore } from "../postgres/postgresConnector";
import { metadataToModel, type ToModelResult } from "../toModel";
import { ebsSnapshotToModel, ebsApplicationSummary } from "../oracle/ebs";
import { computeDrift, applyDrift, type DriftChange } from "../drift";
import type { ModelDiff } from "../../export/migrate";
import type { Model } from "../../model/model";
import type { CanonicalMetadata, SourceSystemType } from "../metadata";
import type { SourceSnapshot } from "../snapshot";
import type { Connector, DiscoveryResult } from "../connector";

/** Resolve the connector for a profile's system type. */
function connectorFor(p: ConnectionProfile): Connector | null {
  return getConnector(p.systemType as SourceSystemType) ?? null;
}

/** Build a model from discovered metadata, EBS-enriched for an oracle-ebs source. */
function buildModel(p: ConnectionProfile, md: CanonicalMetadata, name: string, now: string): ToModelResult {
  return p.systemType === "oracle-ebs" ? ebsSnapshotToModel(md, name, now) : metadataToModel(md, name, now);
}

function isEbs(p: ConnectionProfile): boolean {
  return p.systemType === "oracle-ebs";
}

// Read-only EBS application-dictionary counts in the reverse-engineer preview
// (Req 21 §3C). These are discovery facts kept on the snapshot, not modeled objects.
function EbsApplicationLine({ metadata }: { metadata: CanonicalMetadata }) {
  const s = ebsApplicationSummary(metadata);
  if (!s.concurrentPrograms && !s.lookups && !s.programUnits) return null;
  const units = Object.entries(s.programUnitsByKind)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
    .join(", ");
  return (
    <p className="field__hint">
      EBS application metadata: <strong>{s.concurrentPrograms}</strong> concurrent programs ·{" "}
      <strong>{s.lookups}</strong> lookups · <strong>{s.programUnits}</strong> program units
      {units ? ` (${units})` : ""}. Stored with the snapshot; not imported as model tables.
    </p>
  );
}

function buildSnapshot(connectionRef: string, d: DiscoveryResult): SourceSnapshot {
  return {
    snapshotVersion: 1,
    id: newId("snapshot"),
    connectionRef,
    metadata: d.metadata,
    provenance: d.provenance,
  };
}

// Connections workspace (§6.A) + reverse-engineering workflow (§6.B). A left list
// of saved connections; the right panel edits one and runs discovery → preview →
// import into a new model. Credentials entered here are stored in the OS keychain
// (never in workspace JSON).
type Mode = "edit" | "reverse" | "refresh";

export function ConnectionsDialog({
  onClose,
  startReverse = false,
}: {
  onClose: () => void;
  startReverse?: boolean;
}) {
  const connections = useWorkspaceStore((s) => s.connections);
  const upsertConnection = useWorkspaceStore((s) => s.upsertConnection);
  const deleteConnection = useWorkspaceStore((s) => s.deleteConnection);
  // When launched via the Data-tab "Reverse-engineer" shortcut, jump straight to
  // the reverse panel of the first ready (host+database+user) connection.
  const readyConn = connections.find((c) => c.params.host && c.params.database && c.params.user);
  const [selectedId, setSelectedId] = useState<string | null>(
    (startReverse && readyConn?.id) || connections[0]?.id || null,
  );
  const [mode, setMode] = useState<Mode>(startReverse && readyConn ? "reverse" : "edit");

  const selected = connections.find((c) => c.id === selectedId) ?? null;

  const addConnection = (draft: ConnectionProfile) => {
    void upsertConnection(draft).then(() => {
      setSelectedId(draft.id);
      setMode("edit");
    });
  };
  const newPgConnection = () => {
    const id = newId("connection");
    addConnection({
      id,
      name: "new_connection",
      systemType: "postgres",
      params: { host: "localhost", port: "5432", database: "", user: "" },
      secretRef: id,
    });
  };
  const newEbsConnection = () => {
    const id = newId("connection");
    // Mock/offline Oracle EBS source — no host/credentials needed (Req 21 Phase 1/2).
    addConnection({ id, name: "oracle_ebs", systemType: "oracle-ebs", params: { database: "VIS" } });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--map" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Connections</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="conn__layout">
          <div className="conn__list">
            {connections.map((c) => (
              <button
                key={c.id}
                className={`conn__item ${c.id === selectedId ? "conn__item--active" : ""}`}
                onClick={() => {
                  setSelectedId(c.id);
                  setMode("edit");
                }}
              >
                <strong>{c.name}</strong>
                <span className="field__hint">{c.systemType} · {c.params.host ? `${c.params.host}/` : ""}{c.params.database}</span>
              </button>
            ))}
            {connections.length === 0 && <p className="side__hint">No connections yet.</p>}
            <button className="btn btn--small" onClick={newPgConnection}>+ PostgreSQL connection</button>
            <button className="btn btn--small" onClick={newEbsConnection}>+ Oracle EBS (mock)</button>
          </div>
          <div className="conn__panel">
            {!selected ? (
              <p className="side__hint">Select or create a connection.</p>
            ) : mode === "edit" ? (
              <ConnectionEditor
                key={selected.id}
                profile={selected}
                onSave={upsertConnection}
                onDelete={async () => {
                  await deleteConnection(selected.id);
                  setSelectedId(null);
                }}
                onReverse={() => setMode("reverse")}
                onRefresh={() => setMode("refresh")}
              />
            ) : mode === "reverse" ? (
              <ReversePanel profile={selected} onBack={() => setMode("edit")} onClose={onClose} />
            ) : (
              <RefreshPanel profile={selected} onBack={() => setMode("edit")} onClose={onClose} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionEditor({
  profile,
  onSave,
  onDelete,
  onReverse,
  onRefresh,
}: {
  profile: ConnectionProfile;
  onSave: (p: ConnectionProfile) => Promise<void>;
  onDelete: () => Promise<void>;
  onReverse: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [params, setParams] = useState<Record<string, string>>({ ...profile.params });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameError = validateIdentifier(name);
  const setParam = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }));

  // Discovery uses the SAVED profile + the keychain secret, so the connection
  // must be fully filled in AND saved (no unsaved edits) before reverse-engineer
  // or refresh. Guard the buttons and explain why they are disabled. An EBS (mock)
  // source needs only an instance name and carries no credentials.
  const ebs = isEbs(profile);
  const configured = ebs ? !!params.database?.trim() : !!(params.host?.trim() && params.database?.trim() && params.user?.trim());
  const dirty =
    password.length > 0 ||
    name !== profile.name ||
    JSON.stringify(params) !== JSON.stringify(profile.params);
  const ready = configured && !dirty;
  const readyReason = !configured
    ? ebs
      ? "Enter the EBS instance / service name."
      : "Fill in host, database and user."
    : dirty
      ? ebs
        ? "Save your changes first."
        : "Save your changes first (stores the password in the OS keychain)."
      : null;

  const save = async () => {
    if (nameError) return;
    setBusy(true);
    try {
      if (password) await secretStore(profile.secretRef ?? profile.id, password);
      await onSave({ ...profile, name, params });
      setStatus("Saved.");
      setPassword("");
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setStatus("Testing…");
    try {
      if (ebs) {
        const c = connectorFor(profile);
        const res = c
          ? await c.testConnection({ ...profile, params })
          : { ok: false, message: "No connector registered" };
        setStatus(res.ok ? `OK — ${res.message}` : `Failed: ${res.message}`);
      } else {
        // Pass the typed password transiently so a test works before the first save.
        const res = await pgTestConnection({ ...profile, params }, password || undefined);
        setStatus(res.ok ? `OK — ${res.productVersion ?? "connected"}` : `Failed: ${res.message}`);
      }
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="field">
        <label>Name</label>
        <input className={nameError ? "is-error" : ""} value={name} onChange={(e) => setName(e.target.value)} />
        {nameError && <span className="toolbar__model-error">{nameError}</span>}
      </div>
      {ebs ? (
        <>
          <div className="field">
            <label>EBS instance / service name</label>
            <input value={params.database ?? ""} placeholder="e.g. VIS" onChange={(e) => setParam("database", e.target.value)} />
          </div>
          <p className="field__hint">
            Oracle E-Business Suite (mock/offline source). Read-only metadata discovery — no
            credentials required; the live Oracle adapter is pending a driver sign-off
            (see docs/ORACLE_EBS.md). EBS release &amp; DB version are reported on Test.
          </p>
        </>
      ) : (
        <>
          <div className="modal__row modal__row--pair">
            <div className="field">
              <label>Host</label>
              <input value={params.host ?? ""} onChange={(e) => setParam("host", e.target.value)} />
            </div>
            <div className="field">
              <label>Port</label>
              <input value={params.port ?? "5432"} onChange={(e) => setParam("port", e.target.value)} />
            </div>
          </div>
          <div className="modal__row modal__row--pair">
            <div className="field">
              <label>Database</label>
              <input value={params.database ?? ""} onChange={(e) => setParam("database", e.target.value)} />
            </div>
            <div className="field">
              <label>User</label>
              <input value={params.user ?? ""} onChange={(e) => setParam("user", e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Password {profile.secretRef ? "(stored in keychain)" : ""}</label>
            <input
              type="password"
              placeholder="•••••• (leave blank to keep stored)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </>
      )}
      {status && <p className="field__hint">{status}</p>}
      <div className="modal__actions">
        <button className="btn btn--danger btn--small" onClick={onDelete} disabled={busy}>Delete</button>
        <button className="btn btn--small" onClick={test} disabled={busy || !configured}>Test</button>
        <button className="btn btn--small" onClick={save} disabled={busy || !!nameError || !configured}>Save</button>
        <button
          className="btn btn--small"
          onClick={onRefresh}
          disabled={busy || !ready}
          title={readyReason ?? "Compare the source against the saved snapshot"}
        >
          Refresh &amp; compare →
        </button>
        <button
          className="btn btn--primary btn--small"
          onClick={onReverse}
          disabled={busy || !ready}
          title={readyReason ?? "Discover the source schema into a new model"}
        >
          Reverse-engineer →
        </button>
      </div>
      <p className="field__hint">
        {readyReason
          ? readyReason
          : "Ready — Reverse-engineer to discover the schema into a new model."}
      </p>
    </div>
  );
}

// Streamlined reverse-engineering: opening the panel auto-discovers the whole
// source (all user schemas); the user sees a live preview and clicks Import.
// Narrowing to specific schemas is optional (re-discovers on toggle).
function ReversePanel({
  profile,
  onBack,
  onClose,
}: {
  profile: ConnectionProfile;
  onBack: () => void;
  onClose: () => void;
}) {
  const importModel = useWorkspaceStore((s) => s.importModel);
  const saveSnapshot = useWorkspaceStore((s) => s.saveSnapshot);
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [modelName, setModelName] = useState(profile.params.database || "imported");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runDiscover = async (sel: Set<string>) => {
    const c = connectorFor(profile);
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const res = await c.discover(profile, {
        schemas: [...sel],
        includeViews: true,
        includeIndexes: true,
      });
      setDiscovery(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-discover everything on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = connectorFor(profile);
      if (!c) return;
      try {
        const list = await c.listSchemas(profile);
        if (cancelled) return;
        setSchemas(list);
        const all = new Set(list);
        setPicked(all);
        await runDiscover(all);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSchema = (s: string) => {
    const next = new Set(picked);
    next.has(s) ? next.delete(s) : next.add(s);
    setPicked(next);
    if (next.size) void runDiscover(next);
    else setDiscovery(null);
  };

  const preview = discovery
    ? buildModel(profile, discovery.metadata, modelName || "imported", new Date().toISOString())
    : null;
  const nameError = validateIdentifier(modelName);

  const doImport = async () => {
    if (!preview || !discovery) return;
    setBusy(true);
    const err = await importModel(preview.model, modelName);
    if (!err) await saveSnapshot(profile.name, buildSnapshot(profile.id, discovery));
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div>
      <button className="btn btn--small" onClick={onBack}>← Connection</button>
      <h3 className="modal__subtitle">Reverse-engineer “{profile.name}”</h3>

      {error && <p className="field__hint field__hint--warn">{error}</p>}
      {busy && !preview && <p className="field__hint">Discovering the database…</p>}

      {/* Optional: narrow to specific schemas (only when there's more than one). */}
      {schemas && schemas.length > 1 && (
        <div className="field">
          <label>Schemas {busy && <span className="field__hint">· discovering…</span>}</label>
          <div className="conn__schemas">
            {schemas.map((s) => (
              <label key={s} className="checkbox">
                <input type="checkbox" checked={picked.has(s)} onChange={() => toggleSchema(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="import-preview">
            <p className="field__hint">
              <strong>{preview.model.entities.length}</strong> tables ·{" "}
              <strong>{preview.model.relationships.length}</strong> relationships
              {preview.model.entities.length > 0 && (
                <>
                  {" "}
                  — {preview.model.entities.slice(0, 8).map((e) => e.name).join(", ")}
                  {preview.model.entities.length > 8 ? "…" : ""}
                </>
              )}
            </p>
            {discovery && isEbs(profile) && <EbsApplicationLine metadata={discovery.metadata} />}
            {preview.warnings.length > 0 && (
              <details>
                <summary className="field__hint">{preview.warnings.length} note(s)</summary>
                <ul className="import-warnings">
                  {preview.warnings.map((w, i) => (
                    <li key={i} className="field__hint field__hint--warn">{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="modal__row modal__row--pair">
            <div className="field">
              <label>New model name</label>
              <input
                className={nameError ? "is-error" : ""}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </div>
            <div className="field conn__import-action">
              <button
                className="btn btn--primary"
                onClick={doImport}
                disabled={busy || preview.model.entities.length === 0 || !!nameError}
              >
                Import {preview.model.entities.length} tables →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Refresh & compare (§6.C): discover the source again, diff it against the saved
// snapshot (pure source drift), let the user approve changes, and apply them to
// the ACTIVE model — preserving unrelated manual edits.
function RefreshPanel({
  profile,
  onBack,
  onClose,
}: {
  profile: ConnectionProfile;
  onBack: () => void;
  onClose: () => void;
}) {
  const loadSnapshot = useWorkspaceStore((s) => s.loadSnapshot);
  const saveSnapshot = useWorkspaceStore((s) => s.saveSnapshot);
  const saveActive = useWorkspaceStore((s) => s.saveActive);
  const activeModelName = useModelStore((s) => s.model.name);
  const loadModel = useModelStore((s) => s.loadModel);

  const [state, setState] = useState<{
    changes: DriftChange[];
    diff: ModelDiff;
    nextModel: Model;
    discovery: DiscoveryResult;
  } | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const c = connectorFor(profile);
    if (!c) return;
    setBusy(true);
    setStatus("Discovering and comparing…");
    try {
      const prev = await loadSnapshot(profile.name);
      const discovery = await c.discover(profile, { includeViews: true, includeIndexes: true });
      if (!prev) {
        // Nothing to compare against — record the first snapshot.
        await saveSnapshot(profile.name, buildSnapshot(profile.id, discovery));
        setStatus("No previous snapshot — saved the first one. Re-run after the source changes.");
        setBusy(false);
        return;
      }
      const { changes, diff, nextModel } = computeDrift(
        prev.metadata,
        discovery.metadata,
        new Date().toISOString(),
      );
      setState({ changes, diff, nextModel, discovery });
      setAccepted(new Set(changes.filter((ch) => ch.kind !== "possible-rename").map((ch) => ch.key)));
      setStatus(changes.length ? `${changes.length} change(s) since the last snapshot.` : "No changes since the last snapshot.");
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!state) return;
    setBusy(true);
    const current = useModelStore.getState().model;
    const updated = applyDrift(current, state.nextModel, state.diff, accepted);
    loadModel(updated);
    await saveActive(true);
    await saveSnapshot(profile.name, buildSnapshot(profile.id, state.discovery));
    setBusy(false);
    onClose();
  };

  const toggle = (key: string) => {
    const next = new Set(accepted);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setAccepted(next);
  };

  return (
    <div>
      <button className="btn btn--small" onClick={onBack}>← Connection</button>
      <h3 className="modal__subtitle">Refresh “{profile.name}” → model “{activeModelName}”</h3>
      <p className="field__hint">
        Changes apply to the active model on the canvas. Unrelated manual edits are preserved.
      </p>

      {!state ? (
        <button className="btn btn--small" onClick={refresh} disabled={busy}>Discover &amp; compare</button>
      ) : state.changes.length === 0 ? (
        <p className="side__hint">The model is already in sync with the source.</p>
      ) : (
        <>
          <div className="conn__schemas drift__list">
            {state.changes.map((ch) => (
              <label key={ch.key} className="checkbox drift__row">
                <input
                  type="checkbox"
                  disabled={ch.kind === "possible-rename"}
                  checked={accepted.has(ch.key)}
                  onChange={() => toggle(ch.key)}
                />
                <span className={ch.kind === "possible-rename" ? "field__hint--warn" : ""}>{ch.label}</span>
              </label>
            ))}
          </div>
          <div className="modal__actions">
            <button className="btn btn--primary" onClick={apply} disabled={busy || accepted.size === 0}>
              Apply {accepted.size} change{accepted.size === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
      {status && <p className="field__hint">{status}</p>}
    </div>
  );
}
