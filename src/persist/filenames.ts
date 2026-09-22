// The file name is derived from the model name (FR-1.4). Model names are
// validated as Postgres identifiers (letters, digits, underscore, not starting
// with a digit), which are already filesystem-safe, so the mapping is direct.

export const MODEL_FILE_SUFFIX = ".model.json";
export const WORKSPACE_FILE = "workspace.json";
export const LINKS_FILE = "links.json";
export const SEMANTIC_FILE = "semantic.json";
export const HISTORY_DIR = ".history";

export function modelFileName(modelName: string): string {
  return `${modelName}${MODEL_FILE_SUFFIX}`;
}

export function isModelFile(fileName: string): boolean {
  return fileName.endsWith(MODEL_FILE_SUFFIX);
}

export function modelNameFromFile(fileName: string): string {
  return fileName.slice(0, -MODEL_FILE_SUFFIX.length);
}
