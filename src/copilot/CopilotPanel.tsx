import { useState } from "react";
import { Sparkles, ShieldCheck, ShieldAlert, Settings2, X } from "lucide-react";
import { useModelStore } from "../store/modelStore";
import { secretStore } from "../lib/secrets";
import {
  type CopilotConfig,
  loadCopilotConfig,
  saveCopilotConfig,
} from "./settings";
import { noTrainingLabel, sensitiveCategories } from "./privacy";
import { OpenAiCompatProvider, type Provider } from "./provider";
import { buildContext, type ContextScope } from "./context";
import { requestPlan } from "./orchestrate";
import { type CopilotPlan, requiresApproval } from "./actions";
import { executePlan, type PlanResult } from "./execute";

// The optional AI Modeling Copilot drawer (§14.7). Proposes a structured plan the
// user reviews and approves; applying it reuses the existing modeling command
// layer and undo/redo. Copilot is entirely optional — nothing here runs unless
// the user enables it and sends a request.
export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<CopilotConfig>(loadCopilotConfig());
  const [showSettings, setShowSettings] = useState(!config.enabled);
  const [scope, setScope] = useState<ContextScope>("model");
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<CopilotPlan | null>(null);
  const [planBase, setPlanBase] = useState<string>("");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selection = useModelStore((s) => s.selection);
  const undo = useModelStore((s) => s.undo);

  const provider = (): Provider =>
    new OpenAiCompatProvider({ baseUrl: config.baseUrl, model: config.model, secretRef: config.secretRef });

  const send = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setStatus(null);
    setPlan(null);
    setResult(null);
    try {
      const model = useModelStore.getState().model;
      const selId = selection?.kind === "entity" ? selection.id : null;
      const ctx = buildContext(model, scope, selId);
      const res = await requestPlan(provider(), prompt, ctx, {
        policy: config.privacyPolicy,
        status: config.noTraining,
      });
      if (res.blocked) setStatus(`Blocked by privacy policy: ${res.blocked}`);
      else if (res.error) setStatus(res.error);
      else if (res.plan) {
        setPlan(res.plan);
        setPlanBase(model.updatedAt); // conflict check at apply time
        if (res.plan.actions.length === 0) setStatus("No changes proposed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!plan) return;
    // Conflict detection (§14.9): don't apply against a model that changed since
    // the plan was generated.
    if (useModelStore.getState().model.updatedAt !== planBase) {
      setStatus("The model changed since this plan was generated — please re-send.");
      setPlan(null);
      return;
    }
    const res = executePlan(plan);
    setResult(res);
    setPlan(null);
    setStatus(null);
  };

  const sensitive = sensitiveCategories().map((c) => c.label).join(", ");
  const verified = config.noTraining === "verified";

  return (
    <aside className="copilot">
      <div className="copilot__head">
        <span className="copilot__title">
          <Sparkles size={15} strokeWidth={1.8} /> Copilot
        </span>
        <div className="copilot__head-actions">
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} />
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="copilot__status">
        {verified ? <ShieldCheck size={13} className="copilot__shield--ok" /> : <ShieldAlert size={13} className="copilot__shield--warn" />}
        <span className="field__hint">{noTrainingLabel(config.noTraining)}</span>
      </div>

      {showSettings && <CopilotSettings config={config} onChange={(c) => { setConfig(c); saveCopilotConfig(c); }} />}

      {!config.enabled ? (
        <p className="side__hint copilot__disabled">
          Copilot is off. Enable it in settings and add a provider. All modeling works without it.
        </p>
      ) : (
        <div className="copilot__body">
          <div className="copilot__scope">
            <label className="checkbox">
              <input type="radio" checked={scope === "model"} onChange={() => setScope("model")} /> Whole model
            </label>
            <label className="checkbox">
              <input type="radio" checked={scope === "selection"} onChange={() => setScope("selection")} /> Selected
            </label>
          </div>
          <p className="field__hint">Sends: {sensitive} + types & relationships for the chosen scope.</p>

          <textarea
            className="editor__input copilot__prompt"
            rows={3}
            placeholder="e.g. Write clear business descriptions for every entity"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="modal__actions">
            <button className="btn btn--primary btn--small" onClick={send} disabled={busy || !prompt.trim()}>
              {busy ? "Thinking…" : "Propose"}
            </button>
          </div>

          {status && <p className="field__hint field__hint--warn">{status}</p>}

          {plan && (
            <div className="copilot__plan">
              <p className="copilot__plan-summary">{plan.summary}</p>
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
                {plan.actions.length === 0 && <li className="field__hint">No mutating actions.</li>}
              </ul>
              {plan.actions.length > 0 && (
                <div className="modal__actions">
                  <button className="btn btn--ghost btn--small" onClick={() => setPlan(null)}>Reject</button>
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
        </div>
      )}
    </aside>
  );
}

function describeAction(a: CopilotPlan["actions"][number]): string {
  switch (a.kind) {
    case "create_entity":
      return `+ ${a.name}${a.fields?.length ? ` (${a.fields.map((f) => f.name).join(", ")})` : ""}`;
    case "update_description":
      return `✎ ${a.entity}${a.field ? `.${a.field}` : ""}: “${a.text.slice(0, 60)}${a.text.length > 60 ? "…" : ""}”`;
    case "create_relationship":
      return `→ ${a.parent} ${a.cardinality} ${a.child}`;
  }
}

function CopilotSettings({ config, onChange }: { config: CopilotConfig; onChange: (c: CopilotConfig) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<CopilotConfig>) => onChange({ ...config, ...patch });

  const saveKey = async () => {
    if (!apiKey) return;
    await secretStore(config.secretRef, apiKey);
    setApiKey("");
    setSaved("API key saved to the OS keychain.");
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
        <input value={config.model} onChange={(e) => set({ model: e.target.value })} />
      </div>
      <div className="field">
        <label>API key (stored in keychain)</label>
        <input type="password" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button className="btn btn--small" onClick={saveKey} disabled={!apiKey}>Save key</button>
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
