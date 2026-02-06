use std::env;
use std::path::PathBuf;

use tauri_plugin_fs::FsExt;

/// Get the Gemini API key from environment variables
#[tauri::command]
fn get_gemini_api_key() -> Result<String, String> {
    env::var("GEMINI_API_KEY").map_err(|_| "GEMINI_API_KEY not set in environment".to_string())
}

/// Get the OpenRouter API key from environment variables
#[tauri::command]
fn get_openrouter_api_key() -> Result<String, String> {
    env::var("OPENROUTER_API_KEY").map_err(|_| "OPENROUTER_API_KEY not set in environment".to_string())
}

/// Allow Neo to access a user-selected workspace directory.
///
/// Tauri's filesystem plugin is scope-based: even if read/write commands are allowed,
/// paths are denied unless they are inside the application's FS scope.
///
/// This command is called right after the user selects a folder, so the app can
/// read/write `.neomemory/` inside that workspace.
#[tauri::command]
fn allow_workspace_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let raw = PathBuf::from(path);
    let canonical = raw
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;

    if !canonical.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    // Basic safety: only allow paths inside the user's home directory when available.
    if let Ok(home) = env::var("HOME") {
        let home = PathBuf::from(home);
        if !canonical.starts_with(&home) {
            return Err("Selected folder must be inside your home directory".to_string());
        }
    }

    let scope = app.fs_scope();
    // true => recursive
    scope
        .allow_directory(canonical, true)
        .map_err(|e| format!("Failed to allow directory: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_gemini_api_key, get_openrouter_api_key, allow_workspace_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
