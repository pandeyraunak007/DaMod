import { useWorkspaceStore } from "../store/workspaceStore";

// Shown on launch when no workspace is open. The paths mirror a data
// modeler's start page: create a new model (choosing its type), open an
// existing workspace folder, or open a single .model.json file directly.
export function Welcome({ onNewModel }: { onNewModel: () => void }) {
  const openPicker = useWorkspaceStore((s) => s.openWorkspacePicker);
  const openModelFilePicker = useWorkspaceStore((s) => s.openModelFilePicker);

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
          <button className="welcome__action" onClick={() => void openModelFilePicker()}>
            <span className="welcome__action-title">Open model file…</span>
            <span className="welcome__action-hint">
              Pick a single .model.json file — its folder opens as the workspace.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
