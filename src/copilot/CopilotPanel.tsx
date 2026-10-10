import { useState } from "react";
import { Sparkles, ShieldCheck, ShieldAlert, Settings2, X, Send, Trash2 } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { secretStore } from "../lib/secrets";
import { newId } from "../lib/ids";
import {
  type CopilotConfig,
  loadCopilotConfig,
  saveCopilotConfig,
} from "./settings";
import { noTrainingLabel } from "./privacy";
import { OpenAiCompatProvider, type Provider } from "./provider";
import { buildContext, type ContextScope } from "./context";
import { requestPlan } from "./orchestrate";
import { type CopilotPlan, requiresApproval, hasDestructive } from "./actions";
import { executePlan, type PlanResult } from "./execute";
import { useCopilotSession } from "./session";

/** Contextual prompt suggestions (§3.2) — only for supported capabilities. */
function suggestions(selectedEntity: string | null): { label: string; prompt: string }[] {
  if (selectedEntity) {
    return [
      { label: "Describe this", prompt: `Write a clear business description for the ${selectedEntity} table and each of its columns.` },
      { label: "Explain", prompt: `Explain the ${selectedEntity} table and its relationships.` },
      { label: "Add audit cols", prompt: `Add created_at and updated_at timestamp columns to ${selectedEntity}.` },
      { label: "Review", prompt: `Review the ${selectedEntity} table for data-modeling issues and propose fixes.` },
    ];
  }
  return [
    { label: "Describe all tables", prompt: "Write clear business descriptions for every table and its columns." },
    { label: "Propose relationships", prompt: "Propose sensible foreign-key relationships between the existing tables." },
    { label: "Explain model", prompt: "Explain this data model and how the tables relate." },
    { label: "Add audit columns", prompt: "Add created_at and updated_at timestamp columns to every table." },
  ];
}

// The optional AI Modeling Copilot drawer (§14.7). Proposes a structured plan the
// user reviews and approves; applying it reuses the existing modeling command
// layer and undo/redo. Copilot is entirely optional — nothing here runs unless
// the user enables it and sends a request.
export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<CopilotConfig>(loadCopilotConfig());
  const [showSettings, setShowSettings] = useState(!config.enabled);
  const [scope, setScope] = useState<ContextScope>("model");
  const [plan, setPlan] = useState<CopilotPlan | null>(null);
  const [planPrompt, setPlanPrompt] = useState("");
  const [planBase, setPlanBase] = useState<string>("");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft + history live in a session store so they survive collapse/reopen.
  const draft = useCopilotSession((s) => s.draft);
  const setDraft = useCopilotSession((s) => s.setDraft);
  const history = useCopilotSession((s) => s.history);
  const addEntry = useCopilotSession((s) => s.addEntry);
  const clearHistory = useCopilotSession((s) => s.clear);

  const selection = useModelStore((s) => s.selection);
  const selectedEntityName = useModelStore((s) =>
    selection?.kind === "entity" ? s.model.entities.find((e) => e.id === selection.id)?.name ?? null : null,
  );
  const level = useModelStore((s) => s.model.level);
  const undo = useModelStore((s) => s.undo);

  const provider = (): Provider =>
    new OpenAiCompatProvider({ baseUrl: config.baseUrl, model: config.model, secretRef: config.secretRef });

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setStatus(null);
    setPlan(null);
    setResult(null);
    try {
      const model = useModelStore.getState().model;
      const selId = scope === "selection" && selection?.kind === "entity" ? selection.id : null;
      const ctx = buildContext(model, scope, selId);
      const res = await requestPlan(provider(), draft, ctx, {
        policy: config.privacyPolicy,
        status: config.noTraining,
      });
      if (res.blocked) setStatus(`Blocked by privacy policy: ${res.blocked}`);
      else if (res.error) setStatus(res.error);
      else if (res.plan) {
        setPlan(res.plan);
        setPlanPrompt(draft);
        setPlanBase(model.updatedAt); // conflict check at apply time
        if (res.plan.actions.length === 0) {
          // A read-only answer / explanation — record it, no approval needed.
          addEntry({ id: newId("field"), prompt: draft, summary: res.plan.summary, applied: 0, skipped: 0, failed: 0 });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!plan) return;
    if (useModelStore.getState().model.updatedAt !== planBase) {
      setStatus("The model changed since this plan was generated — please re-send.");
      setPlan(null);
      return;
    }
    const res = executePlan(plan);
    setResult(res);
    addEntry({ id: newId("field"), prompt: planPrompt, summary: plan.summary, applied: res.applied, skipped: res.skipped, failed: res.failed });
    setPlan(null);
    setStatus(null);
  };

  const reject = () => {
    if (plan) addEntry({ id: newId("field"), prompt: planPrompt, summary: plan.summary, applied: 0, skipped: 0, failed: 0, rejected: true });
    setPlan(null);
  };

  const verified = config.noTraining === "verified";
  const contextLabel =
    scope === "selection" && selectedEntityName ? `selected: ${selectedEntityName}` : "whole model";

  return (
    <aside className="copilot">
      <div className="copilot__head">
        <span className="copilot__title">
          <Sparkles size={15} strokeWidth={1.8} aria-hidden /> Copilot
        </span>
        <div className="copilot__head-actions">
          <button className="icon-btn" title="Settings" aria-label="Copilot settings" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} />
          </button>
          <button className="icon-btn" title="Close" aria-label="Close Copilot" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      <button className="copilot__privacy" onClick={() => setShowSettings(true)} title="Open Copilot settings">
        {verified ? <ShieldCheck size={13} className="copilot__shield--ok" /> : <ShieldAlert size={13} className="copilot__shield--warn" />}
        <span className="field__hint">{noTrainingLabel(config.noTraining)}</span>
      </button>

      {showSettings && <CopilotSettings config={config} onChange={(c) => { setConfig(c); saveCopilotConfig(c); }} />}

      {!config.enabled ? (
        <p className="side__hint copilot__disabled">
          Copilot is off. Enable it in settings and add a provider. All modeling works without it.
        </p>
      ) : (
        <div className="copilot__body">
          <div className="copilot__context">
            <span className="copilot__context-label">Context</span>
            <div className="copilot__scope">
              <label className="chip-radio">
                <input type="radio" checked={scope === "model"} onChange={() => setScope("model")} /> Whole model
              </label>
              <label className="chip-radio">
                <input type="radio" checked={scope === "selection"} onChange={() => setScope("selection")} disabled={!selectedEntityName} /> Selected
              </label>
            </div>
            <p className="field__hint">
              Sends {contextLabel} ({level}): names, types, relationships{" "}
              {scope === "model" ? "for the whole model" : "for the selected object"} — never credentials or data rows.
            </p>
          </div>

          <div className="copilot__suggest">
            {suggestions(scope === "selection" ? selectedEntityName : null).map((sug) => (
              <button key={sug.label} className="chip" onClick={() => setDraft(sug.prompt)} title={sug.prompt}>
                {sug.label}
              </button>
            ))}
          </div>

          <textarea
            className="editor__input copilot__prompt"
            rows={3}
            placeholder="Describe what you want — e.g. “Write business descriptions for every table”.  ⌘↵ to send."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="copilot__composer-actions">
            <button className="btn btn--primary btn--small" onClick={send} disabled={busy || !draft.trim()}>
              <Send size={13} strokeWidth={1.8} aria-hidden /> {busy ? "Thinking…" : "Propose"}
            </button>
          </div>

          {status && <p className="field__hint field__hint--warn">{status}</p>}

          {plan && (
            <div className="copilot__plan">
              <p className="copilot__plan-summary">{plan.summary}</p>
              {hasDestructive(plan) && (
                <p className="field__hint field__hint--warn">⚠ This plan deletes objects — review carefully before approving.</p>
              )}
              {plan.assumptions.length > 0 && (
                <ul className="copilot__assumptions">
                  {plan.assumptions.map((a, i) => (
                    <li key={i} className="field__hint field__hint--warn">assumes: {a}</li>
                  ))}
                </ul>
              )}
              <ul className="copilot__actions">
                {plan.actions.map((a, i) => (
                  <li key={i}>{describeAction(a)}</li>
                ))}
                {plan.actions.length === 0 && <li className="field__hint">Read-only answer — no model changes.</li>}
              </ul>
              {plan.actions.length > 0 && (
                <div className="modal__actions">
                  <button className="btn btn--ghost btn--small" onClick={reject}>Reject</button>
                  <button className="btn btn--primary btn--small" onClick={apply}>
                    {requiresApproval(plan) ? "Approve & apply" : "Apply"}
                  </button>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="copilot__result">
              <p className="field__hint">
                Applied {result.applied} · skipped {result.skipped} · failed {result.failed}
                {result.validationErrors > 0 ? ` · ${result.validationErrors} validation error(s)` : ""}
              </p>
              <ul className="copilot__actions">
                {result.results.map((r, i) => (
                  <li key={i} className={r.status === "failed" ? "field__hint--warn" : ""}>
                    [{r.status}] {r.message}
                  </li>
                ))}
              </ul>
              <div className="modal__actions">
                <button className="btn btn--small" onClick={() => { undo(); setResult(null); }}>Undo</button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="copilot__history">
              <div className="copilot__history-head">
                <span className="copilot__context-label">Conversation</span>
                <button className="icon-btn" title="Clear history" aria-label="Clear history" onClick={clearHistory}>
                  <Trash2 size={13} />
                </button>
              </div>
              <ul className="copilot__history-list">
                {history.map((h) => (
                  <li key={h.id} className="copilot__history-item">
                    <div className="copilot__history-prompt">{h.prompt}</div>
                    <div className="field__hint">
                      {h.summary}
                      {" · "}
                      {h.rejected
                        ? "rejected"
                        : `applied ${h.applied}${h.skipped ? `, skipped ${h.skipped}` : ""}${h.failed ? `, failed ${h.failed}` : ""}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function describeAction(a: CopilotPlan["actions"][number]): string {
  switch (a.kind) {
    case "create_entity":
      return `+ table ${a.name}${a.fields?.length ? ` (${a.fields.map((f) => f.name).join(", ")})` : ""}`;
    case "update_description":
      return `✎ ${a.entity}${a.field ? `.${a.field}` : ""}: “${a.text.slice(0, 60)}${a.text.length > 60 ? "…" : ""}”`;
    case "create_relationship":
      return `→ ${a.parent} ${a.cardinality} ${a.child}`;
    case "create_attribute":
      return `+ column ${a.entity}.${a.name}${a.type ? ` (${a.type})` : ""}`;
    case "update_attribute":
      return `✎ column ${a.entity}.${a.field}${a.newName ? ` → ${a.newName}` : ""}${a.type ? ` (${a.type})` : ""}`;
    case "rename_entity":
      return `✎ rename ${a.entity} → ${a.newName}`;
    case "delete_entity":
      return `🗑 delete table ${a.entity}`;
    case "delete_attribute":
      return `🗑 delete column ${a.entity}.${a.field}`;
    case "delete_relationship":
      return `🗑 delete relationship ${a.parent}↔${a.child}`;
  }
}

function CopilotSettings({ config, onChange }: { config: CopilotConfig; onChange: (c: CopilotConfig) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const set = (patch: Partial<CopilotConfig>) => onChange({ ...config, ...patch });

  const provider = () =>
    new OpenAiCompatProvider({ baseUrl: config.baseUrl, model: config.model, secretRef: config.secretRef });

  const loadModels = async () => {
    setBusy(true);
    setSaved("Loading models…");
    try {
      const list = await provider().listModels();
      setModels(list);
      // If the current model isn't actually available, pick a real one so the
      // user can't be stuck on a non-existent model id.
      if (list.length && !list.includes(config.model)) {
        set({ model: list[0] });
        setSaved(`${list.length} models available — selected “${list[0]}”.`);
      } else {
        setSaved(`${list.length} models available.`);
      }
    } catch (e) {
      setSaved(`✕ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    const key = apiKey.trim(); // paste often brings trailing whitespace/newlines
    if (!key) return;
    await secretStore(config.secretRef, key);
    setApiKey("");
    setSaved(`API key saved to the OS keychain (${key.length} chars).`);
  };

  const testConnection = async () => {
    setBusy(true);
    setSaved("Testing…");
    const res = await provider().testConnection();
    setSaved(res.ok ? `✓ ${res.message}` : `✕ ${res.message}`);
    setBusy(false);
  };

  return (
    <div className="copilot__settings">
      <label className="checkbox">
        <input type="checkbox" checked={config.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enable Copilot
      </label>
      <div className="field">
        <label>Base URL</label>
        <input value={config.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
      </div>
      <div className="field">
        <label>Model</label>
        {models.length > 0 ? (
          <select value={config.model} onChange={(e) => set({ model: e.target.value })}>
            {!models.includes(config.model) && <option value={config.model}>{config.model}</option>}
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input value={config.model} onChange={(e) => set({ model: e.target.value })} />
        )}
        <button className="btn btn--small" onClick={loadModels} disabled={busy}>Load available models</button>
      </div>
      <div className="field">
        <label>API key (stored in keychain)</label>
        <input type="password" placeholder="sk-… / gsk_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <div className="modal__actions">
          <button className="btn btn--small" onClick={saveKey} disabled={!apiKey.trim()}>Save key</button>
          <button className="btn btn--small" onClick={testConnection} disabled={busy}>Test connection</button>
        </div>
      </div>
      <div className="field">
        <label>No-training status</label>
        <select value={config.noTraining} onChange={(e) => set({ noTraining: e.target.value as CopilotConfig["noTraining"] })}>
          <option value="unverified">Unverified</option>
          <option value="verified">Verified for my account/API</option>
          <option value="unsupported">Unsupported</option>
        </select>
      </div>
      <div className="field">
        <label>Privacy policy</label>
        <select value={config.privacyPolicy} onChange={(e) => set({ privacyPolicy: e.target.value as CopilotConfig["privacyPolicy"] })}>
          <option value="require-verified">Require verified no-training (block otherwise)</option>
          <option value="allow-unverified">Allow sending to unverified providers</option>
        </select>
      </div>
      {saved && <p className="field__hint">{saved}</p>}
      <p className="field__hint">
        Keys live only in the keychain. Model names/descriptions are treated as confidential and only sent on your request.
      </p>
    </div>
  );
}
