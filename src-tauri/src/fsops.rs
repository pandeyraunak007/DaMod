// Filesystem operations for the workspace layer (FR-5). All writes are atomic
// (write to a temp file, then rename into place — FR-5.3). Model writes first
// snapshot the previous version into `.history/`, keeping the last 20 (FR-5.9).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const HISTORY_DIR: &str = ".history";
const HISTORY_KEEP: usize = 20;

#[derive(serde::Serialize)]
pub struct WorkspaceListing {
    pub model_files: Vec<String>,
    pub workspace: Option<String>,
    pub links: Option<String>,
    pub semantic: Option<String>,
}

#[derive(serde::Serialize)]
pub struct HistoryEntry {
    pub file: String,
    pub name: String,
    pub timestamp: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn mtime_millis(p: &Path) -> Option<u64> {
    fs::metadata(p)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn temp_sibling(p: &Path) -> PathBuf {
    let mut t = p.to_path_buf();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    t.set_file_name(format!("{}.tmp", name));
    t
}

fn atomic_write(p: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = temp_sibling(p);
    fs::write(&tmp, contents.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| e.to_string())?;
    Ok(())
}

fn snapshot_history(p: &Path) -> Result<(), String> {
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let hist = dir.join(HISTORY_DIR);
    fs::create_dir_all(&hist).map_err(|e| e.to_string())?;
    let base = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "no file name".to_string())?;
    let snap = hist.join(format!("{}.{}", base, now_millis()));
    fs::copy(p, &snap).map_err(|e| e.to_string())?;
    prune_history(&hist, &base)?;
    Ok(())
}

fn prune_history(hist: &Path, base: &str) -> Result<(), String> {
    let prefix = format!("{}.", base);
    let mut entries: Vec<(u64, PathBuf)> = fs::read_dir(hist)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().starts_with(&prefix))
                .unwrap_or(false)
        })
        .filter_map(|p| {
            let ts = p
                .file_name()?
                .to_string_lossy()
                .rsplit('.')
                .next()?
                .parse::<u64>()
                .ok()?;
            Some((ts, p))
        })
        .collect();
    entries.sort_by_key(|(ts, _)| *ts);
    while entries.len() > HISTORY_KEEP {
        let (_, old) = entries.remove(0);
        let _ = fs::remove_file(old);
    }
    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

/// Atomic write. When `history` is true, the previous version is snapshotted
/// into `.history/` first. Returns the new modified time in milliseconds.
#[tauri::command]
pub fn write_file(path: String, contents: String, history: bool) -> Result<u64, String> {
    let p = PathBuf::from(&path);
    if history && p.exists() {
        snapshot_history(&p)?;
    }
    atomic_write(&p, &contents)?;
    Ok(mtime_millis(&p).unwrap_or(0))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn file_mtime(path: String) -> Result<Option<u64>, String> {
    Ok(mtime_millis(&PathBuf::from(&path)))
}

/// Ensure the workspace folder exists and list its model files plus the contents
/// of the three workspace-level files (any of which may be absent).
#[tauri::command]
pub fn list_workspace(dir: String) -> Result<WorkspaceListing, String> {
    let d = PathBuf::from(&dir);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let mut model_files = Vec::new();
    for entry in fs::read_dir(&d).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".model.json") {
            model_files.push(name);
        }
    }
    model_files.sort();
    let read_opt = |name: &str| -> Option<String> { fs::read_to_string(d.join(name)).ok() };
    Ok(WorkspaceListing {
        model_files,
        workspace: read_opt("workspace.json"),
        links: read_opt("links.json"),
        semantic: read_opt("semantic.json"),
    })
}

/// History snapshots for one model file, newest first (FR-5.9).
#[tauri::command]
pub fn list_history(dir: String, base: String) -> Result<Vec<HistoryEntry>, String> {
    let hist = PathBuf::from(&dir).join(HISTORY_DIR);
    if !hist.exists() {
        return Ok(vec![]);
    }
    let prefix = format!("{}.", base);
    let mut entries: Vec<HistoryEntry> = fs::read_dir(&hist)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with(&prefix) {
                return None;
            }
            let ts = name.rsplit('.').next()?.parse::<u64>().ok()?;
            Some(HistoryEntry {
                file: e.path().to_string_lossy().to_string(),
                name,
                timestamp: ts,
            })
        })
        .collect();
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

/// App-level state (e.g. the last opened workspace) — FR-1.1.
#[tauri::command]
pub fn app_state_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(state_path(&app)?).ok())
}

#[tauri::command]
pub fn app_state_set(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    fs::write(state_path(&app)?, contents).map_err(|e| e.to_string())
}
