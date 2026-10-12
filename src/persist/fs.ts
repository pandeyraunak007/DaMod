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

// Path helpers are separator-agnostic (POSIX "/" and Windows "\") so the app works on
// macOS and Windows. The OS file dialogs return native paths (e.g. C:\Users\you\models on
// Windows); the Rust file layer uses std::path and accepts either separator.

/** Join a directory and a file name, matching the directory's own separator when it uses
 *  backslashes (Windows), else "/". Avoids producing mixed separators. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[/\\]+$/, "")}${sep}${name}`;
}

/** The final path segment (folder or file name). Splits on "/" or "\". */
export function baseName(p: string): string {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** The parent directory of a path (everything before the last "/" or "\"). */
export function dirName(filePath: string): string {
  const trimmed = filePath.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < 0) return trimmed; // no separator → the path itself
  if (idx === 0) return "/"; // POSIX root
  return trimmed.slice(0, idx);
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title: "Open workspace folder" });
  return typeof res === "string" ? res : null;
}

/** Pick a single file with the given extensions (e.g. ["sql"]). */
export async function pickFile(extensions: string[], title: string): Promise<string | null> {
  const res = await open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: extensions.join("/").toUpperCase(), extensions }],
  });
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
