import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import { previewNaming, mirrorsForeignKeys, type NamingStandard } from "../model/model";
import { NAME_CASES, NAMING_TARGETS, type NamingRule } from "../model/naming";

// Manager for Naming Standards (Phase 2 Slice C). Define reusable identifier rules,
// see a live compliance preview (read-only), and apply through the store as one undo
// step. Mirrors DomainsDialog's shape. Checking never mutates; Apply is explicit.
export function NamingStandardsDialog({ onClose }: { onClose: () => void }) {
  // Default OUTSIDE the selector (avoid the getSnapshot loop; CLAUDE.md §5.1).
  const standards = useModelStore((s) => s.model.namingStandards) ?? [];
  const createNamingStandard = useModelStore((s) => s.createNamingStandard);
  const [openId, setOpenId] = useState<string | null>(standards[0]?.id ?? null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--props" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Naming standards</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="props__body">
          {standards.length === 0 && (
            <p className="side__hint">
              No naming standards yet. Create one, add rules (e.g. snake_case columns,
              dim_ prefix on tables), preview, then apply.
            </p>
          )}
          {standards.map((std) => (
            <div key={std.id} className="props__field">
              <button
                className="props__field-head"
                onClick={() => setOpenId(openId === std.id ? null : std.id)}
              >
                <span>{openId === std.id ? "▾" : "▸"}</span>
                <strong>{std.name}</strong>
                <span className="field__hint">{std.rules.length} rule(s)</span>
              </button>
              {openId === std.id && <StandardEditor std={std} />}
            </div>
          ))}
          <button className="btn btn--small" onClick={() => setOpenId(createNamingStandard())}>
            + Standard
          </button>
        </div>
      </div>
    </div>
  );
}

function StandardEditor({ std }: { std: NamingStandard }) {
  const update = useModelStore((s) => s.updateNamingStandard);
  const del = useModelStore((s) => s.deleteNamingStandard);
  const apply = useModelStore((s) => s.applyNamingStandard);
  const pushNotice = useModelStore((s) => s.pushNotice);
  // Live preview reads the current model; pure, no mutation.
  const model = useModelStore((s) => s.model);
  const preview = previewNaming(model, std);

  const setRule = (i: number, patch: Partial<NamingRule>) =>
    update(std.id, { rules: std.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = () =>
    update(std.id, { rules: [...std.rules, { target: "attribute", case: "snake_case" }] });
  const removeRule = (i: number) =>
    update(std.id, { rules: std.rules.filter((_, j) => j !== i) });

  const doApply = () => {
    const r = apply(std.id);
    pushNotice(
      `Applied ${r.applied} rename(s)` +
        (r.skipped ? ` · skipped ${r.skipped}` : "") +
        (r.collisions ? ` · ${r.collisions} collision(s)` : ""),
    );
  };

  return (
    <div className="props__field-body">
      <div className="field">
        <label>Name</label>
        <input defaultValue={std.name} onChange={(e) => update(std.id, { name: e.target.value })} />
      </div>
      <div className="field">
        <label>Description</label>
        <input defaultValue={std.description ?? ""} onChange={(e) => update(std.id, { description: e.target.value || undefined })} />
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={mirrorsForeignKeys(std)}
          onChange={(e) => update(std.id, { mirrorForeignKeys: e.target.checked })}
        />
        Keep foreign-key columns in sync with their parent primary key
      </label>

      <div className="field">
        <label>Rules</label>
        {std.rules.length === 0 && <p className="field__hint">No rules yet.</p>}
        {std.rules.map((r, i) => (
          <div key={i} className="attr-row">
            <select value={r.target} onChange={(e) => setRule(i, { target: e.target.value as NamingRule["target"] })}>
              {NAMING_TARGETS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={r.case} onChange={(e) => setRule(i, { case: e.target.value as NamingRule["case"] })}>
              {NAME_CASES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input placeholder="prefix" value={r.prefix ?? ""} onChange={(e) => setRule(i, { prefix: e.target.value || undefined })} />
            <input placeholder="suffix" value={r.suffix ?? ""} onChange={(e) => setRule(i, { suffix: e.target.value || undefined })} />
            <input
              type="number"
              placeholder="max len"
              value={r.maxLength ?? ""}
              onChange={(e) => setRule(i, { maxLength: e.target.value ? Number(e.target.value) : undefined })}
            />
            <button className="field-row__del" title="Remove rule" onClick={() => removeRule(i)}>✕</button>
          </div>
        ))}
        <button className="btn btn--small" onClick={addRule}>+ Rule</button>
      </div>

      <div className="field">
        <label>
          Preview — {preview.changes.length} change(s)
          {preview.collisions.length ? `, ${preview.collisions.length} collision(s)` : ""}
        </label>
        {preview.collisions.length > 0 && (
          <ul className="whereused">
            {preview.collisions.map((c, i) => (
              <li key={i} className="whereused__row field__hint--warn">
                <span>⚠ {c.scope}: “{c.name}” ← {c.members.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="whereused">
          {preview.changes.slice(0, 60).map((c, i) => (
            <li key={i} className="whereused__row">
              <span>
                {c.from} → {c.to}
                {c.mirrored ? " (mirrors PK)" : ""}
              </span>
            </li>
          ))}
          {preview.changes.length > 60 && (
            <li className="whereused__row field__hint">…and {preview.changes.length - 60} more</li>
          )}
        </ul>
        {preview.changes.length === 0 && <p className="field__hint">Model already conforms.</p>}
      </div>

      <div className="modal__actions">
        <button className="btn btn--danger btn--small" onClick={() => del(std.id)}>Delete standard</button>
        <button className="btn btn--primary btn--small" disabled={preview.changes.length === 0} onClick={doApply}>
          Apply to model
        </button>
      </div>
    </div>
  );
}
