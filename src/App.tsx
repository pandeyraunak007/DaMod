import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./App.css";

// Phase 0: an empty canvas shell. Entities, fields and relationships (FR-2, FR-3,
// FR-4) arrive in Phase 1; for now this proves the app opens to a working canvas
// that pans, zooms and fits to view.
const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

export default function App() {
  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">DaMod</span>
        <span className="app__subtitle">Personal Data Modeling Tool</span>
      </header>
      <main className="app__canvas">
        <ReactFlow nodes={initialNodes} edges={initialEdges} fitView>
          <Background gap={16} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
        <div className="app__empty" role="status">
          <p className="app__empty-title">Empty canvas</p>
          <p className="app__empty-hint">
            Phase 0 scaffold. Modeling tools arrive in Phase 1.
          </p>
        </div>
      </main>
    </div>
  );
}
