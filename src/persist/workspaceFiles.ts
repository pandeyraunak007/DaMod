// Workspace-level file shapes (FR-5.1). A workspace folder holds:
//   workspace.json   — workspace name, timestamps, last-open tabs
//   <name>.model.json — one per model (see serialize.ts)
//   links.json       — cross-model links (Phase 3; empty for now)
//   semantic.json    — semantic layer (Phase 4; empty for now)
// All are deterministic JSON with a trailing newline.

export interface WorkspaceMeta {
  formatVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Filenames of the models that were open, to restore tabs on reopen. */
  openModels?: string[];
  /** Filename of the active tab. */
  activeModel?: string;
}

export function serializeWorkspace(ws: WorkspaceMeta): string {
  const out: Record<string, unknown> = {
    formatVersion: ws.formatVersion,
    name: ws.name,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  };
  if (ws.openModels && ws.openModels.length) out.openModels = [...ws.openModels];
  if (ws.activeModel) out.activeModel = ws.activeModel;
  return JSON.stringify(out, null, 2) + "\n";
}

// Empty Phase 3 / Phase 4 files, written when a workspace is created so the
// folder always has the full FR-5.1 shape.
export function emptyLinksFile(): string {
  return JSON.stringify({ formatVersion: 1, links: [], conceptGroups: [] }, null, 2) + "\n";
}

export function emptySemanticFile(): string {
  return (
    JSON.stringify({ formatVersion: 1, terms: [], dimensions: [], metrics: [] }, null, 2) + "\n"
  );
}
