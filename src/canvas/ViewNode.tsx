import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useModelStore } from "../store/modelStore";

// A canvas card for a database view: dashed, with lines to its source entities.
function ViewNodeImpl({ data, selected }: NodeProps) {
  const viewId = data.viewId as string;
  const view = useModelStore((s) => s.model.views?.find((v) => v.id === viewId));
  if (!view) return null;
  const firstLine = view.definition.trim().split("\n")[0] || "SELECT …";
  return (
    <div className={`view-node ${selected ? "view-node--selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="entity__handle" />
      <Handle type="source" position={Position.Right} className="entity__handle" />
      <div className="view-node__header">
        {view.materialized ? "◫ " : "▤ "}
        {view.name}
        <span className="view-node__tag">view</span>
      </div>
      <div className="view-node__body">{firstLine}</div>
    </div>
  );
}

export const ViewNode = memo(ViewNodeImpl);
