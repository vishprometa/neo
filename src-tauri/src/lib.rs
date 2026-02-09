use std::env;
use std::path::PathBuf;

use base64::Engine;
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

/// Find the .app bundle path for a given application name.
fn find_app_path(app_name: &str) -> Result<String, String> {
    use std::process::Command;

    // Try mdfind with display name
    let query = format!(
        "kMDItemDisplayName == '{}' && kMDItemKind == 'Application'",
        app_name
    );
    if let Ok(output) = Command::new("mdfind").arg(&query).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(path) = stdout.lines().find(|l| l.ends_with(".app")) {
            return Ok(path.to_string());
        }
    }

    // Try mdfind with filesystem name
    let query = format!(
        "kMDItemFSName == '{}.app' && kMDItemKind == 'Application'",
        app_name
    );
    if let Ok(output) = Command::new("mdfind").arg(&query).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(path) = stdout.lines().find(|l| l.ends_with(".app")) {
            return Ok(path.to_string());
        }
    }

    // Fallback: check well-known paths
    let candidates = [
        format!("/Applications/{}.app", app_name),
        format!("/System/Applications/{}.app", app_name),
        format!("/System/Applications/Utilities/{}.app", app_name),
        format!("/System/Library/CoreServices/{}.app", app_name),
    ];
    candidates
        .into_iter()
        .find(|p| PathBuf::from(p).exists())
        .ok_or_else(|| format!("App not found: {app_name}"))
}

/// Get the icon for a macOS application as a base64 PNG data URL.
/// Uses mdfind with kMDItemDisplayName to locate the app bundle, then extracts
/// and converts the icon via sips.
#[tauri::command]
fn get_app_icon(app_name: String) -> Result<String, String> {
    use std::process::Command;

    let app_path = find_app_path(&app_name)?;

    // Read Info.plist to find the icon file name
    let plist_path = format!("{app_path}/Contents/Info.plist");
    let plist_output = Command::new("defaults")
        .args(["read", &plist_path, "CFBundleIconFile"])
        .output()
        .map_err(|e| format!("Failed to read plist: {e}"))?;

    let mut icon_name = String::from_utf8_lossy(&plist_output.stdout).trim().to_string();
    if icon_name.is_empty() {
        icon_name = "AppIcon".to_string();
    }
    if !icon_name.ends_with(".icns") {
        icon_name.push_str(".icns");
    }

    let icns_path = format!("{app_path}/Contents/Resources/{icon_name}");
    if !PathBuf::from(&icns_path).exists() {
        return Err(format!("Icon file not found: {icns_path}"));
    }

    // Convert icns to 32x32 PNG using sips
    let tmp_dir = std::env::temp_dir();
    let tmp_png = tmp_dir.join(format!("neo_icon_{}.png", app_name.replace(' ', "_")));

    let sips_result = Command::new("sips")
        .args([
            "-s", "format", "png",
            "-z", "32", "32",
            &icns_path,
            "--out",
            tmp_png.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to run sips: {e}"))?;

    if !sips_result.status.success() {
        return Err(format!(
            "sips failed: {}",
            String::from_utf8_lossy(&sips_result.stderr)
        ));
    }

    let png_data = std::fs::read(&tmp_png).map_err(|e| format!("Failed to read PNG: {e}"))?;
    let _ = std::fs::remove_file(&tmp_png);

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_gemini_api_key, get_openrouter_api_key, allow_workspace_dir, get_app_icon])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
