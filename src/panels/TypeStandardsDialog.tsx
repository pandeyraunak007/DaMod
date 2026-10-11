import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import { checkTypes, lossyTypeWarnings, type TypeStandard } from "../model/model";
import { DATA_TYPE_KINDS, paramShape, formatType, type DataTypeKind } from "../model/dataTypes";
import type { TypeRule } from "../model/typeStandards";

// Manager for Data Type Standards (Phase 3 Slice B). Define per-type parameter
// policies, see a live read-only compliance preview + dialect lossy-mapping warnings,
// and apply through the store as one undo step. Mirrors NamingStandardsDialog.
export function TypeStandardsDialog({ onClose }: { onClose: () => void }) {
  const standards = useModelStore((s) => s.model.typeStandards) ?? [];
  const createTypeStandard = useModelStore((s) => s.createTypeStandard);
  const [openId, setOpenId] = useState<string | null>(standards[0]?.id ?? null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--props" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Data type standards</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="props__body">
          {standards.length === 0 && (
            <p className="side__hint">
              No type standards yet. Create one, add per-type parameter rules (e.g.
              decimal → (15,2), string → 100), preview, then apply.
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
          <button className="btn btn--small" onClick={() => setOpenId(createTypeStandard())}>
            + Standard
          </button>
        </div>
      </div>
    </div>
  );
}

function StandardEditor({ std }: { std: TypeStandard }) {
  const update = useModelStore((s) => s.updateTypeStandard);
  const del = useModelStore((s) => s.deleteTypeStandard);
  const apply = useModelStore((s) => s.applyTypeStandard);
  const pushNotice = useModelStore((s) => s.pushNotice);
  const model = useModelStore((s) => s.model);

  const violations = checkTypes(model, std);
  const lossy = lossyTypeWarnings(model);

  const setRule = (i: number, patch: Partial<TypeRule>) =>
    update(std.id, { rules: std.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = () => update(std.id, { rules: [...std.rules, { type: "string", length: 100 }] });
  const removeRule = (i: number) => update(std.id, { rules: std.rules.filter((_, j) => j !== i) });

  const doApply = () => {
    const r = apply(std.id);
    pushNotice(r.applied ? `Normalised ${r.applied} column(s)` : "Nothing to change — model conforms.");
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

      <div className="field">
        <label>Rules (per canonical type)</label>
        {std.rules.length === 0 && <p className="field__hint">No rules yet.</p>}
        {std.rules.map((r, i) => {
          const shape = paramShape(r.type);
          return (
            <div key={i} className="attr-row">
              <select value={r.type} onChange={(e) => setRule(i, { type: e.target.value as DataTypeKind })}>
                {DATA_TYPE_KINDS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {shape === "length" && (
                <input type="number" placeholder="length" value={r.length ?? ""} onChange={(e) => setRule(i, { length: e.target.value ? Number(e.target.value) : undefined })} />
              )}
              {shape === "decimal" && (
                <>
                  <input type="number" placeholder="precision" value={r.precision ?? ""} onChange={(e) => setRule(i, { precision: e.target.value ? Number(e.target.value) : undefined })} />
                  <input type="number" placeholder="scale" value={r.scale ?? ""} onChange={(e) => setRule(i, { scale: e.target.value ? Number(e.target.value) : undefined })} />
                </>
              )}
              {shape === "none" && <span className="field__hint">no parameters</span>}
              <button className="field-row__del" title="Remove rule" onClick={() => removeRule(i)}>✕</button>
            </div>
          );
        })}
        <button className="btn btn--small" onClick={addRule}>+ Rule</button>
      </div>

      <div className="field">
        <label>Preview — {violations.length} column(s) off-standard</label>
        <ul className="whereused">
          {violations.slice(0, 60).map((v, i) => (
            <li key={i} className="whereused__row">
              <span>{v.fieldName}: {formatType(v.current)} → {formatType(v.proposed)}</span>
            </li>
          ))}
        </ul>
        {violations.length === 0 && <p className="field__hint">All columns conform.</p>}
      </div>

      {lossy.length > 0 && (
        <div className="field">
          <label>Lossy mappings for {model.dialect ?? "postgres"} ({lossy.length})</label>
          <ul className="whereused">
            {lossy.slice(0, 30).map((w, i) => (
              <li key={i} className="whereused__row field__hint--warn">
                <span>⚠ {w.fieldName} ({w.type}): {w.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="modal__actions">
        <button className="btn btn--danger btn--small" onClick={() => del(std.id)}>Delete standard</button>
        <button className="btn btn--primary btn--small" disabled={violations.length === 0} onClick={doApply}>
          Apply to model
        </button>
      </div>
    </div>
  );
}
