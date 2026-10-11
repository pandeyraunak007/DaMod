// Graph-aware SQL generation for the ETL transform DAG (Phase 3 Slice C). PURE,
// deterministic, DESIGN-TIME text — never executed. For each target (or terminal) node
// it emits one `WITH <cte-per-node> SELECT * FROM <target>` in the SOURCE model's dialect,
// composing each node's transform (filter→WHERE, select→column list, derive→expr columns,
// cast→CAST, join→JOIN). Reuses inferNodeSchemas for per-node column lists + quoting.

import type { Field, Model } from "../../model/model";
import { modelDialect } from "../../model/model";
import { DIALECTS, type DialectId } from "../../export/dialects";
import { inferNodeSchemas } from "./graph";
import type { PipelineSpec, PipelineNode, SpecType } from "./spec";

function sqlValue(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

export function graphSql(spec: PipelineSpec, model: Model): { sql: string; unsupported: string[] } {
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const unsupported: string[] = [];
  if (!nodes.length) return { sql: "", unsupported };

  const d = DIALECTS[modelDialect(model) as DialectId];
  const q = d.quote;
  const renderType = (t: SpecType) => d.type({ type: t.type, length: t.length, precision: t.precision, scale: t.scale } as unknown as Field);
  const { schemas } = inferNodeSchemas(spec, model);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) if (incoming.has(e.to)) incoming.get(e.to)!.push(e.from);
  const portFrom = (id: string, port: "left" | "right") => edges.find((e) => e.to === id && e.toPort === port)?.from;
  const cte = (id: string) => q(id);
  const inCols = (id: string) => (schemas.get(id) ?? []).map((f) => f.name);

  const bodyFor = (n: PipelineNode): string | null => {
    const ins = incoming.get(n.id) ?? [];
    const inCte = ins[0] ? cte(ins[0]) : null;
    switch (n.kind) {
      case "source":
        return n.sourceObject ? `SELECT * FROM ${q(n.sourceObject)}` : null;
      case "filter": {
        if (!inCte) return null;
        const where = (n.filters ?? []).map((f) =>
          f.op === "is null" ? `${q(f.column)} IS NULL`
            : f.op === "is not null" ? `${q(f.column)} IS NOT NULL`
              : f.op === "in" ? `${q(f.column)} IN (${(f.value ?? "").trim()})`
                : `${q(f.column)} ${f.op} ${sqlValue(f.value)}`,
        );
        return `SELECT * FROM ${inCte}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
      }
      case "select": {
        if (!inCte) return null;
        const base = n.keep && n.keep.length ? n.keep : inCols(ins[0]);
        if (!base.length) return `SELECT * FROM ${inCte}`;
        const ren = new Map((n.renames ?? []).map((r) => [r.from.toLowerCase(), r.to]));
        const cols = base.map((c) => (ren.has(c.toLowerCase()) ? `${q(c)} AS ${q(ren.get(c.toLowerCase())!)}` : q(c)));
        return `SELECT ${cols.join(", ")} FROM ${inCte}`;
      }
      case "derive": {
        if (!inCte) return null;
        const extra = (n.derive ?? []).map((dv) => `${dv.expression} AS ${q(dv.name)}`);
        return `SELECT *${extra.length ? `, ${extra.join(", ")}` : ""} FROM ${inCte}`;
      }
      case "cast": {
        if (!inCte) return null;
        const cols = inCols(ins[0]);
        if (!cols.length) return `SELECT * FROM ${inCte}`;
        const casts = new Map((n.casts ?? []).map((c) => [c.column.toLowerCase(), c.type]));
        const list = cols.map((c) => (casts.has(c.toLowerCase()) ? `CAST(${q(c)} AS ${renderType(casts.get(c.toLowerCase())!)}) AS ${q(c)}` : q(c)));
        return `SELECT ${list.join(", ")} FROM ${inCte}`;
      }
      case "join": {
        const l = portFrom(n.id, "left") ?? ins[0];
        const r = portFrom(n.id, "right") ?? ins[1];
        if (!l || !r) return null;
        const on = (n.on ?? []).map((o) => `${cte(l)}.${q(o.leftColumn)} = ${cte(r)}.${q(o.rightColumn)}`);
        return `SELECT ${cte(l)}.*, ${cte(r)}.* FROM ${cte(l)} ${(n.joinKind ?? "inner").toUpperCase()} JOIN ${cte(r)} ON ${on.length ? on.join(" AND ") : "1=1"}`;
      }
      case "aggregate": {
        if (!inCte) return null;
        const groups = (n.groupBy ?? []).map((g) => q(g));
        const measures = (n.aggregates ?? []).map((a) => {
          const expr =
            a.fn === "count" && !a.column ? "COUNT(*)"
              : a.fn === "count_distinct" ? `COUNT(DISTINCT ${q(a.column ?? "")})`
                : `${a.fn.toUpperCase()}(${q(a.column ?? "")})`;
          return `${expr} AS ${q(a.as)}`;
        });
        const cols = [...groups, ...measures];
        const groupBy = groups.length ? `\nGROUP BY ${groups.join(", ")}` : "";
        return `SELECT ${cols.length ? cols.join(", ") : "*"} FROM ${inCte}${groupBy}`;
      }
      case "target":
        return inCte ? `SELECT * FROM ${inCte}` : null;
    }
  };

  // Upstream-first order of a node and all its ancestors (CTEs defined before use).
  const ancestorsTopo = (targetId: string): string[] => {
    const seen = new Set<string>();
    const order: string[] = [];
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const p of incoming.get(id) ?? []) visit(p);
      order.push(id);
    };
    visit(targetId);
    return order;
  };

  const targets = nodes.filter((n) => n.kind === "target");
  const terminal = targets.length ? targets : nodes.filter((n) => !edges.some((e) => e.from === n.id));
  const blocks: string[] = [`-- Pipeline graph SQL: ${spec.name} (source dialect: ${d.label}) — design-time preview, not executed`];

  for (const t of [...terminal].sort((a, b) => a.id.localeCompare(b.id))) {
    const chain = ancestorsTopo(t.id);
    const ctes: string[] = [];
    let ok = true;
    for (const id of chain) {
      const body = bodyFor(byId.get(id)!);
      if (body === null) {
        unsupported.push(`${byId.get(id)!.label ?? id}: cannot generate SQL (missing input or config)`);
        ok = false;
      } else {
        ctes.push(`${cte(id)} AS (\n  ${body}\n)`);
      }
    }
    if (ok && ctes.length) blocks.push(`-- target: ${t.label ?? t.id}\nWITH ${ctes.join(",\n")}\nSELECT * FROM ${cte(t.id)};`);
  }
  return { sql: blocks.join("\n\n") + "\n", unsupported };
}
