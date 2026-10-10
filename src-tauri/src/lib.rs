// DaMod desktop shell. Registers the workspace file-layer commands (FR-5), the
// dialog plugin for folder picking (FR-1.1), and the PostgreSQL connector +
// secure-store commands (connector framework Phase 2).
mod fsops;
mod pg;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fsops::read_text_file,
            fsops::write_file,
            fsops::delete_file,
            fsops::file_mtime,
            fsops::list_workspace,
            fsops::list_history,
            fsops::app_state_get,
            fsops::app_state_set,
            pg::pg_test_connection,
            pg::pg_list_schemas,
            pg::pg_discover,
            pg::secret_store,
            pg::secret_get,
            pg::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
