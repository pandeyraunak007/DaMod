import { useState } from "react";
import { useModelStore } from "../store/modelStore";
import { DATA_TYPE_KINDS, paramShape, type DataTypeKind } from "../model/dataTypes";
import { LOGICAL_TYPE_KINDS } from "../model/levels";
import { validateIdentifier } from "../model/identifiers";
import type { Domain } from "../model/model";

// Manager for reusable named types (ERwin domains). Authored once and bound to
// fields from the entity Properties dialog; editing a domain here propagates its
// type to every field that uses it.
export function DomainsDialog({ onClose }: { onClose: () => void }) {
  const domains = useModelStore((s) => s.model.domains ?? []);
  const entities = useModelStore((s) => s.model.entities);
  const createDomain = useModelStore((s) => s.createDomain);
  const [openId, setOpenId] = useState<string | null>(domains[0]?.id ?? null);

  const usageCount = (domainId: string) =>
    entities.reduce((n, e) => n + e.fields.filter((f) => f.domainId === domainId).length, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--props" onClick={(e) => e.stopPropagation()}>
        <div className="props__head">
          <h2 className="modal__title">Domains — reusable types</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="props__body">
          {domains.length === 0 && (
            <p className="side__hint">
              No domains yet. Create one, then bind fields to it from an entity's Fields tab.
            </p>
          )}
          {domains.map((d) => (
            <div key={d.id} className="props__field">
              <button
                className="props__field-head"
                onClick={() => setOpenId(openId === d.id ? null : d.id)}
              >
                <span>{openId === d.id ? "▾" : "▸"}</span>
                <strong>{d.name}</strong>
                <span className="field__hint">
                  {d.type}
                  {usageCount(d.id) > 0 ? ` · ${usageCount(d.id)} field(s)` : ""}
                </span>
              </button>
              {openId === d.id && <DomainProps domain={d} usage={usageCount(d.id)} />}
            </div>
          ))}
          <button
            className="btn btn--small"
            onClick={() => setOpenId(createDomain())}
          >
            + Domain
          </button>
        </div>
      </div>
    </div>
  );
}

function DomainProps({ domain, usage }: { domain: Domain; usage: number }) {
  const updateDomain = useModelStore((s) => s.updateDomain);
  const deleteDomain = useModelStore((s) => s.deleteDomain);
  const patch = (p: Partial<Domain>) => updateDomain(domain.id, p);
  const shape = paramShape(domain.type);

  return (
    <div className="props__field-body">
      <div className="attr-row">
        <input
          defaultValue={domain.name}
          onChange={(e) => !validateIdentifier(e.target.value) && patch({ name: e.target.value })}
        />
        <select value={domain.type} onChange={(e) => patch({ type: e.target.value as DataTypeKind })}>
          {DATA_TYPE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      {shape === "length" && (
        <label className="field-row__params">
          length
          <input
            type="number"
            value={domain.length ?? 255}
            onChange={(e) => patch({ length: Number(e.target.value) })}
          />
        </label>
      )}
      {shape === "decimal" && (
        <div className="field-row__params">
          <label>
            precision
            <input
              type="number"
              value={domain.precision ?? 12}
              onChange={(e) => patch({ precision: Number(e.target.value) })}
            />
          </label>
          <label>
            scale
            <input
              type="number"
              value={domain.scale ?? 2}
              onChange={(e) => patch({ scale: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
      <div className="field">
        <label>Logical type (optional)</label>
        <select
          value={domain.logicalType ?? ""}
          onChange={(e) => patch({ logicalType: (e.target.value || undefined) as Domain["logicalType"] })}
        >
          <option value="">— none —</option>
          {LOGICAL_TYPE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Default (SQL)</label>
        <input
          defaultValue={domain.default ?? ""}
          onChange={(e) => patch({ default: e.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label>Definition</label>
        <textarea
          rows={2}
          defaultValue={domain.description ?? ""}
          onChange={(e) => patch({ description: e.target.value || undefined })}
        />
      </div>
      <div className="modal__actions">
        <button className="btn btn--danger btn--small" onClick={() => deleteDomain(domain.id)}>
          Delete domain
        </button>
      </div>
      <p className="field__hint">
        {usage > 0
          ? `Changing this type updates ${usage} bound field(s). Deleting unbinds them (they keep this type).`
          : "Not used by any field yet."}
      </p>
    </div>
  );
}
