import { useState } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { newId } from "../../lib/ids";
import { validateIdentifier } from "../../model/identifiers";
import type { ConnectionProfile } from "../connection";
import { getConnector } from "../registry";
import { pgTestConnection, secretStore } from "../postgres/postgresConnector";
import { metadataToModel } from "../toModel";
import type { Connector, DiscoveryResult } from "../connector";

// Connections workspace (§6.A) + reverse-engineering workflow (§6.B). A left list
// of saved connections; the right panel edits one and runs discovery → preview →
// import into a new model. Credentials entered here are stored in the OS keychain
// (never in workspace JSON).
type Mode = "edit" | "reverse";

export function ConnectionsDialog({ onClose }: { onClose: () => void }) {
  const connections = useWorkspaceStore((s) => s.connections);
  const upsertConnection = useWorkspaceStore((s) => s.upsertConnection);
  const deleteConnection = useWorkspaceStore((s) => s.deleteConnection);
  const [selectedId, setSelectedId] = useState<string | null>(connections[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("edit");

  const selected = connections.find((c) => c.id === selectedId) ?? null;

  const newConnection = () => {
    const id = newId("connection");
    const draft: ConnectionProfile = {
      id,
      name: "new_connection",
      systemType: "postgres",
      params: { host: "localhost", port: "5432", database: "", user: "" },
      secretRef: id,
    };
    void upsertConnection(draft).then(() => {
      setSelectedId(id);
      setMode("edit");
    });
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
                <span className="field__hint">{c.systemType} · {c.params.host}/{c.params.database}</span>
              </button>
            ))}
            {connections.length === 0 && <p className="side__hint">No connections yet.</p>}
            <button className="btn btn--small" onClick={newConnection}>+ PostgreSQL connection</button>
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
              />
            ) : (
              <ReversePanel profile={selected} onBack={() => setMode("edit")} onClose={onClose} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function pgConnector(): Connector | null {
  return getConnector("postgres") ?? null;
}

function ConnectionEditor({
  profile,
  onSave,
  onDelete,
  onReverse,
}: {
  profile: ConnectionProfile;
  onSave: (p: ConnectionProfile) => Promise<void>;
  onDelete: () => Promise<void>;
  onReverse: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [params, setParams] = useState<Record<string, string>>({ ...profile.params });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameError = validateIdentifier(name);
  const setParam = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }));

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
      // Pass the typed password transiently so a test works before the first save.
      const res = await pgTestConnection({ ...profile, params }, password || undefined);
      setStatus(res.ok ? `OK — ${res.productVersion ?? "connected"}` : `Failed: ${res.message}`);
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
      {status && <p className="field__hint">{status}</p>}
      <div className="modal__actions">
        <button className="btn btn--danger btn--small" onClick={onDelete} disabled={busy}>Delete</button>
        <button className="btn btn--small" onClick={test} disabled={busy}>Test</button>
        <button className="btn btn--small" onClick={save} disabled={busy || !!nameError}>Save</button>
        <button className="btn btn--primary btn--small" onClick={onReverse} disabled={busy}>
          Reverse-engineer →
        </button>
      </div>
      <p className="field__hint">Save the connection (stores the password in your OS keychain) before reverse-engineering.</p>
    </div>
  );
}

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
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [modelName, setModelName] = useState(profile.params.database || "imported");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSchemas = async () => {
    const c = pgConnector();
    if (!c) return;
    setBusy(true);
    setStatus("Discovering schemas…");
    try {
      const list = await c.listSchemas(profile);
      setSchemas(list);
      setPicked(new Set(list));
      setStatus(`${list.length} schema(s) found.`);
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    const c = pgConnector();
    if (!c) return;
    setBusy(true);
    setStatus("Discovering objects…");
    try {
      const res = await c.discover(profile, { schemas: [...picked], includeViews: true, includeIndexes: true });
      setDiscovery(res);
      const n = res.metadata.catalogs.reduce(
        (a, cat) => a + cat.schemas.reduce((b, s) => b + s.objects.length, 0),
        0,
      );
      setStatus(`${n} object(s) discovered. Review and import.`);
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const preview = discovery ? metadataToModel(discovery.metadata, modelName || "imported", new Date().toISOString()) : null;

  const doImport = async () => {
    if (!preview) return;
    setBusy(true);
    const err = await importModel(preview.model, modelName);
    setBusy(false);
    if (err) setStatus(err);
    else onClose();
  };

  const nameError = validateIdentifier(modelName);

  return (
    <div>
      <button className="btn btn--small" onClick={onBack}>← Connection</button>
      <h3 className="modal__subtitle">Reverse-engineer “{profile.name}”</h3>

      {!schemas ? (
        <button className="btn btn--small" onClick={loadSchemas} disabled={busy}>1 · Discover schemas</button>
      ) : (
        <>
          <div className="field">
            <label>Schemas to import</label>
            <div className="conn__schemas">
              {schemas.map((s) => (
                <label key={s} className="checkbox">
                  <input
                    type="checkbox"
                    checked={picked.has(s)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(s);
                      else next.delete(s);
                      setPicked(next);
                    }}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn--small" onClick={discover} disabled={busy || picked.size === 0}>
            2 · Discover objects
          </button>
        </>
      )}

      {preview && (
        <div className="import-preview">
          <div className="field">
            <label>New model name</label>
            <input className={nameError ? "is-error" : ""} value={modelName} onChange={(e) => setModelName(e.target.value)} />
          </div>
          <p className="field__hint">
            {preview.model.entities.length} entities · {preview.model.relationships.length} relationships
          </p>
          {preview.warnings.length > 0 && (
            <ul className="import-warnings">
              {preview.warnings.map((w, i) => (
                <li key={i} className="field__hint field__hint--warn">{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status && <p className="field__hint">{status}</p>}

      <div className="modal__actions">
        <button
          className="btn btn--primary"
          onClick={doImport}
          disabled={busy || !preview || preview.model.entities.length === 0 || !!nameError}
        >
          3 · Import as new model
        </button>
      </div>
    </div>
  );
}
