// Thin TypeScript wrappers over the Rust file-layer commands and the folder
// picker. Everything the UI touches for persistence goes through here.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface WorkspaceListing {
  model_files: string[];
  workspace: string | null;
  links: string | null;
  semantic: string | null;
}

export interface HistoryEntry {
  file: string;
  name: string;
  timestamp: number;
}

/** Join a directory and a file name with a POSIX separator (macOS target). */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

/** The folder name, used as a default workspace name. */
export function baseName(dir: string): string {
  const parts = dir.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || dir;
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title: "Open workspace folder" });
  return typeof res === "string" ? res : null;
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** Atomic write; `history` snapshots the previous version first. Returns mtime (ms). */
export function writeFile(path: string, contents: string, history = false): Promise<number> {
  return invoke<number>("write_file", { path, contents, history });
}

export function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export function fileMtime(path: string): Promise<number | null> {
  return invoke<number | null>("file_mtime", { path });
}

export function listWorkspace(dir: string): Promise<WorkspaceListing> {
  return invoke<WorkspaceListing>("list_workspace", { dir });
}

export function listHistory(dir: string, base: string): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("list_history", { dir, base });
}

export function appStateGet(): Promise<string | null> {
  return invoke<string | null>("app_state_get");
}

export function appStateSet(contents: string): Promise<void> {
  return invoke("app_state_set", { contents });
}
