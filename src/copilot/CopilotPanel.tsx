import { useEffect, useRef, useState } from "react";
import { Sparkles, ShieldCheck, ShieldAlert, Settings2, X, Send, Trash2 } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
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
import { type CopilotPlan, requiresApproval } from "./actions";
import { executePlan } from "./execute";
import { useCopilotSession, type Message, type PlanMessage } from "./session";

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
  const [busy, setBusy] = useState(false);

  // Thread + draft live in a session store so they survive collapse/reopen.
  const draft = useCopilotSession((s) => s.draft);
  const setDraft = useCopilotSession((s) => s.setDraft);
  const messages = useCopilotSession((s) => s.messages);
  const push = useCopilotSession((s) => s.push);
  const update = useCopilotSession((s) => s.update);
  const clear = useCopilotSession((s) => s.clear);

  const selection = useModelStore((s) => s.selection);
  const selectedEntityName = useModelStore((s) =>
    selection?.kind === "entity" ? s.model.entities.find((e) => e.id === selection.id)?.name ?? null : null,
  );
  const level = useModelStore((s) => s.model.level);
  const undo = useModelStore((s) => s.undo);

  // Auto-scroll the thread to the latest message (chat behaviour).
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const provider = (): Provider =>
    new OpenAiCompatProvider({ baseUrl: config.baseUrl, model: config.model, secretRef: config.secretRef });

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    push({ id: newId("field"), role: "user", text });
    setDraft("");
    setBusy(true);
    try {
      const model = useModelStore.getState().model;
      const selId = scope === "selection" && selection?.kind === "entity" ? selection.id : null;
      const ctx = buildContext(model, scope, selId, useWorkspaceStore.getState().semantic);
      const res = await requestPlan(provider(), text, ctx, {
        policy: config.privacyPolicy,
        status: config.noTraining,
      });
      if (res.blocked) push({ id: newId("field"), role: "assistant", kind: "blocked", text: res.blocked });
      else if (res.error) push({ id: newId("field"), role: "assistant", kind: "error", text: res.error });
      else if (res.plan && res.plan.actions.length === 0) {
        push({ id: newId("field"), role: "assistant", kind: "answer", text: res.plan.summary });
      } else if (res.plan) {
        push({
          id: newId("field"),
          role: "assistant",
          kind: "plan",
          summary: res.plan.summary,
          assumptions: res.plan.assumptions,
          actions: res.plan.actions,
          planBase: model.updatedAt,
          status: "pending",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const approve = (m: PlanMessage) => {
    if (useModelStore.getState().model.updatedAt !== m.planBase) {
      update(m.id, { status: "rejected" });
      push({ id: newId("field"), role: "assistant", kind: "error", text: "The model changed since this plan was proposed — please ask again." });
      return;
    }
    const res = executePlan({ summary: m.summary, assumptions: m.assumptions, actions: m.actions });
    update(m.id, { status: "applied", result: res });
  };

  const verified = config.noTraining === "verified";
  const contextLabel =
    scope === "selection" && selectedEntityName ? `Selected: ${selectedEntityName}` : "Whole model";

  return (
    <aside className="copilot copilot--chat">
      <div className="copilot__head">
        <span className="copilot__title">
          <Sparkles size={15} strokeWidth={1.8} aria-hidden /> Copilot
        </span>
        <div className="copilot__head-actions">
          {messages.length > 0 && (
            <button className="icon-btn" title="Clear conversation" aria-label="Clear conversation" onClick={clear}>
              <Trash2 size={14} />
            </button>
          )}
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
        <>
          <div className="copilot__thread" ref={threadRef}>
            {messages.length === 0 ? (
              <div className="copilot__empty">
                <Sparkles size={22} strokeWidth={1.5} className="copilot__empty-icon" />
                <p className="copilot__empty-title">Ask me to build or document your model</p>
                <p className="field__hint">I’ll propose changes for you to review and apply.</p>
                <div className="copilot__suggest">
                  {suggestions(scope === "selection" ? selectedEntityName : null).map((sug) => (
                    <button key={sug.label} className="chip" onClick={() => setDraft(sug.prompt)} title={sug.prompt}>
                      {sug.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <MessageView key={m.id} message={m} onApprove={approve} onReject={(id) => update(id, { status: "rejected" })} onUndo={undo} />
              ))
            )}
            {busy && (
              <div className="copilot__msg copilot__msg--assistant">
                <div className="copilot__bubble copilot__typing">Thinking…</div>
              </div>
            )}
          </div>

          <div className="copilot__composer">
            <div className="copilot__composer-ctx">
              <label className="chip-radio">
                <input type="radio" checked={scope === "model"} onChange={() => setScope("model")} /> Whole model
              </label>
              <label className="chip-radio">
                <input type="radio" checked={scope === "selection"} onChange={() => setScope("selection")} disabled={!selectedEntityName} /> Selected
              </label>
              <span className="field__hint copilot__ctx-hint" title="Only this is sent — never credentials or data rows">
                {contextLabel} · {level}
              </span>
            </div>
            <div className="copilot__inputrow">
              <textarea
                className="copilot__input"
                rows={2}
                placeholder="Message Copilot…  (⌘↵ to send)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button className="copilot__send" onClick={send} disabled={busy || !draft.trim()} title="Send (⌘↵)" aria-label="Send">
                <Send size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function MessageView({
  message,
  onApprove,
  onReject,
  onUndo,
}: {
  message: Message;
  onApprove: (m: PlanMessage) => void;
  onReject: (id: string) => void;
  onUndo: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="copilot__msg copilot__msg--user">
        <div className="copilot__bubble copilot__bubble--user">{message.text}</div>
      </div>
    );
  }
  if (message.kind === "answer") {
    return (
      <div className="copilot__msg copilot__msg--assistant">
        <div className="copilot__bubble">{message.text}</div>
      </div>
    );
  }
  if (message.kind === "error" || message.kind === "blocked") {
    return (
      <div className="copilot__msg copilot__msg--assistant">
        <div className="copilot__bubble copilot__bubble--error">
          {message.kind === "blocked" ? "Blocked by privacy policy: " : ""}
          {message.text}
        </div>
      </div>
    );
  }
  if (message.kind !== "plan") return null;
  // plan message
  const destructive = message.actions.some(
    (a) => a.kind === "delete_entity" || a.kind === "delete_attribute" || a.kind === "delete_relationship",
  );
  return (
    <div className="copilot__msg copilot__msg--assistant">
      <div className="copilot__bubble copilot__bubble--plan">
        <p className="copilot__plan-summary">{message.summary}</p>
        {destructive && <p className="field__hint field__hint--warn">⚠ Deletes objects — review before approving.</p>}
        {message.assumptions.length > 0 && (
          <ul className="copilot__assumptions">
            {message.assumptions.map((a, i) => (
              <li key={i} className="field__hint field__hint--warn">assumes: {a}</li>
            ))}
          </ul>
        )}
        <ul className="copilot__actions">
          {message.actions.map((a, i) => (
            <li key={i}>{describeAction(a)}</li>
          ))}
        </ul>

        {message.status === "pending" && (
          <div className="modal__actions">
            <button className="btn btn--ghost btn--small" onClick={() => onReject(message.id)}>Reject</button>
            <button className="btn btn--primary btn--small" onClick={() => onApprove(message)}>
              {requiresApproval({ summary: message.summary, assumptions: message.assumptions, actions: message.actions }) ? "Approve & apply" : "Apply"}
            </button>
          </div>
        )}
        {message.status === "rejected" && <p className="field__hint">Rejected — model unchanged.</p>}
        {message.status === "applied" && message.result && (
          <div className="copilot__applied">
            <p className="field__hint">
              ✓ Applied {message.result.applied}
              {message.result.skipped ? ` · skipped ${message.result.skipped}` : ""}
              {message.result.failed ? ` · failed ${message.result.failed}` : ""}
              {message.result.validationErrors > 0 ? ` · ${message.result.validationErrors} validation error(s)` : ""}
            </p>
            {message.result.results.some((r) => r.status === "failed") && (
              <ul className="copilot__actions">
                {message.result.results.filter((r) => r.status === "failed").map((r, i) => (
                  <li key={i} className="field__hint--warn">{r.message}</li>
                ))}
              </ul>
            )}
            <button className="btn btn--small" onClick={onUndo}>Undo</button>
          </div>
        )}
      </div>
    </div>
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
    case "create_subject_area":
      return `▦ subject area ${a.name}${a.product ? ` (from ${a.product})` : a.tables?.length ? ` (${a.tables.length} tables)` : ""}`;
    case "create_schema":
      return `+ schema ${a.name}`;
    case "create_view":
      return `+ ${a.materialized ? "materialized view" : "view"} ${a.name}`;
    case "create_index":
      return `+ index on ${a.entity}${a.columns?.length ? ` (${a.columns.join(", ")})` : ""}`;
    case "create_sequence":
      return `+ sequence ${a.name}`;
    case "create_domain":
      return `+ domain ${a.name}${a.type ? ` (${a.type})` : ""}`;
    case "bind_domain":
      return `◉ bind domain ${a.domain} → ${a.attribute ? `${a.entity}.${a.attribute}` : a.entity ? `all columns of ${a.entity}` : "all columns"}`;
    case "create_check_constraint":
      return `+ check on ${a.entity}: ${a.expression}`;
    case "set_stereotype":
      return `✎ ${a.entity} stereotype → ${a.stereotype}`;
    case "create_term":
      return `+ term ${a.name}`;
    case "create_dimension":
      return `+ dimension ${a.name}${a.entity ? ` (${a.entity})` : ""}`;
    case "create_metric":
      return `+ metric ${a.name}${a.aggregate ? ` (${a.aggregate}${a.field ? ` ${a.entity}.${a.field}` : ""})` : ""}`;
    case "create_snowflake_object":
      return `+ ${a.objectKind} ${a.name}`;
    case "create_governance_object":
      return `+ ${a.objectKind} ${a.name}`;
    case "create_naming_standard":
      return `+ naming standard ${a.name} (${a.rules.length} rule${a.rules.length === 1 ? "" : "s"})`;
    case "apply_naming_standard":
      return `▶ apply naming standard ${a.name}`;
    case "create_type_standard":
      return `+ type standard ${a.name} (${a.rules.length} rule${a.rules.length === 1 ? "" : "s"})`;
    case "apply_type_standard":
      return `▶ apply type standard ${a.name}`;
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
