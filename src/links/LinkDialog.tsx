import { useMemo, useState } from "react";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  type FieldMapping,
  type LinkType,
  type Ref,
  newLink,
  proposeFieldMappings,
} from "./links";

// Create a cross-model link from an entity or field (FR-6.1). Same-as links get a
// proposed field mapping the author can edit (FR-6.2).
export function LinkDialog({ from, onClose }: { from: Ref; onClose: () => void }) {
  const activeModel = useModelStore((s) => s.model);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const addLinkAction = useWorkspaceStore((s) => s.addLink);

  const models = allModels();
  const fromIsField = !!from.field;
  const fromEntity = activeModel.entities.find((e) => e.id === from.entity);

  const targets = models.filter((m) => m.id !== from.model);

  const linkTypes: LinkType[] = fromIsField ? ["references", "derived-from"] : ["same-as"];
  const [type, setType] = useState<LinkType>(linkTypes[0]);
  const [targetModelId, setTargetModelId] = useState(targets[0]?.id ?? "");
  const targetModel = models.find((m) => m.id === targetModelId)?.model;
  const [targetEntityId, setTargetEntityId] = useState(targetModel?.entities[0]?.id ?? "");
  const [targetFieldId, setTargetFieldId] = useState("");

  const targetEntity = targetModel?.entities.find((e) => e.id === targetEntityId);

  // Proposed field mappings for a same-as link.
  const proposed = useMemo<FieldMapping[]>(() => {
    if (type !== "same-as" || !targetModel || !targetEntity || !fromEntity) return [];
    return proposeFieldMappings(activeModel, from.entity, targetModel, targetEntity.id);
  }, [type, targetModel, targetEntity, fromEntity, activeModel, from.entity]);
  const [mappings, setMappings] = useState<FieldMapping[] | null>(null);
  const effectiveMappings = mappings ?? proposed;

  if (!fromEntity || targets.length === 0) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal modal--small" onClick={(e) => e.stopPropagation()}>
          <h2 className="modal__title">Can't create a link</h2>
          <p className="modal__text">
            A link connects two different models. Create another model first.
          </p>
          <div className="modal__actions">
            <button className="btn btn--primary" onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fromField = from.field
    ? fromEntity.fields.find((f) => f.id === from.field)
    : undefined;
  const fromLabel = from.field
    ? `${fromEntity.name}.${fromField?.name ?? "?"}`
    : fromEntity.name;

  const changeTargetModel = (id: string) => {
    setTargetModelId(id);
    const m = models.find((x) => x.id === id)?.model;
    setTargetEntityId(m?.entities[0]?.id ?? "");
    setTargetFieldId("");
    setMappings(null);
  };

  const submit = () => {
    if (!targetEntity) return;
    const to: Ref = { model: targetModelId, entity: targetEntityId };
    if (type === "derived-from") {
      if (!targetFieldId) return;
      to.field = targetFieldId;
    }
    const link =
      type === "same-as"
        ? newLink("same-as", from, to, effectiveMappings)
        : newLink(type, from, to);
    addLinkAction(link);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">New link from {fromLabel}</h2>

        <div className="field">
          <label>Link type</label>
          <select value={type} onChange={(e) => setType(e.target.value as LinkType)}>
            {linkTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <p className="field__hint">
            {type === "same-as" && "Both entities represent the same real-world thing."}
            {type === "references" && "This field is a foreign key to an entity in another model."}
            {type === "derived-from" && "This field is computed from another field (lineage only)."}
          </p>
        </div>

        <div className="modal__row modal__row--pair">
          <div className="field">
            <label>Target model</label>
            <select value={targetModelId} onChange={(e) => changeTargetModel(e.target.value)}>
              {targets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Target entity</label>
            <select
              value={targetEntityId}
              onChange={(e) => {
                setTargetEntityId(e.target.value);
                setTargetFieldId("");
                setMappings(null);
              }}
            >
              {targetModel?.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {type === "derived-from" && targetEntity && (
          <div className="field">
            <label>Target field</label>
            <select value={targetFieldId} onChange={(e) => setTargetFieldId(e.target.value)}>
              <option value="">Choose…</option>
              {targetEntity.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === "same-as" && targetEntity && (
          <div className="field">
            <label>Field mappings (proposed)</label>
            <div className="mappings">
              {effectiveMappings.length === 0 && (
                <p className="field__hint">No matching field names. Add pairs below.</p>
              )}
              {effectiveMappings.map((m, i) => {
                const ff = fromEntity.fields.find((f) => f.id === m.from);
                const tf = targetEntity.fields.find((f) => f.id === m.to);
                return (
                  <div key={i} className="mappings__row">
                    <span>{ff?.name ?? "?"}</span>
                    <span className="mappings__arrow">↔</span>
                    <span>{tf?.name ?? "?"}</span>
                    <button
                      className="field-row__del"
                      onClick={() =>
                        setMappings(effectiveMappings.filter((_, j) => j !== i))
                      }
                      title="Remove pair"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <AddMapping
                fromFields={fromEntity.fields.map((f) => ({ id: f.id, name: f.name }))}
                toFields={targetEntity.fields.map((f) => ({ id: f.id, name: f.name }))}
                onAdd={(pair) => setMappings([...effectiveMappings, pair])}
              />
            </div>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit}>
            Create link
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMapping({
  fromFields,
  toFields,
  onAdd,
}: {
  fromFields: { id: string; name: string }[];
  toFields: { id: string; name: string }[];
  onAdd: (pair: FieldMapping) => void;
}) {
  const [f, setF] = useState("");
  const [t, setT] = useState("");
  return (
    <div className="mappings__add">
      <select value={f} onChange={(e) => setF(e.target.value)}>
        <option value="">from…</option>
        {fromFields.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <span className="mappings__arrow">↔</span>
      <select value={t} onChange={(e) => setT(e.target.value)}>
        <option value="">to…</option>
        {toFields.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <button
        className="btn btn--small"
        disabled={!f || !t}
        onClick={() => {
          onAdd({ from: f, to: t });
          setF("");
          setT("");
        }}
      >
        Add
      </button>
    </div>
  );
}
