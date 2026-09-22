import { useWorkspaceStore } from "../store/workspaceStore";

// Shown on launch when no workspace is open. The two paths mirror a data
// modeler's start page: create a new model (choosing its type) or open an
// existing workspace folder.
export function Welcome({ onNewModel }: { onNewModel: () => void }) {
  const openPicker = useWorkspaceStore((s) => s.openWorkspacePicker);

  return (
    <div className="welcome">
      <div className="welcome__card">
        <h1 className="welcome__title">DaMod</h1>
        <p className="welcome__subtitle">Personal Data Modeling Tool</p>

        <div className="welcome__actions">
          <button className="welcome__action" onClick={onNewModel}>
            <span className="welcome__action-title">New model</span>
            <span className="welcome__action-hint">
              Choose a type — Conceptual, Logical or Physical — and start on a blank canvas.
            </span>
          </button>
          <button className="welcome__action" onClick={openPicker}>
            <span className="welcome__action-title">Open workspace</span>
            <span className="welcome__action-hint">
              Open a folder of existing models to keep working.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
