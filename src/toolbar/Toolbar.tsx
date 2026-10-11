import { useEffect, useState } from "react";
import {
  type LucideIcon,
  Copy,
  Camera,
  Database,
  DatabaseZap,
  Download,
  FileInput,
  FilePlus2,
  FolderOpen,
  Grid3x3,
  History,
  Layers,
  LayoutGrid,
  Magnet,
  Map as MapIcon,
  Maximize2,
  Redo2,
  Scan,
  Search,
  Shapes,
  Sparkles,
  Star,
  Table,
  Undo2,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ViewMenu } from "./ViewMenu";
import { useModelStore } from "../store/modelStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { canvasControls } from "../canvas/canvasControls";
import { MODEL_LEVELS, type ModelLevel, exportDisabledReason, levelTerms } from "../model/levels";
import { ModelContextIndicator } from "./ModelContextIndicator";

interface Props {
  onNewModel: () => void;
  onImport: () => void;
  onOpenConnections: () => void;
  onReverseEngineer: () => void;
  onOpenPipelines: () => void;
  onOpenSnapshot: () => void;
  onOpenHistory: () => void;
  onOpenMap: () => void;
  onOpenExport: () => void;
  onOpenDomains: () => void;
  onToggleSemantic: () => void;
  onToggleCopilot: () => void;
  copilotActive: boolean;
  semanticActive: boolean;
}

type RibbonTab = "File" | "Home" | "Diagram" | "Data";
const TABS: RibbonTab[] = ["File", "Home", "Diagram", "Data"];

export function Toolbar(props: Props) {
  const { onToggleSemantic, semanticActive, onToggleCopilot, copilotActive } = props;
  const [tab, setTab] = useState<RibbonTab>("Home");

  const wsName = useWorkspaceStore((s) => s.name);
  const wsPath = useWorkspaceStore((s) => s.path);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const openPicker = useWorkspaceStore((s) => s.openWorkspacePicker);

  return (
    <div className="ribbon">
      <div className="ribbon__bar">
        <span className="ribbon__brand">DaMod</span>
        <button
          className="ribbon__ws"
          onClick={openPicker}
          title={wsPath ?? "Open a workspace folder"}
        >
          <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
          {wsPath ? wsName : "Open workspace"}
        </button>
        {wsPath && activeId && <ModelContextIndicator />}

        <nav className="ribbon__tabs" role="tablist" aria-label="Ribbon tabs">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`ribbon__tab ${tab === t ? "ribbon__tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="ribbon__bar-right">
          <button
            className={`btn btn--small ${copilotActive ? "btn--primary" : ""}`}
            onClick={onToggleCopilot}
            title="AI Modeling Copilot"
          >
            <Sparkles size={13} strokeWidth={1.8} aria-hidden /> Copilot
          </button>
          <ViewMenu />
          <SearchBox />
        </div>
      </div>

      <div className="ribbon__content" role="tabpanel">
        {tab === "File" && <FileTab {...props} />}
        {tab === "Home" && <HomeTab onOpenDomains={props.onOpenDomains} />}
        {tab === "Diagram" && <DiagramTab onOpenMap={props.onOpenMap} onToggleSemantic={onToggleSemantic} semanticActive={semanticActive} />}
        {tab === "Data" && (
          <DataTab
            onOpenConnections={props.onOpenConnections}
            onReverseEngineer={props.onReverseEngineer}
            onOpenPipelines={props.onOpenPipelines}
            onOpenSnapshot={props.onOpenSnapshot}
          />
        )}
      </div>
    </div>
  );
}

// ---- shared ribbon primitives -----------------------------------------------

function RibbonButton({
  Icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`rbtn ${active ? "rbtn--active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active ?? undefined}
    >
      <Icon size={18} strokeWidth={1.6} aria-hidden />
      <span className="rbtn__label">{label}</span>
    </button>
  );
}

function RGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rgroup__row">{children}</div>
      <div className="rgroup__title">{title}</div>
    </div>
  );
}

// ---- tabs -------------------------------------------------------------------

function FileTab(props: Props) {
  const wsPath = useWorkspaceStore((s) => s.path);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const duplicateModel = useWorkspaceStore((s) => s.duplicateModel);
  const level = useModelStore((s) => s.model.level);
  const exportReason = exportDisabledReason(level);
  return (
    <>
      <RGroup title="Model">
        <RibbonButton Icon={FilePlus2} label="New model" onClick={props.onNewModel} disabled={!wsPath} />
        <RibbonButton Icon={Copy} label="Duplicate" onClick={() => activeId && duplicateModel(activeId)} disabled={!wsPath || !activeId} />
        <RibbonButton Icon={FileInput} label="Import SQL" title="Reverse-engineer a model from SQL DDL" onClick={props.onImport} disabled={!wsPath} />
      </RGroup>
      <RGroup title="Share">
        <RibbonButton
          Icon={Download}
          label="Export"
          title={exportReason ? `${exportReason} (workspace + semantic export still available)` : "Export DDL / YAML"}
          onClick={props.onOpenExport}
          disabled={!wsPath}
        />
        <RibbonButton Icon={History} label="History" onClick={props.onOpenHistory} disabled={!wsPath} />
      </RGroup>
    </>
  );
}

function HomeTab({ onOpenDomains }: { onOpenDomains: () => void }) {
  const modelName = useModelStore((s) => s.model.name);
  const level = useModelStore((s) => s.model.level);
  const notation = useModelStore((s) => s.model.notation ?? "IE");
  const setModelName = useModelStore((s) => s.setModelName);
  const setModelLevel = useModelStore((s) => s.setModelLevel);
  const setNotation = useModelStore((s) => s.setNotation);
  const pushNotice = useModelStore((s) => s.pushNotice);
  const createEntity = useModelStore((s) => s.createEntity);
  const arrange = useModelStore((s) => s.arrange);
  const arrangeStar = useModelStore((s) => s.arrangeStar);
  const hasStereotypes = useModelStore((s) => s.model.entities.some((e) => e.stereotype));
  const terms = levelTerms(level); // pure; computed in render (never inside a selector)
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const canUndo = useModelStore((s) => s.past.length > 0);
  const canRedo = useModelStore((s) => s.future.length > 0);

  const [nameDraft, setNameDraft] = useState(modelName);
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    setNameDraft(modelName);
    setNameError(null);
  }, [modelName]);

  const changeLevel = (next: ModelLevel) => {
    const ambiguous = setModelLevel(next);
    if (ambiguous.length) {
      const list = ambiguous.map((a) => `${a.entityName}.${a.fieldName}→${a.chosen.type}`).join(", ");
      pushNotice(`Chose a physical type for ${ambiguous.length} field(s); adjust if needed: ${list}`);
    }
  };

  return (
    <>
      <div className="rgroup">
        <div className="rgroup__row rgroup__row--form">
          <input
            className={`ribbon__model-input ${nameError ? "is-error" : ""}`}
            value={nameDraft}
            title={nameError ?? "Model name"}
            onChange={(e) => {
              setNameDraft(e.target.value);
              setNameError(setModelName(e.target.value));
            }}
          />
          <select className="ribbon__select" value={level} title="Modeling level" onChange={(e) => changeLevel(e.target.value as ModelLevel)}>
            {MODEL_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <button className="ribbon__chip" title="Toggle diagram notation" onClick={() => setNotation(notation === "IE" ? "IDEF1X" : "IE")}>
            {notation}
          </button>
        </div>
        <div className="rgroup__title">Model</div>
      </div>
      <RGroup title="Add">
        <RibbonButton Icon={Table} label={terms.entity} title={`Add ${terms.entity.toLowerCase()}`} onClick={() => createEntity()} />
        <RibbonButton Icon={Shapes} label="Domains" title="Reusable named types" onClick={onOpenDomains} />
      </RGroup>
      <RGroup title="Layout">
        <RibbonButton Icon={LayoutGrid} label="Arrange" title="Auto-arrange layout" onClick={arrange} />
        {hasStereotypes && <RibbonButton Icon={Star} label="Star" title="Star-schema layout (facts centre)" onClick={arrangeStar} />}
      </RGroup>
      <RGroup title="Edit">
        <RibbonButton Icon={Undo2} label="Undo" title="Undo (⌘Z)" onClick={undo} disabled={!canUndo} />
        <RibbonButton Icon={Redo2} label="Redo" title="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo} />
      </RGroup>
    </>
  );
}

function DiagramTab({
  onOpenMap,
  onToggleSemantic,
  semanticActive,
}: {
  onOpenMap: () => void;
  onToggleSemantic: () => void;
  semanticActive: boolean;
}) {
  const showGrid = useUiStore((s) => s.showGrid);
  const toggleGrid = useUiStore((s) => s.toggleGrid);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const toggleSnap = useUiStore((s) => s.toggleSnap);
  const z = (fn: "zoomIn" | "zoomOut" | "fitView" | "resetZoom") => () => canvasControls()?.[fn]();
  return (
    <>
      <RGroup title="Views">
        <RibbonButton Icon={MapIcon} label="Map" title="Workspace map" onClick={onOpenMap} />
        <RibbonButton Icon={Layers} label={semanticActive ? "Canvas" : "Semantic"} active={semanticActive} onClick={onToggleSemantic} />
      </RGroup>
      <RGroup title="Canvas">
        <RibbonButton Icon={Grid3x3} label="Grid" active={showGrid} onClick={toggleGrid} />
        <RibbonButton Icon={Magnet} label="Snap" active={snapToGrid} onClick={toggleSnap} />
        <RibbonButton Icon={ZoomOut} label="Zoom out" onClick={z("zoomOut")} />
        <RibbonButton Icon={ZoomIn} label="Zoom in" onClick={z("zoomIn")} />
        <RibbonButton Icon={Maximize2} label="Fit" onClick={z("fitView")} />
        <RibbonButton Icon={Scan} label="Reset" onClick={z("resetZoom")} />
      </RGroup>
    </>
  );
}

function DataTab({
  onOpenConnections,
  onReverseEngineer,
  onOpenPipelines,
  onOpenSnapshot,
}: {
  onOpenConnections: () => void;
  onReverseEngineer: () => void;
  onOpenPipelines: () => void;
  onOpenSnapshot: () => void;
}) {
  const wsPath = useWorkspaceStore((s) => s.path);
  return (
    <>
      <RGroup title="Reverse-engineer">
        <RibbonButton Icon={Database} label="Connect" title="Manage database connections" onClick={onOpenConnections} disabled={!wsPath} />
        <RibbonButton Icon={DatabaseZap} label="Reverse-engineer" title="Discover a database schema into a new model" onClick={onReverseEngineer} disabled={!wsPath} />
        <RibbonButton Icon={Camera} label="Source snapshot" title="Browse this model's discovery snapshot (API resources, extract stores, EBS dictionary)" onClick={onOpenSnapshot} disabled={!wsPath} />
      </RGroup>
      <RGroup title="ETL">
        <RibbonButton Icon={Workflow} label="Pipelines" title="Design an ETL pipeline" onClick={onOpenPipelines} disabled={!wsPath} />
      </RGroup>
    </>
  );
}

function SearchBox() {
  const search = useModelStore((s) => s.search);
  const [query, setQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);
  return (
    <div className={`ribbon__search ${noMatch ? "is-error" : ""}`}>
      <Search size={14} strokeWidth={1.75} aria-hidden />
      <input
        placeholder="Search entities…"
        aria-label="Search entities"
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          if (v.trim()) setNoMatch(!search(v));
          else setNoMatch(false);
        }}
      />
    </div>
  );
}
