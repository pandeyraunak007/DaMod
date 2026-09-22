import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type Connection,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useModelStore } from "../store/modelStore";
import { EntityNode } from "./EntityNode";
import {
  EdgeMarkers,
  MARKER_MANY,
  MARKER_ONE,
  MARKER_SUBTYPE,
  MARKER_IDEF_DOT,
} from "./EdgeMarkers";
import { FloatingToolbar } from "./FloatingToolbar";
import type { Model, Relationship } from "../model/model";

const nodeTypes = { entity: EntityNode };

function baseRelId(edgeId: string): string {
  return edgeId.replace(/:(p|c)$/, "");
}

function buildEdges(model: Model, selectedRelId: string | null): Edge[] {
  const edges: Edge[] = [];
  const selected = (rel: Relationship) => rel.id === selectedRelId;
  const idef = (model.notation ?? "IE") === "IDEF1X";

  for (const rel of model.relationships) {
    if (rel.cardinality !== "many-to-many") {
      // IDEF1X marks the child (many) end with a filled dot; IE uses crow's foot.
      const childMarker = idef
        ? rel.cardinality === "one-to-many"
          ? MARKER_IDEF_DOT
          : undefined
        : rel.cardinality === "one-to-many"
          ? MARKER_MANY
          : MARKER_ONE;
      const parentMarker = rel.subtype ? MARKER_SUBTYPE : idef ? undefined : MARKER_ONE;
      // Identifying (and subtype) relationships are solid; non-identifying dashed.
      const style: React.CSSProperties = {};
      if (selected(rel)) {
        style.stroke = "#2563eb";
        style.strokeWidth = 2;
      }
      if (!rel.identifying && !rel.subtype) style.strokeDasharray = "6 4";
      edges.push({
        id: rel.id,
        source: rel.parentEntity,
        target: rel.childEntity,
        label: rel.label,
        markerStart: parentMarker,
        markerEnd: childMarker,
        selected: selected(rel),
        style,
      });
    } else if (rel.junctionEntity) {
      // Two lines: each original entity (one) to the junction (many).
      for (const [end, entity] of [
        ["p", rel.parentEntity],
        ["c", rel.childEntity],
      ] as const) {
        edges.push({
          id: `${rel.id}:${end}`,
          source: entity,
          target: rel.junctionEntity,
          label: end === "p" ? rel.label : undefined,
          markerStart: MARKER_ONE,
          markerEnd: MARKER_MANY,
          selected: selected(rel),
          style: selected(rel) ? { stroke: "#2563eb", strokeWidth: 2 } : undefined,
        });
      }
    }
  }
  return edges;
}

function FocusController() {
  const focus = useModelStore((s) => s.focus);
  const getEntity = useModelStore((s) => s.model.entities);
  const { setCenter } = useReactFlow();

  useEffect(() => {
    if (!focus) return;
    const entity = getEntity.find((e) => e.id === focus.entityId);
    if (!entity) return;
    setCenter(entity.position.x + 90, entity.position.y + 60, {
      zoom: 1.2,
      duration: 400,
    });
  }, [focus, getEntity, setCenter]);

  return null;
}

function CanvasInner() {
  const entities = useModelStore((s) => s.model.entities);
  const model = useModelStore((s) => s.model);
  const selection = useModelStore((s) => s.selection);
  const applyNodePositions = useModelStore((s) => s.applyNodePositions);
  const beginInteraction = useModelStore((s) => s.beginInteraction);
  const endInteraction = useModelStore((s) => s.endInteraction);
  const select = useModelStore((s) => s.select);
  const openRelationshipDraft = useModelStore((s) => s.openRelationshipDraft);

  const canvasMode = useModelStore((s) => s.canvasMode);
  const setCanvasMode = useModelStore((s) => s.setCanvasMode);
  const createEntity = useModelStore((s) => s.createEntity);
  const { screenToFlowPosition } = useReactFlow();
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const selectedEntityId = selection?.kind === "entity" ? selection.id : null;
  const selectedRelId = selection?.kind === "relationship" ? selection.id : null;

  const nodes: Node[] = useMemo(
    () =>
      entities.map((e) => ({
        id: e.id,
        type: "entity",
        position: e.position,
        data: { entityId: e.id },
        selected: e.id === selectedEntityId,
        className: connectFrom === e.id ? "rf-connect-source" : undefined,
      })),
    [entities, selectedEntityId, connectFrom],
  );

  const edges = useMemo(() => buildEdges(model, selectedRelId), [model, selectedRelId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moves: { id: string; position: { x: number; y: number } }[] = [];
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          moves.push({ id: c.id, position: c.position });
        }
      }
      if (moves.length) applyNodePositions(moves);
    },
    [applyNodePositions],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (canvasMode === "add-relationship") {
        if (!connectFrom) {
          setConnectFrom(node.id);
          select({ kind: "entity", id: node.id });
        } else {
          openRelationshipDraft(connectFrom, node.id);
          setConnectFrom(null);
          setCanvasMode("select");
        }
        return;
      }
      select({ kind: "entity", id: node.id });
    },
    [canvasMode, connectFrom, openRelationshipDraft, select, setCanvasMode],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => select({ kind: "relationship", id: baseRelId(edge.id) }),
    [select],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) openRelationshipDraft(c.source, c.target);
    },
    [openRelationshipDraft],
  );

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (canvasMode === "add-entity") {
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        createEntity({ x: Math.round(pos.x), y: Math.round(pos.y) });
        setCanvasMode("select");
        return;
      }
      setConnectFrom(null);
      select(null);
    },
    [canvasMode, screenToFlowPosition, createEntity, setCanvasMode, select],
  );

  return (
    <div className={`canvas-wrap canvas-wrap--${canvasMode}`}>
      {canvasMode === "add-relationship" && (
        <div className="connect-hint">
          {connectFrom ? (
            <>
              Click the <strong>second</strong> entity (the child that gets the foreign key).
            </>
          ) : (
            <>
              Adding a relationship — click the <strong>first</strong> entity (the parent).
            </>
          )}
          <span className="connect-hint__esc">Esc to cancel</span>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={beginInteraction}
        onNodeDragStop={endInteraction}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={null}
        fitView
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
        <FocusController />
      </ReactFlow>
      <FloatingToolbar connecting={connectFrom != null} />
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <EdgeMarkers />
      <CanvasInner />
    </ReactFlowProvider>
  );
}
