import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  AGGREGATES,
  DERIVED_OPS,
  FILTER_OPS,
  TIME_GRAINS,
  type Aggregate,
  type Cube,
  type Dimension,
  type EntityRef,
  type FieldRef,
  type FilterOp,
  type Metric,
  type Term,
  deriveKey,
  newCube,
  newDimension,
  newMetric,
  newTerm,
} from "./semantic";
import { Resolver, metricSql } from "../export/semanticExport";
import type { NamedModel } from "../export/semanticExport";

type Sel = { kind: "term" | "dimension" | "metric" | "cube"; id: string } | null;

// The semantic view (FR-7.7): lists terms, dimensions and metrics with search and
// a detail panel for editing. No canvas here.
export function SemanticView() {
  const semantic = useWorkspaceStore((s) => s.semantic);
  const allModels = useWorkspaceStore((s) => s.allModels);
  const addTerm = useWorkspaceStore((s) => s.addTerm);
  const addDimension = useWorkspaceStore((s) => s.addDimension);
  const addMetric = useWorkspaceStore((s) => s.addMetric);
  const addCube = useWorkspaceStore((s) => s.addCube);

  const models = allModels();
  const [sel, setSel] = useState<Sel>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (n: string) => !q || n.toLowerCase().includes(q);

  const createTerm = () => {
    const t = newTerm("New term");
    addTerm(t);
    setSel({ kind: "term", id: t.id });
  };
  const createDimension = () => {
    const d = newDimension("New dimension");
    addDimension(d);
    setSel({ kind: "dimension", id: d.id });
  };
  const createMetric = () => {
    const m = newMetric("New metric");
    addMetric(m);
    setSel({ kind: "metric", id: m.id });
  };
  const createCube = () => {
    const c = newCube("New cube");
    addCube(c);
    setSel({ kind: "cube", id: c.id });
  };

  return (
    <div className="semantic">
      <div className="semantic__list">
        <input
          className="explorer__filter"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Section title="Terms" onAdd={createTerm}>
          {semantic.terms.filter((t) => match(t.name)).map((t) => (
            <ListItem key={t.id} name={t.name} active={sel?.id === t.id} onClick={() => setSel({ kind: "term", id: t.id })} />
          ))}
        </Section>
        <Section title="Dimensions" onAdd={createDimension}>
          {semantic.dimensions.filter((d) => match(d.name)).map((d) => (
            <ListItem key={d.id} name={d.name} active={sel?.id === d.id} onClick={() => setSel({ kind: "dimension", id: d.id })} />
          ))}
        </Section>
        <Section title="Metrics" onAdd={createMetric}>
          {semantic.metrics.filter((m) => match(m.name)).map((m) => (
            <ListItem key={m.id} name={m.name} active={sel?.id === m.id} onClick={() => setSel({ kind: "metric", id: m.id })} />
          ))}
        </Section>
        <Section title="Cubes" onAdd={createCube}>
          {(semantic.cubes ?? []).filter((c) => match(c.name)).map((c) => (
            <ListItem key={c.id} name={c.name} active={sel?.id === c.id} onClick={() => setSel({ kind: "cube", id: c.id })} />
          ))}
        </Section>
      </div>
      <div className="semantic__detail">
        {!sel && <p className="side__hint">Select or create a term, dimension or metric.</p>}
        {sel?.kind === "term" && <TermEditor id={sel.id} onGone={() => setSel(null)} />}
        {sel?.kind === "dimension" && <DimensionEditor id={sel.id} models={models} onGone={() => setSel(null)} />}
        {sel?.kind === "metric" && <MetricEditor id={sel.id} models={models} onGone={() => setSel(null)} />}
        {sel?.kind === "cube" && <CubeEditor id={sel.id} onGone={() => setSel(null)} />}
      </div>
    </div>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="semantic__section">
      <div className="semantic__section-head">
        <span>{title}</span>
        <button className="tree-row__add" onClick={onAdd} title={`Add ${title.toLowerCase()}`}>
          +
        </button>
      </div>
      {children}
    </div>
  );
}

function ListItem({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`semantic__item ${active ? "semantic__item--active" : ""}`} onClick={onClick}>
      {name}
    </button>
  );
}

// ---- field / entity pickers -------------------------------------------------

function FieldPicker({
  value,
  onChange,
  models,
}: {
  value: FieldRef | undefined;
  onChange: (ref: FieldRef | undefined) => void;
  models: NamedModel[];
}) {
  const model = models.find((m) => m.id === value?.model);
  const entity = model?.model.entities.find((e) => e.id === value?.entity);
  return (
    <div className="picker">
      <select
        value={value?.model ?? ""}
        onChange={(e) => onChange(e.target.value ? { model: e.target.value, entity: "", field: "" } : undefined)}
      >
        <option value="">model…</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        value={value?.entity ?? ""}
        disabled={!model}
        onChange={(e) => onChange(value ? { ...value, entity: e.target.value, field: "" } : undefined)}
      >
        <option value="">entity…</option>
        {model?.model.entities.map((en) => (
          <option key={en.id} value={en.id}>
            {en.name}
          </option>
        ))}
      </select>
      <select
        value={value?.field ?? ""}
        disabled={!entity}
        onChange={(e) => (value ? onChange({ ...value, field: e.target.value }) : undefined)}
      >
        <option value="">field…</option>
        {entity?.fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function EntityPicker({
  value,
  onChange,
  models,
}: {
  value: EntityRef | undefined;
  onChange: (ref: EntityRef | undefined) => void;
  models: NamedModel[];
}) {
  const model = models.find((m) => m.id === value?.model);
  return (
    <div className="picker">
      <select
        value={value?.model ?? ""}
        onChange={(e) => onChange(e.target.value ? { model: e.target.value, entity: "" } : undefined)}
      >
        <option value="">model…</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        value={value?.entity ?? ""}
        disabled={!model}
        onChange={(e) => onChange(value ? { ...value, entity: e.target.value } : undefined)}
      >
        <option value="">entity…</option>
        {model?.model.entities.map((en) => (
          <option key={en.id} value={en.id}>
            {en.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Lineage({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="editor__section">
      <span className="editor__label">Lineage</span>
      <ul className="lineage">
        {paths.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- editors ----------------------------------------------------------------

function TermEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const term = useWorkspaceStore((s) => s.semantic.terms.find((t) => t.id === id));
  const update = useWorkspaceStore((s) => s.updateTerm);
  const del = useWorkspaceStore((s) => s.deleteTerm);
  if (!term) return null;
  const patch = (p: Partial<Term>) => update(id, p);
  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Name</label>
        <input className="editor__input" value={term.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>
      <div className="editor__section">
        <label className="editor__label">Definition</label>
        <textarea className="editor__input" rows={3} value={term.definition} onChange={(e) => patch({ definition: e.target.value })} />
      </div>
      <div className="editor__section">
        <label className="editor__label">Synonyms (comma-separated)</label>
        <input
          className="editor__input"
          value={term.synonyms?.join(", ") ?? ""}
          onChange={(e) => patch({ synonyms: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
        />
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete term
      </button>
    </div>
  );
}

function DimensionEditor({ id, models, onGone }: { id: string; models: NamedModel[]; onGone: () => void }) {
  const dim = useWorkspaceStore((s) => s.semantic.dimensions.find((d) => d.id === id));
  const conceptGroups = useWorkspaceStore((s) => s.links.conceptGroups);
  const update = useWorkspaceStore((s) => s.updateDimension);
  const del = useWorkspaceStore((s) => s.deleteDimension);
  const r = useMemo(() => new Resolver(models, conceptGroups), [models, conceptGroups]);
  if (!dim) return null;
  const patch = (p: Partial<Dimension>) => update(id, p);

  const lineage: string[] = [];
  if (dim.concept) lineage.push(`concept: ${r.conceptName(dim.concept)}`);
  if (dim.entity) lineage.push(r.entityPath(dim.entity));
  if (dim.field) lineage.push(r.fieldPath(dim.field));
  for (const a of dim.attributes ?? []) lineage.push(`${a.name}: ${r.fieldPath(a.field)}`);

  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Name</label>
        <input className="editor__input" value={dim.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>
      <div className="editor__section">
        <label className="editor__label">Description</label>
        <input className="editor__input" value={dim.description ?? ""} onChange={(e) => patch({ description: e.target.value })} />
      </div>
      <div className="editor__section">
        <label className="checkbox">
          <input type="checkbox" checked={!!dim.time} onChange={(e) => patch({ time: e.target.checked })} />
          Time dimension
        </label>
      </div>
      {dim.time ? (
        <div className="editor__section">
          <label className="editor__label">Date/timestamp field</label>
          <FieldPicker value={dim.field} onChange={(f) => patch({ field: f })} models={models} />
          <p className="field__hint">Grains: {TIME_GRAINS.join(", ")}</p>
        </div>
      ) : (
        <>
          <div className="editor__section">
            <label className="editor__label">Concept group</label>
            <select className="editor__input" value={dim.concept ?? ""} onChange={(e) => patch({ concept: e.target.value || undefined })}>
              <option value="">— none —</option>
              {conceptGroups.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {!dim.concept && (
            <div className="editor__section">
              <label className="editor__label">Or a single entity</label>
              <EntityPicker value={dim.entity} onChange={(e) => patch({ entity: e })} models={models} />
            </div>
          )}
          <div className="editor__section">
            <label className="editor__label">Attributes</label>
            {(dim.attributes ?? []).map((a, i) => (
              <div key={i} className="attr-row">
                <input
                  value={a.name}
                  placeholder="name"
                  onChange={(e) => {
                    const attrs = [...(dim.attributes ?? [])];
                    attrs[i] = { ...attrs[i], name: e.target.value };
                    patch({ attributes: attrs });
                  }}
                />
                <FieldPicker
                  value={a.field}
                  onChange={(f) => {
                    if (!f) return;
                    const attrs = [...(dim.attributes ?? [])];
                    attrs[i] = { ...attrs[i], field: f };
                    patch({ attributes: attrs });
                  }}
                  models={models}
                />
                <button className="field-row__del" onClick={() => patch({ attributes: (dim.attributes ?? []).filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn btn--small"
              onClick={() => patch({ attributes: [...(dim.attributes ?? []), { name: "attribute", field: { model: "", entity: "", field: "" } }] })}
            >
              + Attribute
            </button>
          </div>
        </>
      )}
      <div className="editor__section">
        <label className="editor__label">Hierarchies (OLAP)</label>
        {(dim.hierarchies ?? []).map((h, i) => (
          <div key={i} className="attr-row">
            <input
              value={h.name}
              placeholder="name"
              onChange={(e) => {
                const hs = [...(dim.hierarchies ?? [])];
                hs[i] = { ...hs[i], name: e.target.value };
                patch({ hierarchies: hs });
              }}
            />
            <input
              value={h.levels.join(" > ")}
              placeholder="Year > Quarter > Month"
              onChange={(e) => {
                const hs = [...(dim.hierarchies ?? [])];
                hs[i] = {
                  ...hs[i],
                  levels: e.target.value.split(">").map((s) => s.trim()).filter(Boolean),
                };
                patch({ hierarchies: hs });
              }}
            />
            <button
              className="field-row__del"
              onClick={() => patch({ hierarchies: (dim.hierarchies ?? []).filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn btn--small"
          onClick={() =>
            patch({
              hierarchies: [
                ...(dim.hierarchies ?? []),
                { name: "hierarchy", levels: dim.time ? [...TIME_GRAINS] : [] },
              ],
            })
          }
        >
          + Hierarchy
        </button>
        <p className="field__hint">
          Levels: {dim.time ? TIME_GRAINS.join(", ") : (dim.attributes ?? []).map((a) => a.name).join(", ") || "add attributes first"}
        </p>
      </div>

      <Lineage paths={lineage} />
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete dimension
      </button>
    </div>
  );
}

function MetricEditor({ id, models, onGone }: { id: string; models: NamedModel[]; onGone: () => void }) {
  const metric = useWorkspaceStore((s) => s.semantic.metrics.find((m) => m.id === id));
  const semantic = useWorkspaceStore((s) => s.semantic);
  const conceptGroups = useWorkspaceStore((s) => s.links.conceptGroups);
  const update = useWorkspaceStore((s) => s.updateMetric);
  const del = useWorkspaceStore((s) => s.deleteMetric);
  const r = useMemo(() => new Resolver(models, conceptGroups), [models, conceptGroups]);
  const [derived, setDerived] = useState(!!metric?.derived);
  if (!metric) return null;
  const patch = (p: Partial<Metric>) => update(id, p);

  const lineage: string[] = [];
  if (metric.derived) {
    const l = semantic.metrics.find((x) => x.id === metric.derived!.left);
    const rr = semantic.metrics.find((x) => x.id === metric.derived!.right);
    if (l) lineage.push(`metric: ${l.name}`);
    if (rr) lineage.push(`metric: ${rr.name}`);
  } else {
    if (metric.field) lineage.push(r.fieldPath(metric.field));
    if (metric.grain) lineage.push(`grain: ${r.entityPath(metric.grain)}`);
    for (const f of metric.filters ?? []) lineage.push(`filter: ${r.fieldPath(f.field)} ${f.op} ${f.value ?? ""}`);
  }

  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Name</label>
        <input
          className="editor__input"
          value={metric.name}
          onChange={(e) => patch({ name: e.target.value, key: deriveKey(e.target.value) })}
        />
        <p className="field__hint">key: {metric.key}</p>
      </div>
      <div className="editor__section">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={derived}
            onChange={(e) => {
              setDerived(e.target.checked);
              if (e.target.checked) patch({ aggregate: undefined, field: undefined, grain: undefined, filters: undefined, derived: { left: "", op: "/", right: "" } });
              else patch({ derived: undefined, aggregate: "count" });
            }}
          />
          Derived metric (combine two metrics)
        </label>
      </div>

      {derived ? (
        <div className="editor__section editor__section--row">
          <select value={metric.derived?.left ?? ""} onChange={(e) => patch({ derived: { ...(metric.derived ?? { op: "/", right: "" }), left: e.target.value } })}>
            <option value="">left…</option>
            {semantic.metrics.filter((m) => m.id !== id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={metric.derived?.op ?? "/"} onChange={(e) => patch({ derived: { ...(metric.derived ?? { left: "", right: "" }), op: e.target.value as (typeof DERIVED_OPS)[number] } })}>
            {DERIVED_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={metric.derived?.right ?? ""} onChange={(e) => patch({ derived: { ...(metric.derived ?? { left: "", op: "/" }), right: e.target.value } })}>
            <option value="">right…</option>
            {semantic.metrics.filter((m) => m.id !== id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      ) : (
        <>
          <div className="editor__section">
            <label className="editor__label">Aggregate</label>
            <select className="editor__input" value={metric.aggregate ?? "count"} onChange={(e) => patch({ aggregate: e.target.value as Aggregate })}>
              {AGGREGATES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="editor__section">
            <label className="editor__label">Field</label>
            <FieldPicker value={metric.field} onChange={(f) => patch({ field: f })} models={models} />
          </div>
          <div className="editor__section">
            <label className="editor__label">Grain entity</label>
            <EntityPicker value={metric.grain} onChange={(e) => patch({ grain: e })} models={models} />
          </div>
          <div className="editor__section">
            <label className="editor__label">Filters</label>
            {(metric.filters ?? []).map((f, i) => (
              <div key={i} className="attr-row">
                <FieldPicker value={f.field} onChange={(nf) => { if (!nf) return; const fs = [...(metric.filters ?? [])]; fs[i] = { ...fs[i], field: nf }; patch({ filters: fs }); }} models={models} />
                <select value={f.op} onChange={(e) => { const fs = [...(metric.filters ?? [])]; fs[i] = { ...fs[i], op: e.target.value as FilterOp }; patch({ filters: fs }); }}>
                  {FILTER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <input value={f.value ?? ""} placeholder="value" onChange={(e) => { const fs = [...(metric.filters ?? [])]; fs[i] = { ...fs[i], value: e.target.value }; patch({ filters: fs }); }} />
                <button className="field-row__del" onClick={() => patch({ filters: (metric.filters ?? []).filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className="btn btn--small" onClick={() => patch({ filters: [...(metric.filters ?? []), { field: { model: "", entity: "", field: "" }, op: "=", value: "" }] })}>
              + Filter
            </button>
          </div>
          <div className="editor__section">
            <label className="editor__label">Generated SQL</label>
            <pre className="metric-sql">{metricSql(metric, r, semantic)}</pre>
          </div>
        </>
      )}

      <Lineage paths={lineage} />
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete metric
      </button>
    </div>
  );
}

function CubeEditor({ id, onGone }: { id: string; onGone: () => void }) {
  const cube = useWorkspaceStore((s) => (s.semantic.cubes ?? []).find((c) => c.id === id));
  const metrics = useWorkspaceStore((s) => s.semantic.metrics);
  const dimensions = useWorkspaceStore((s) => s.semantic.dimensions);
  const update = useWorkspaceStore((s) => s.updateCube);
  const del = useWorkspaceStore((s) => s.deleteCube);
  if (!cube) return null;
  const patch = (p: Partial<Cube>) => update(id, p);
  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <div className="editor">
      <div className="editor__section">
        <label className="editor__label">Name</label>
        <input className="editor__input" value={cube.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>
      <div className="editor__section">
        <label className="editor__label">Description</label>
        <input className="editor__input" value={cube.description ?? ""} onChange={(e) => patch({ description: e.target.value })} />
      </div>
      <div className="editor__section">
        <label className="editor__label">Measures (metrics)</label>
        {metrics.length === 0 && <p className="side__hint">Create metrics first.</p>}
        {metrics.map((m) => (
          <label key={m.id} className="checkbox">
            <input
              type="checkbox"
              checked={cube.measures.includes(m.id)}
              onChange={() => patch({ measures: toggle(cube.measures, m.id) })}
            />
            {m.name}
          </label>
        ))}
      </div>
      <div className="editor__section">
        <label className="editor__label">Dimensions</label>
        {dimensions.length === 0 && <p className="side__hint">Create dimensions first.</p>}
        {dimensions.map((d) => (
          <label key={d.id} className="checkbox">
            <input
              type="checkbox"
              checked={cube.dimensions.includes(d.id)}
              onChange={() => patch({ dimensions: toggle(cube.dimensions, d.id) })}
            />
            {d.name}
          </label>
        ))}
      </div>
      <button className="btn btn--danger btn--small" onClick={() => (del(id), onGone())}>
        Delete cube
      </button>
    </div>
  );
}
