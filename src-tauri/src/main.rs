#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::{kill_sidecar, spawn_sidecar, SidecarState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn get_api_base_url(state: State<'_, SidecarState>) -> Result<String, String> {
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{port}"))
}

#[tauri::command]
async fn switch_profile(state: State<'_, SidecarState>, profile_id: String) -> Result<serde_json::Value, String> {
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}/profiles/switch");
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .json(&serde_json::json!({ "profileId": profile_id }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
async fn get_sidecar_health(state: State<'_, SidecarState>) -> Result<serde_json::Value, String> {
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}/health");
    let res = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let body = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("profiles");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState::default())
        .setup(|app| {
            let state = app.state::<SidecarState>();
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./data"));
            std::fs::create_dir_all(&data_dir).ok();
            match spawn_sidecar(&state, data_dir) {
                Ok(port) => {
                    println!("[personai] Sidecar on http://127.0.0.1:{port}");
                }
                Err(err) => {
                    eprintln!("[personai] Sidecar spawn failed: {err}");
                    // Dev fallback: assume external `pnpm dev:server` on 4000
                    if let Ok(mut p) = state.port.lock() {
                        *p = 4000;
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<SidecarState>();
                kill_sidecar(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_api_base_url,
            switch_profile,
            get_sidecar_health,
            open_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running PersonAI OS");
}
