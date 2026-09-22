// DaMod desktop shell. Phase 0: no custom commands yet; the workspace file
// layer (FR-5) lands in Phase 2 and will register its commands here.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
