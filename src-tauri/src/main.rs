#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

#[cfg(unix)]
mod mcp;

// Projects can embed traced reference images.
const PROJECT_LIMIT: u64 = 16 * 1024 * 1024;
const STEP_LIMIT: usize = 20 * 1024 * 1024;

fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}

fn read_project(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|err| format!("Could not open project: {err}"))?;
    let mut bytes = Vec::new();
    file.take(PROJECT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("Could not read project: {err}"))?;
    if bytes.len() as u64 > PROJECT_LIMIT {
        return Err("This project exceeds 16 MB.".into());
    }
    String::from_utf8(bytes).map_err(|_| "The project must use UTF-8.".into())
}

#[tauri::command]
async fn open_project(app: AppHandle) -> Result<Option<String>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Assembly Lab Project", &["assemblylab"])
        .blocking_pick_file();
    selected
        .map(|path| {
            path.into_path()
                .map_err(|err| err.to_string())
                .and_then(|path| read_project(&path))
        })
        .transpose()
}

#[tauri::command]
async fn save_project(app: AppHandle, document: String) -> Result<bool, String> {
    if document.len() as u64 > PROJECT_LIMIT {
        return Err("This project exceeds 16 MB.".into());
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&document).map_err(|_| "The project document is invalid JSON.")?;
    if parsed.get("format").and_then(serde_json::Value::as_str) != Some("assembly-lab")
        || parsed.get("version").and_then(serde_json::Value::as_u64) != Some(1)
    {
        return Err("Unsupported Assembly Lab project format.".into());
    }
    save_with_dialog(
        &app,
        "Assembly Lab Project",
        "assemblylab",
        "assembly-lab.assemblylab",
        document.as_bytes(),
    )
}

#[tauri::command]
async fn save_step(app: AppHandle, document: String, name: Option<String>) -> Result<bool, String> {
    if document.len() > STEP_LIMIT || !document.starts_with("ISO-10303-21;") {
        return Err("The generated STEP document is invalid.".into());
    }
    save_with_dialog(
        &app,
        "STEP solid",
        "step",
        // Only known default names are accepted from the page.
        match name.as_deref() {
            Some("traced-part.step") => "traced-part.step",
            _ => "flange-adapter.step",
        },
        document.as_bytes(),
    )
}

fn save_with_dialog(
    app: &AppHandle,
    label: &str,
    ext: &str,
    name: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter(label, &[ext])
        .set_file_name(name)
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(false);
    };
    let mut path = selected.into_path().map_err(|err| err.to_string())?;
    if path.extension().is_none() {
        path.set_extension(ext);
    }
    write_file(&path, bytes).map_err(|err| format!("Could not write file: {err}"))?;
    Ok(true)
}

fn main() {
    #[cfg(unix)]
    {
        let result = match std::env::args_os()
            .nth(1)
            .as_deref()
            .and_then(std::ffi::OsStr::to_str)
        {
            Some("--mcp") => Some(tauri::async_runtime::block_on(mcp::serve_stdio())),
            Some("--mcp-http") => Some(tauri::async_runtime::block_on(mcp::serve_http())),
            _ => None,
        };
        if let Some(result) = result {
            if let Err(error) = result {
                eprintln!("Assembly Lab MCP: {error}");
                std::process::exit(1);
            }
            return;
        }
    }

    #[cfg(unix)]
    let builder = tauri::Builder::default()
        .manage(mcp::Bridge::default())
        .setup(|app| {
            mcp::start_bridge(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_project,
            save_project,
            save_step,
            mcp::mcp_connect,
            mcp::mcp_reply
        ]);

    #[cfg(not(unix))]
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        open_project,
        save_project,
        save_step
    ]);

    builder
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("could not launch Assembly Lab");
}
