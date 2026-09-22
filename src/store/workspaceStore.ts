import { create } from "zustand";
import { useModelStore } from "./modelStore";
import type { Model } from "../model/model";
import { newModel as createModel } from "../model/model";
import type { ModelLevel } from "../model/levels";
import { serializeModel } from "../persist/serialize";
import { parseModelFile } from "../persist/schema";
import {
  modelFileName,
  modelNameFromFile,
  isModelFile,
  LINKS_FILE,
  SEMANTIC_FILE,
  WORKSPACE_FILE,
} from "../persist/filenames";
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
  fileMtime,
  joinPath,
  listWorkspace,
  pickWorkspaceFolder,
  readTextFile,
  writeFile,
} from "../persist/fs";
import { validateIdentifier } from "../model/identifiers";
import { newId } from "../lib/ids";

const AUTOSAVE_MS = 2000; // FR-5.4

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
  activeId: string | null;
  saving: boolean;

  openWorkspacePicker: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  restoreLastWorkspace: () => Promise<void>;
  newModel: (name: string, level?: ModelLevel) => Promise<string | null>;
  duplicateModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  switchTab: (id: string) => Promise<void>;
  saveActive: (explicit: boolean) => Promise<void>;
  scheduleAutosave: () => void;
  checkExternalChanges: () => Promise<void>;
  reloadFromDisk: (id: string) => Promise<void>;
  keepMine: (id: string) => Promise<void>;
  restoreHistory: (file: string) => Promise<void>;
  isActiveDirty: () => boolean;
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
    activeId: null,
    saving: false,

    openWorkspacePicker: async () => {
      const dir = await pickWorkspaceFolder();
      if (dir) await get().openWorkspace(dir);
    },

    openWorkspace: async (path) => {
      const listing = await listWorkspace(path);

      // Ensure the workspace always has the full FR-5.1 shape.
      if (listing.links == null) {
        await writeFile(joinPath(path, LINKS_FILE), emptyLinksFile(), false);
      }
      if (listing.semantic == null) {
        await writeFile(joinPath(path, SEMANTIC_FILE), emptySemanticFile(), false);
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

      const tabs: Tab[] = [];
      for (const fn of listing.model_files.filter(isModelFile)) {
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

      set({ path, name, createdAt, tabs, activeId: active?.id ?? tabs[0]?.id ?? null });
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

    newModel: async (name, level = "Physical") => {
      const { path, tabs } = get();
      if (!path) return "Open a workspace first";
      const err = validateIdentifier(name);
      if (err) return err;
      if (tabs.some((t) => modelNameFromFile(t.fileName) === name)) {
        return `A model named ${name} already exists`;
      }
      const model = createModel(name, nowIso(), level);
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
      set((s) => ({ tabs: [...s.tabs, tab] }));
      activate(model.id);
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
      set({ tabs: remaining });
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
  };
});
