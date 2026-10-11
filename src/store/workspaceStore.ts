import { create } from "zustand";
import { useModelStore } from "./modelStore";
import type { DbDialect, Model } from "../model/model";
import { newModel as createModel } from "../model/model";
import type { ModelLevel } from "../model/levels";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import {
  modelFileName,
  modelNameFromFile,
  isModelFile,
  snapshotFileName,
  CONNECTIONS_FILE,
  PIPELINES_FILE,
  LINKS_FILE,
  SEMANTIC_FILE,
  WORKSPACE_FILE,
} from "../persist/filenames";
import {
  type SourceSnapshot,
  parseSnapshot,
  serializeSnapshot,
} from "../connectors/snapshot";
import type { ConnectionProfile } from "../connectors/connection";
import {
  type ConnectionsDoc,
  emptyConnectionsDoc,
  parseConnectionsFile,
  serializeConnections,
} from "../connectors/connectionsPersist";
import { secretDelete } from "../connectors/postgres/postgresConnector";
import type { PipelineSpec } from "../connectors/pipeline/spec";
import {
  type PipelinesDoc,
  emptyPipelinesDoc,
  parsePipelinesFile,
  serializePipelines,
} from "../connectors/pipeline/pipelinesPersist";
import {
  type WorkspaceMeta,
  serializeWorkspace,
  emptyLinksFile,
  emptySemanticFile,
} from "../persist/workspaceFiles";
import {
  appStateGet,
  appStateSet,
  baseName,
  deleteFile,
  dirName,
  fileMtime,
  joinPath,
  listWorkspace,
  pickFile,
  pickWorkspaceFolder,
  readTextFile,
  writeFile,
} from "../persist/fs";
import { validateIdentifier } from "../model/identifiers";
import { newId } from "../lib/ids";
import {
  type ConceptGroup,
  type Link,
  type LinksDoc,
  type Ref,
  emptyLinksDoc,
  removeLinksTouching,
} from "../links/links";
import { serializeLinks, parseLinksFile } from "../links/linksPersist";
import {
  type Cube,
  type Dimension,
  type Metric,
  type SemanticDoc,
  type Term,
  emptySemanticDoc,
} from "../semantic/semantic";
import { serializeSemantic, parseSemanticFile } from "../semantic/semanticPersist";

const AUTOSAVE_MS = 2000; // FR-5.4
const PIPELINE_HISTORY_CAP = 50; // per-pipeline undo depth (parity with model undo)

export interface Tab {
  /** model.id for valid models, or `err:<file>` for a file that failed to load. */
  id: string;
  fileName: string;
  model: Model | null;
  lastSavedText: string;
  savedMtime: number | null;
  externalChange: boolean;
  loadError: string | null;
}

interface WorkspaceState {
  path: string | null;
  name: string;
  createdAt: string;
  tabs: Tab[];
  /** All model filenames in the workspace folder (open + closed), for the “open model”
   *  picker. Closing a tab keeps the file here so it can be reopened. */
  availableFiles: string[];
  activeId: string | null;
  saving: boolean;
  links: LinksDoc;
  semantic: SemanticDoc;
  connections: ConnectionProfile[];
  pipelines: PipelineSpec[];

  openWorkspacePicker: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  /** Pick a single .model.json file; open its folder as the workspace (if not already
   *  open) and activate that model — the file-oriented alternative to opening a folder. */
  openModelFilePicker: () => Promise<void>;
  restoreLastWorkspace: () => Promise<void>;
  newModel: (name: string, level?: ModelLevel, dialect?: DbDialect) => Promise<string | null>;
  importModel: (model: Model, name: string) => Promise<string | null>;
  duplicateModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  /** Close a model tab WITHOUT deleting its file (keeps it in availableFiles). */
  closeTab: (id: string) => Promise<void>;
  /** Open a model file from the workspace folder into a tab (or switch if already open). */
  openModelFile: (fileName: string) => Promise<void>;
  switchTab: (id: string) => Promise<void>;
  saveActive: (explicit: boolean) => Promise<void>;
  scheduleAutosave: () => void;
  checkExternalChanges: () => Promise<void>;
  reloadFromDisk: (id: string) => Promise<void>;
  keepMine: (id: string) => Promise<void>;
  restoreHistory: (file: string) => Promise<void>;
  isActiveDirty: () => boolean;

  // cross-model links (FR-6)
  allModels: () => { id: string; name: string; model: Model }[];
  addLink: (link: Link) => void;
  deleteLink: (id: string) => void;
  upsertConceptGroup: (group: ConceptGroup) => void;
  deleteConceptGroup: (id: string) => void;
  removeLinksForRef: (ref: Ref) => Link[];

  // source connections (connector framework). Secrets live in the OS keychain,
  // never in this state or connections.json — only a secretRef is stored.
  upsertConnection: (profile: ConnectionProfile) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  saveSnapshot: (connectionName: string, snapshot: SourceSnapshot) => Promise<void>;
  loadSnapshot: (connectionName: string) => Promise<SourceSnapshot | null>;

  // ETL pipeline specs (connector framework Phase 5).
  upsertPipeline: (spec: PipelineSpec) => Promise<void>;
  deletePipeline: (id: string) => Promise<void>;
  /** Per-pipeline edit history for undo/redo in the ETL Designer (G-UNDO). Transient
   *  (session-only, never written to pipelines.json), keyed by pipeline id. Each
   *  `upsertPipeline` pushes the prior version onto `past` and clears `future`. */
  pipelineHistory: Record<string, { past: PipelineSpec[]; future: PipelineSpec[] }>;
  undoPipeline: (id: string) => Promise<void>;
  redoPipeline: (id: string) => Promise<void>;

  // semantic layer (FR-7)
  addTerm: (term: Term) => void;
  updateTerm: (id: string, patch: Partial<Term>) => void;
  deleteTerm: (id: string) => void;
  addDimension: (dim: Dimension) => void;
  updateDimension: (id: string, patch: Partial<Dimension>) => void;
  deleteDimension: (id: string) => void;
  addMetric: (metric: Metric) => void;
  updateMetric: (id: string, patch: Partial<Metric>) => void;
  deleteMetric: (id: string) => void;
  addCube: (cube: Cube) => void;
  updateCube: (id: string, patch: Partial<Cube>) => void;
  deleteCube: (id: string) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  function activeTab(): Tab | undefined {
    const { tabs, activeId } = get();
    return tabs.find((t) => t.id === activeId);
  }

  function replaceTab(id: string, patch: Partial<Tab>): void {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  async function writeWorkspaceMeta(): Promise<void> {
    const { path, name, createdAt, tabs, activeId } = get();
    if (!path) return;
    const active = tabs.find((t) => t.id === activeId);
    const meta: WorkspaceMeta = {
      formatVersion: 1,
      name,
      createdAt,
      updatedAt: nowIso(),
      openModels: tabs.map((t) => t.fileName),
      activeModel: active?.fileName,
    };
    await writeFile(joinPath(path, WORKSPACE_FILE), serializeWorkspace(meta), false);
  }

  /** Update links state and persist links.json (FR-6.5). */
  function commitLinks(doc: LinksDoc): void {
    set({ links: doc });
    const { path } = get();
    if (path) {
      void writeFile(joinPath(path, LINKS_FILE), serializeLinks(doc), false).catch(() => {});
    }
  }

  /** Update semantic state and persist semantic.json. */
  function commitSemantic(doc: SemanticDoc): void {
    set({ semantic: doc });
    const { path } = get();
    if (path) {
      void writeFile(joinPath(path, SEMANTIC_FILE), serializeSemantic(doc), false).catch(() => {});
    }
  }

  /** Update connections state and persist connections.json (credential-free). */
  async function commitConnections(doc: ConnectionsDoc): Promise<void> {
    set({ connections: doc.connections });
    const { path } = get();
    if (path) await writeFile(joinPath(path, CONNECTIONS_FILE), serializeConnections(doc), false);
  }

  /** Update pipeline state and persist pipelines.json. */
  async function commitPipelines(doc: PipelinesDoc): Promise<void> {
    set({ pipelines: doc.pipelines });
    const { path } = get();
    if (path) await writeFile(joinPath(path, PIPELINES_FILE), serializePipelines(doc), false);
  }

  /** Load a valid tab's model into the editor; sync the previously active tab back. */
  function activate(id: string): void {
    const { tabs, activeId } = get();
    // Park the currently active model back into its tab.
    if (activeId && activeId !== id) {
      const current = tabs.find((t) => t.id === activeId);
      if (current && !current.loadError) {
        replaceTab(activeId, { model: useModelStore.getState().model });
      }
    }
    const target = get().tabs.find((t) => t.id === id);
    set({ activeId: id });
    if (target && target.model && !target.loadError) {
      useModelStore.getState().loadModel(target.model);
    }
  }

  return {
    path: null,
    name: "",
    createdAt: nowIso(),
    tabs: [],
    availableFiles: [],
    activeId: null,
    saving: false,
    links: emptyLinksDoc(),
    semantic: emptySemanticDoc(),
    connections: [],
    pipelines: [],
    pipelineHistory: {},

    openWorkspacePicker: async () => {
      const dir = await pickWorkspaceFolder();
      if (dir) await get().openWorkspace(dir);
    },

    openModelFilePicker: async () => {
      const filePath = await pickFile(["json"], "Open model file (.model.json)");
      if (!filePath) return;
      const fileName = baseName(filePath);
      if (!isModelFile(fileName)) {
        useModelStore.getState().pushNotice(`“${fileName}” is not a .model.json file`);
        return;
      }
      // A model lives inside a workspace folder: open that folder (unless already open),
      // then open/activate the chosen model via the same path as the + reopen picker.
      const dir = dirName(filePath);
      if (get().path !== dir) await get().openWorkspace(dir);
      await get().openModelFile(fileName);
    },

    openWorkspace: async (path) => {
      // Persist unsaved edits in the outgoing workspace before we replace all state
      // (covers both the folder picker and "Open model file…"). No-op on first launch.
      if (get().isActiveDirty()) await get().saveActive(false);
      const listing = await listWorkspace(path);

      // Ensure the workspace always has the full FR-5.1 shape.
      if (listing.links == null) {
        await writeFile(joinPath(path, LINKS_FILE), emptyLinksFile(), false);
      }
      if (listing.semantic == null) {
        await writeFile(joinPath(path, SEMANTIC_FILE), emptySemanticFile(), false);
      }

      // Load cross-model links (FR-6.5). A malformed file surfaces a notice and
      // is left untouched (FR-5.7); the workspace still opens.
      let links = emptyLinksDoc();
      if (listing.links != null) {
        const parsedLinks = parseLinksFile(listing.links);
        if (parsedLinks.ok) links = parsedLinks.value;
        else useModelStore.getState().pushNotice(`links.json: ${parsedLinks.error}`);
      }

      let semantic = emptySemanticDoc();
      if (listing.semantic != null) {
        const parsedSem = parseSemanticFile(listing.semantic);
        if (parsedSem.ok) semantic = parsedSem.value;
        else useModelStore.getState().pushNotice(`semantic.json: ${parsedSem.error}`);
      }

      // Source connections (optional file; absent in older/plain workspaces).
      let connections: ConnectionProfile[] = [];
      try {
        const connText = await readTextFile(joinPath(path, CONNECTIONS_FILE));
        const parsedConn = parseConnectionsFile(connText);
        if (parsedConn.ok) connections = parsedConn.value.connections;
        else useModelStore.getState().pushNotice(`connections.json: ${parsedConn.error}`);
      } catch {
        // No connections.json yet — that's fine.
      }

      // Pipeline specs (optional file).
      let pipelines: PipelineSpec[] = [];
      try {
        const pipeText = await readTextFile(joinPath(path, PIPELINES_FILE));
        const parsedPipe = parsePipelinesFile(pipeText);
        if (parsedPipe.ok) pipelines = parsedPipe.value.pipelines;
        else useModelStore.getState().pushNotice(`pipelines.json: ${parsedPipe.error}`);
      } catch {
        // No pipelines.json yet.
      }

      let meta: Partial<WorkspaceMeta> = {};
      if (listing.workspace) {
        try {
          meta = JSON.parse(listing.workspace);
        } catch {
          meta = {};
        }
      }
      const name = meta.name || baseName(path);
      const createdAt = meta.createdAt || nowIso();

      // All model files in the folder, and which to OPEN as tabs: the previously-open
      // set (meta.openModels) if recorded, else just the active/first model — so opening
      // a folder no longer force-opens every model. The rest stay reopenable (availableFiles).
      const allFiles = listing.model_files.filter(isModelFile);
      let toOpen: string[];
      if (meta.openModels && meta.openModels.length) {
        toOpen = allFiles.filter((fn) => meta.openModels!.includes(fn));
      } else if (meta.activeModel && allFiles.includes(meta.activeModel)) {
        toOpen = [meta.activeModel];
      } else {
        toOpen = allFiles.slice(0, 1);
      }
      if (!toOpen.length && allFiles.length) toOpen = allFiles.slice(0, 1);

      const tabs: Tab[] = [];
      for (const fn of toOpen) {
        const full = joinPath(path, fn);
        const text = await readTextFile(full);
        const mt = await fileMtime(full);
        const parsed = parseModelFile(text);
        if (parsed.ok) {
          tabs.push({
            id: parsed.value.id,
            fileName: fn,
            model: parsed.value,
            lastSavedText: serializeModel(parsed.value),
            savedMtime: mt,
            externalChange: false,
            loadError: null,
          });
        } else {
          tabs.push({
            id: `err:${fn}`,
            fileName: fn,
            model: null,
            lastSavedText: "",
            savedMtime: mt,
            externalChange: false,
            loadError: parsed.error,
          });
        }
      }

      const activeFromMeta = meta.activeModel
        ? tabs.find((t) => t.fileName === meta.activeModel)
        : undefined;
      const firstValid = tabs.find((t) => !t.loadError);
      const active = activeFromMeta && !activeFromMeta.loadError ? activeFromMeta : firstValid;

      set({
        path,
        name,
        createdAt,
        tabs,
        availableFiles: allFiles,
        links,
        semantic,
        connections,
        pipelines,
        activeId: active?.id ?? tabs[0]?.id ?? null,
      });
      if (active?.model) useModelStore.getState().loadModel(active.model);

      await appStateSet(JSON.stringify({ lastWorkspace: path }));
      await writeWorkspaceMeta();
      // An empty folder leaves activeId null; the UI prompts to create the first
      // model (choosing its level) rather than silently seeding one.
    },

    restoreLastWorkspace: async () => {
      try {
        const raw = await appStateGet();
        if (!raw) return;
        const state = JSON.parse(raw) as { lastWorkspace?: string };
        if (state.lastWorkspace) await get().openWorkspace(state.lastWorkspace);
      } catch {
        // No saved state or unreadable — start with no workspace open.
      }
    },

    newModel: async (name, level = "Physical", dialect) => {
      const { path, tabs } = get();
      if (!path) return "Open a workspace first";
      const err = validateIdentifier(name);
      if (err) return err;
      if (tabs.some((t) => modelNameFromFile(t.fileName) === name)) {
        return `A model named ${name} already exists`;
      }
      const model = createModel(name, nowIso(), level, dialect);
      const fileName = modelFileName(name);
      const text = serializeModel(model);
      const mt = await writeFile(joinPath(path, fileName), text, false);
      const tab: Tab = {
        id: model.id,
        fileName,
        model,
        lastSavedText: text,
        savedMtime: mt,
        externalChange: false,
        loadError: null,
      };
      set((s) => ({ tabs: [...s.tabs, tab], availableFiles: s.availableFiles.includes(fileName) ? s.availableFiles : [...s.availableFiles, fileName] }));
      activate(model.id);
      await writeWorkspaceMeta();
      return null;
    },

    // Add a fully-built model (e.g. reverse-engineered from DDL) to the workspace.
    importModel: async (model, name) => {
      const { path, tabs } = get();
      if (!path) return "Open a workspace first";
      const err = validateIdentifier(name);
      if (err) return err;
      if (tabs.some((t) => modelNameFromFile(t.fileName) === name)) {
        return `A model named ${name} already exists`;
      }
      const toAdd: Model = { ...model, id: newId("model"), name, createdAt: nowIso(), updatedAt: nowIso() };
      const fileName = modelFileName(name);
      const text = serializeModel(toAdd);
      const mt = await writeFile(joinPath(path, fileName), text, false);
      set((s) => ({
        tabs: [
          ...s.tabs,
          {
            id: toAdd.id,
            fileName,
            model: toAdd,
            lastSavedText: text,
            savedMtime: mt,
            externalChange: false,
            loadError: null,
          },
        ],
        availableFiles: s.availableFiles.includes(fileName) ? s.availableFiles : [...s.availableFiles, fileName],
      }));
      activate(toAdd.id);
      await writeWorkspaceMeta();
      return null;
    },

    duplicateModel: async (id) => {
      const { path, tabs } = get();
      if (!path) return;
      const src = tabs.find((t) => t.id === id);
      if (!src || !src.model) return;
      let name = `${modelNameFromFile(src.fileName)}_copy`;
      let i = 2;
      while (tabs.some((t) => modelNameFromFile(t.fileName) === name)) {
        name = `${modelNameFromFile(src.fileName)}_copy_${i++}`;
      }
      const copy: Model = {
        ...structuredClone(src.model),
        id: newId("model"),
        name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const fileName = modelFileName(name);
      const text = serializeModel(copy);
      const mt = await writeFile(joinPath(path, fileName), text, false);
      set((s) => ({
        tabs: [
          ...s.tabs,
          {
            id: copy.id,
            fileName,
            model: copy,
            lastSavedText: text,
            savedMtime: mt,
            externalChange: false,
            loadError: null,
          },
        ],
        availableFiles: s.availableFiles.includes(fileName) ? s.availableFiles : [...s.availableFiles, fileName],
      }));
      activate(copy.id);
      await writeWorkspaceMeta();
    },

    deleteModel: async (id) => {
      const { path, tabs } = get();
      if (!path) return;
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      await deleteFile(joinPath(path, tab.fileName));
      const remaining = tabs.filter((t) => t.id !== id);
      // Drop the deleted file from both the open tabs and the reopen picker up front, so
      // it can't linger in availableFiles when the last-model branch below returns early.
      set((s) => ({ tabs: remaining, availableFiles: s.availableFiles.filter((f) => f !== tab.fileName) }));
      if (get().activeId === id) {
        const next = remaining.find((t) => !t.loadError) ?? remaining[0];
        if (next) {
          set({ activeId: next.id });
          if (next.model) useModelStore.getState().loadModel(next.model);
        } else {
          set({ activeId: null });
          await get().newModel("untitled");
          return;
        }
      }
      await writeWorkspaceMeta();
    },

    closeTab: async (id) => {
      const { tabs } = get();
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      // Persist any pending edits before closing (autosave discipline); the file stays.
      if (get().activeId === id && get().isActiveDirty()) await get().saveActive(false);
      const remaining = tabs.filter((t) => t.id !== id);
      set({ tabs: remaining });
      if (get().activeId === id) {
        const next = remaining.find((t) => !t.loadError) ?? remaining[0];
        set({ activeId: next?.id ?? null });
        if (next?.model) {
          useModelStore.getState().loadModel(next.model);
        } else {
          // No tab left: reset the model store to a fresh blank so nothing renders or
          // edits the just-closed model (loadModel clears selection/propertiesOpen/notices).
          // The ribbon's model tabs are gated on activeId, so this blank is never editable.
          useModelStore.getState().loadModel(createModel("untitled", nowIso()));
        }
      }
      await writeWorkspaceMeta(); // openModels shrinks → the closed tab stays closed on reopen
    },

    openModelFile: async (fileName) => {
      const { path, tabs } = get();
      if (!path) return;
      const existing = tabs.find((t) => t.fileName === fileName);
      if (existing) {
        await get().switchTab(existing.id);
        return;
      }
      const full = joinPath(path, fileName);
      const text = await readTextFile(full);
      const mt = await fileMtime(full);
      const parsed = parseModelFile(text);
      const tab: Tab = parsed.ok
        ? { id: parsed.value.id, fileName, model: parsed.value, lastSavedText: serializeModel(parsed.value), savedMtime: mt, externalChange: false, loadError: null }
        : { id: `err:${fileName}`, fileName, model: null, lastSavedText: "", savedMtime: mt, externalChange: false, loadError: parsed.error };
      set((s) => ({
        tabs: [...s.tabs, tab],
        availableFiles: s.availableFiles.includes(fileName) ? s.availableFiles : [...s.availableFiles, fileName],
      }));
      if (get().isActiveDirty()) await get().saveActive(false);
      set({ activeId: tab.id });
      if (tab.model) useModelStore.getState().loadModel(tab.model);
      await writeWorkspaceMeta();
    },

    switchTab: async (id) => {
      if (id === get().activeId) return;
      if (get().isActiveDirty()) await get().saveActive(false);
      activate(id);
      await writeWorkspaceMeta();
    },

    saveActive: async (explicit) => {
      const { path } = get();
      const tab = activeTab();
      if (!path || !tab || tab.loadError) {
        if (explicit && !path) {
          useModelStore.getState().pushNotice("Open a workspace to save (⌘S).");
        }
        return;
      }
      const model = useModelStore.getState().model;
      const text = serializeModel(model);
      if (!explicit && text === tab.lastSavedText) return; // nothing changed

      set({ saving: true });
      try {
        const desired = modelFileName(model.name);
        let fileName = tab.fileName;
        if (desired !== tab.fileName) {
          const clash = get().tabs.some((t) => t.id !== tab.id && t.fileName === desired);
          if (clash) {
            useModelStore
              .getState()
              .pushNotice(`Can't rename file: a model named ${model.name} already exists.`);
          } else {
            const mt = await writeFile(joinPath(path, desired), text, false);
            await deleteFile(joinPath(path, tab.fileName));
            replaceTab(tab.id, {
              fileName: desired,
              lastSavedText: text,
              savedMtime: mt,
              model,
              externalChange: false,
            });
            fileName = desired;
            await writeWorkspaceMeta();
            return;
          }
        }
        const mt = await writeFile(joinPath(path, fileName), text, true);
        replaceTab(tab.id, {
          lastSavedText: text,
          savedMtime: mt,
          model,
          externalChange: false,
        });
      } finally {
        set({ saving: false });
      }
    },

    scheduleAutosave: () => {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        get().saveActive(false);
      }, AUTOSAVE_MS);
    },

    checkExternalChanges: async () => {
      const { path, tabs } = get();
      if (!path) return;
      for (const tab of tabs) {
        if (tab.savedMtime == null) continue;
        const mt = await fileMtime(joinPath(path, tab.fileName));
        if (mt != null && mt !== tab.savedMtime && !tab.externalChange) {
          replaceTab(tab.id, { externalChange: true });
        }
      }
    },

    reloadFromDisk: async (id) => {
      const { path, tabs } = get();
      if (!path) return;
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      const full = joinPath(path, tab.fileName);
      const text = await readTextFile(full);
      const mt = await fileMtime(full);
      const parsed = parseModelFile(text);
      if (parsed.ok) {
        replaceTab(tab.id, {
          model: parsed.value,
          lastSavedText: serializeModel(parsed.value),
          savedMtime: mt,
          externalChange: false,
          loadError: null,
        });
        if (get().activeId === id) useModelStore.getState().loadModel(parsed.value);
      } else {
        replaceTab(tab.id, { loadError: parsed.error, externalChange: false, savedMtime: mt });
      }
    },

    keepMine: async (id) => {
      replaceTab(id, { externalChange: false });
      if (get().activeId === id) await get().saveActive(true);
    },

    restoreHistory: async (file) => {
      const text = await readTextFile(file);
      const parsed = parseModelFile(text);
      if (!parsed.ok) {
        useModelStore.getState().pushNotice(`Can't restore: ${parsed.error}`);
        return;
      }
      // Load the historical version as the active model, then save it (which
      // snapshots the current version first, so the restore is itself undoable).
      useModelStore.getState().loadModel(parsed.value);
      await get().saveActive(true);
    },

    isActiveDirty: () => {
      const tab = activeTab();
      if (!tab || tab.loadError) return false;
      return serializeModel(useModelStore.getState().model) !== tab.lastSavedText;
    },

    allModels: () => {
      const { tabs, activeId } = get();
      const active = useModelStore.getState().model;
      const out: { id: string; name: string; model: Model }[] = [];
      for (const t of tabs) {
        const m = t.id === activeId ? active : t.model;
        if (m && !t.loadError) out.push({ id: m.id, name: m.name, model: m });
      }
      return out;
    },

    addLink: (link) => {
      const doc = get().links;
      commitLinks({ ...doc, links: [...doc.links, link] });
    },

    deleteLink: (id) => {
      const doc = get().links;
      commitLinks({ ...doc, links: doc.links.filter((l) => l.id !== id) });
    },

    upsertConceptGroup: (group) => {
      const doc = get().links;
      const exists = doc.conceptGroups.some((g) => g.id === group.id);
      commitLinks({
        ...doc,
        conceptGroups: exists
          ? doc.conceptGroups.map((g) => (g.id === group.id ? group : g))
          : [...doc.conceptGroups, group],
      });
    },

    deleteConceptGroup: (id) => {
      const doc = get().links;
      commitLinks({ ...doc, conceptGroups: doc.conceptGroups.filter((g) => g.id !== id) });
    },

    removeLinksForRef: (ref) => {
      const doc = get().links;
      const { kept, removed } = removeLinksTouching(doc.links, ref);
      // Drop concept groups whose canonical entity is the one being deleted.
      const conceptGroups = ref.field
        ? doc.conceptGroups
        : doc.conceptGroups.filter(
            (g) => !(g.canonical.model === ref.model && g.canonical.entity === ref.entity),
          );
      commitLinks({ ...doc, links: kept, conceptGroups });
      return removed;
    },

    upsertConnection: async (profile) => {
      const current = get().connections;
      const exists = current.some((c) => c.id === profile.id);
      const next = exists
        ? current.map((c) => (c.id === profile.id ? profile : c))
        : [...current, profile];
      await commitConnections({ ...emptyConnectionsDoc(), connections: next });
    },

    deleteConnection: async (id) => {
      const current = get().connections;
      const target = current.find((c) => c.id === id);
      await commitConnections({
        ...emptyConnectionsDoc(),
        connections: current.filter((c) => c.id !== id),
      });
      // Best-effort removal of the stored credential.
      if (target?.secretRef) await secretDelete(target.secretRef).catch(() => {});
    },

    saveSnapshot: async (connectionName, snapshot) => {
      const { path } = get();
      if (!path) return;
      await writeFile(joinPath(path, snapshotFileName(connectionName)), serializeSnapshot(snapshot), true);
    },

    loadSnapshot: async (connectionName) => {
      const { path } = get();
      if (!path) return null;
      try {
        const text = await readTextFile(joinPath(path, snapshotFileName(connectionName)));
        const parsed = parseSnapshot(text);
        if (parsed.ok) return parsed.value;
        useModelStore.getState().pushNotice(`snapshot for ${connectionName}: ${parsed.error}`);
        return null;
      } catch {
        return null; // no prior snapshot
      }
    },

    upsertPipeline: async (spec) => {
      const current = get().pipelines;
      const prev = current.find((p) => p.id === spec.id);
      const next = prev ? current.map((p) => (p.id === spec.id ? spec : p)) : [...current, spec];
      // Record the prior version for undo (new pipelines have no prior; graph edits return
      // fresh specs so `prev !== spec` whenever there's a real change — skip no-op saves).
      if (prev && prev !== spec) {
        set((s) => {
          const h = s.pipelineHistory[spec.id] ?? { past: [], future: [] };
          return {
            pipelineHistory: {
              ...s.pipelineHistory,
              [spec.id]: { past: [...h.past, prev].slice(-PIPELINE_HISTORY_CAP), future: [] },
            },
          };
        });
      }
      await commitPipelines({ ...emptyPipelinesDoc(), pipelines: next });
    },

    undoPipeline: async (id) => {
      const h = get().pipelineHistory[id];
      const cur = get().pipelines.find((p) => p.id === id);
      if (!h || !h.past.length || !cur) return;
      const prev = h.past[h.past.length - 1];
      set((s) => ({
        pipelineHistory: {
          ...s.pipelineHistory,
          [id]: { past: h.past.slice(0, -1), future: [...h.future, cur] },
        },
      }));
      await commitPipelines({
        ...emptyPipelinesDoc(),
        pipelines: get().pipelines.map((p) => (p.id === id ? prev : p)),
      });
    },

    redoPipeline: async (id) => {
      const h = get().pipelineHistory[id];
      const cur = get().pipelines.find((p) => p.id === id);
      if (!h || !h.future.length || !cur) return;
      const nextSpec = h.future[h.future.length - 1];
      set((s) => ({
        pipelineHistory: {
          ...s.pipelineHistory,
          [id]: { past: [...h.past, cur], future: h.future.slice(0, -1) },
        },
      }));
      await commitPipelines({
        ...emptyPipelinesDoc(),
        pipelines: get().pipelines.map((p) => (p.id === id ? nextSpec : p)),
      });
    },

    deletePipeline: async (id) => {
      // Drop the pipeline and its (transient) undo history together.
      set((s) => {
        const { [id]: _removed, ...rest } = s.pipelineHistory;
        return { pipelineHistory: rest };
      });
      await commitPipelines({
        ...emptyPipelinesDoc(),
        pipelines: get().pipelines.filter((p) => p.id !== id),
      });
    },

    addTerm: (term) => {
      const s = get().semantic;
      commitSemantic({ ...s, terms: [...s.terms, term] });
    },
    updateTerm: (id, patch) => {
      const s = get().semantic;
      commitSemantic({ ...s, terms: s.terms.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    },
    deleteTerm: (id) => {
      const s = get().semantic;
      commitSemantic({ ...s, terms: s.terms.filter((t) => t.id !== id) });
    },

    addDimension: (dim) => {
      const s = get().semantic;
      commitSemantic({ ...s, dimensions: [...s.dimensions, dim] });
    },
    updateDimension: (id, patch) => {
      const s = get().semantic;
      commitSemantic({
        ...s,
        dimensions: s.dimensions.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      });
    },
    deleteDimension: (id) => {
      const s = get().semantic;
      commitSemantic({ ...s, dimensions: s.dimensions.filter((d) => d.id !== id) });
    },

    addMetric: (metric) => {
      const s = get().semantic;
      commitSemantic({ ...s, metrics: [...s.metrics, metric] });
    },
    updateMetric: (id, patch) => {
      const s = get().semantic;
      commitSemantic({
        ...s,
        metrics: s.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      });
    },
    deleteMetric: (id) => {
      const s = get().semantic;
      commitSemantic({ ...s, metrics: s.metrics.filter((m) => m.id !== id) });
    },

    addCube: (cube) => {
      const s = get().semantic;
      commitSemantic({ ...s, cubes: [...(s.cubes ?? []), cube] });
    },
    updateCube: (id, patch) => {
      const s = get().semantic;
      commitSemantic({
        ...s,
        cubes: (s.cubes ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
      });
    },
    deleteCube: (id) => {
      const s = get().semantic;
      commitSemantic({ ...s, cubes: (s.cubes ?? []).filter((c) => c.id !== id) });
    },
  };
});
