// Pipeline transform-DAG engine (Phase 3, Q2=DAG). PURE: given a spec's node/edge
// graph and the source model, it topologically propagates each node's OUTPUT schema
// (field names + types) downstream and validates structure + references. No mutation,
// no execution. The flat objects/joins path is untouched; this operates only on the
// optional `nodes`/`edges` graph.

import type { Model } from "../../model/model";
import { filterNeedsValue, type AggFn, type PipelineSpec, type PipelineNode, type SpecType } from "./spec";

/** The output type of an aggregate function given its input column (if any). count →
 *  bigint; avg → decimal; sum → preserve a decimal input else bigint/decimal; min/max →
 *  the input column's type. */
function aggType(fn: AggFn, input?: { type?: SpecType }): SpecType | undefined {
  if (fn === "count" || fn === "count_distinct") return { type: "bigint" };
  if (fn === "min" || fn === "max") return input?.type;
  if (fn === "avg") return { type: "decimal" };
  if (input?.type?.type === "decimal") return input.type;
  if (input?.type?.type === "integer" || input?.type?.type === "bigint") return { type: "bigint" };
  return { type: "decimal" };
}

/** A field flowing along an edge: name + (optional) type + nullability. */
export interface GraphField {
  name: string;
  type?: SpecType;
  nullable?: boolean;
}

export interface GraphIssue {
  severity: "error" | "warning";
  nodeId?: string;
  message: string;
}

export interface GraphResult {
  /** Inferred output schema per node id (empty for nodes that could not resolve). */
  schemas: Map<string, GraphField[]>;
  issues: GraphIssue[];
}

function dupNames(fields: GraphField[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const f of fields) {
    const k = f.name.toLowerCase();
    if (seen.has(k)) dups.add(f.name);
    seen.add(k);
  }
  return [...dups];
}

function has(fields: GraphField[], name: string): boolean {
  return fields.some((f) => f.name.toLowerCase() === name.toLowerCase());
}

/** Topologically order node ids; returns null if the graph has a cycle. */
function topoOrder(nodes: PipelineNode[], incoming: Map<string, string[]>): string[] | null {
  const order: string[] = [];
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, (incoming.get(n.id) ?? []).length);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const outAdj = new Map<string, string[]>();
  for (const n of nodes) outAdj.set(n.id, []);
  for (const [to, froms] of incoming) for (const from of froms) outAdj.get(from)?.push(to);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nxt of outAdj.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  return order.length === nodes.length ? order : null;
}

/**
 * Infer every node's output schema and validate the DAG. Pure. Covers the MVP node
 * kinds: source, filter, select (keep+rename), derive, cast, join, target.
 */
export function inferNodeSchemas(spec: PipelineSpec, model: Model): GraphResult {
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const issues: GraphIssue[] = [];
  const schemas = new Map<string, GraphField[]>();
  if (!nodes.length) return { schemas, issues };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    if (!byId.has(e.from)) issues.push({ severity: "error", message: `Edge ${e.id} starts at unknown node “${e.from}”` });
    if (!byId.has(e.to)) issues.push({ severity: "error", message: `Edge ${e.id} ends at unknown node “${e.to}”` });
    if (byId.has(e.from) && byId.has(e.to)) incoming.get(e.to)!.push(e.from);
  }

  const order = topoOrder(nodes, incoming);
  if (!order) {
    issues.push({ severity: "error", message: "Pipeline graph has a cycle" });
    return { schemas, issues };
  }

  const entityByName = (n: string) => model.entities.find((e) => e.name.toLowerCase() === n.toLowerCase());
  const portFrom = (nodeId: string, port: "left" | "right") => edges.find((e) => e.to === nodeId && e.toPort === port)?.from;

  for (const id of order) {
    const node = byId.get(id)!;
    const inputs = incoming.get(id) ?? [];
    const inputSchema = (nid?: string): GraphField[] => (nid ? schemas.get(nid) ?? [] : []);

    let out: GraphField[] = [];
    switch (node.kind) {
      case "source": {
        if (inputs.length) issues.push({ severity: "error", nodeId: id, message: "Source node must have no inputs" });
        const e = node.sourceObject ? entityByName(node.sourceObject) : undefined;
        if (!node.sourceObject) issues.push({ severity: "error", nodeId: id, message: "Source node has no source object" });
        else if (!e) issues.push({ severity: "error", nodeId: id, message: `Source object “${node.sourceObject}” not in model (schema drift?)` });
        else out = e.fields.map((f) => ({ name: f.name, type: f.type ? { type: f.type, length: f.length, precision: f.precision, scale: f.scale } : undefined, nullable: f.nullable }));
        break;
      }
      case "filter": {
        if (inputs.length !== 1) issues.push({ severity: "error", nodeId: id, message: "Filter node needs exactly one input" });
        out = inputSchema(inputs[0]);
        for (const f of node.filters ?? []) {
          if (!has(out, f.column)) issues.push({ severity: "error", nodeId: id, message: `Filter on unknown column “${f.column}”` });
          if (filterNeedsValue(f.op) && !(f.value ?? "").trim()) issues.push({ severity: "error", nodeId: id, message: `Filter ${f.column} ${f.op} needs a value` });
        }
        break;
      }
      case "select": {
        if (inputs.length !== 1) issues.push({ severity: "error", nodeId: id, message: "Select node needs exactly one input" });
        const inp = inputSchema(inputs[0]);
        let kept = node.keep && node.keep.length ? node.keep.map((k) => inp.find((f) => f.name.toLowerCase() === k.toLowerCase())).filter((f): f is GraphField => !!f) : inp;
        for (const k of node.keep ?? []) if (!has(inp, k)) issues.push({ severity: "error", nodeId: id, message: `Select keeps unknown column “${k}”` });
        const renameMap = new Map((node.renames ?? []).map((r) => [r.from.toLowerCase(), r.to]));
        for (const r of node.renames ?? []) if (!has(inp, r.from)) issues.push({ severity: "error", nodeId: id, message: `Rename of unknown column “${r.from}”` });
        out = kept.map((f) => ({ ...f, name: renameMap.get(f.name.toLowerCase()) ?? f.name }));
        break;
      }
      case "derive": {
        if (inputs.length !== 1) issues.push({ severity: "error", nodeId: id, message: "Derive node needs exactly one input" });
        out = [...inputSchema(inputs[0])];
        for (const d of node.derive ?? []) {
          if (!d.expression.trim()) issues.push({ severity: "error", nodeId: id, message: `Derived column “${d.name}” has no expression` });
          if (has(out, d.name)) issues.push({ severity: "error", nodeId: id, message: `Derived column “${d.name}” duplicates an existing column` });
          out.push({ name: d.name, type: d.type });
        }
        break;
      }
      case "cast": {
        if (inputs.length !== 1) issues.push({ severity: "error", nodeId: id, message: "Cast node needs exactly one input" });
        const casts = new Map((node.casts ?? []).map((c) => [c.column.toLowerCase(), c.type]));
        for (const c of node.casts ?? []) if (!has(inputSchema(inputs[0]), c.column)) issues.push({ severity: "error", nodeId: id, message: `Cast of unknown column “${c.column}”` });
        out = inputSchema(inputs[0]).map((f) => (casts.has(f.name.toLowerCase()) ? { ...f, type: casts.get(f.name.toLowerCase()) } : f));
        break;
      }
      case "join": {
        const left = inputSchema(portFrom(id, "left") ?? inputs[0]);
        const right = inputSchema(portFrom(id, "right") ?? inputs[1]);
        if (inputs.length !== 2) issues.push({ severity: "error", nodeId: id, message: "Join node needs exactly two inputs (left + right)" });
        for (const o of node.on ?? []) {
          if (!has(left, o.leftColumn)) issues.push({ severity: "error", nodeId: id, message: `Join left column “${o.leftColumn}” not found` });
          if (!has(right, o.rightColumn)) issues.push({ severity: "error", nodeId: id, message: `Join right column “${o.rightColumn}” not found` });
        }
        out = [...left, ...right];
        for (const d of dupNames(out)) issues.push({ severity: "warning", nodeId: id, message: `Join output has duplicate column “${d}” (qualify or rename downstream)` });
        break;
      }
      case "aggregate": {
        if (inputs.length !== 1) issues.push({ severity: "error", nodeId: id, message: "Aggregate node needs exactly one input" });
        const inp = inputSchema(inputs[0]);
        // Output = group-by columns (input types) + one column per aggregate.
        const groupOut: GraphField[] = [];
        for (const g of node.groupBy ?? []) {
          const f = inp.find((x) => x.name.toLowerCase() === g.toLowerCase());
          if (!f) issues.push({ severity: "error", nodeId: id, message: `Group-by column “${g}” not found` });
          else groupOut.push(f);
        }
        const aggOut: GraphField[] = [];
        for (const a of node.aggregates ?? []) {
          if (!a.as.trim()) issues.push({ severity: "error", nodeId: id, message: "Aggregate output column needs a name" });
          if (a.fn !== "count" && !a.column) issues.push({ severity: "error", nodeId: id, message: `${a.fn} needs a column` });
          if (a.column && !has(inp, a.column)) issues.push({ severity: "error", nodeId: id, message: `Aggregate over unknown column “${a.column}”` });
          aggOut.push({ name: a.as, type: aggType(a.fn, a.column ? inp.find((x) => x.name.toLowerCase() === a.column!.toLowerCase()) : undefined) });
        }
        if ((node.aggregates ?? []).length === 0) issues.push({ severity: "warning", nodeId: id, message: "Aggregate node has no measures" });
        out = [...groupOut, ...aggOut];
        for (const d of dupNames(out)) issues.push({ severity: "error", nodeId: id, message: `Aggregate output has duplicate column “${d}”` });
        break;
      }
      case "target": {
        if (inputs.length !== 1) issues.push({ severity: "error", nodeId: id, message: "Target node needs exactly one input" });
        out = inputSchema(inputs[0]);
        for (const d of dupNames(out)) issues.push({ severity: "error", nodeId: id, message: `Target has duplicate column “${d}”` });
        break;
      }
    }
    schemas.set(id, out);
  }
  return { schemas, issues };
}

/** Convenience: the DAG's issues only (structural + schema), for the validator. */
export function validateGraph(spec: PipelineSpec, model: Model): GraphIssue[] {
  return inferNodeSchemas(spec, model).issues;
}
