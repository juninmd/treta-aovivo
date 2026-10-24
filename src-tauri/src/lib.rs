pub mod engine;
mod search;
mod secrets;
mod sidecar;
mod store;

pub use sidecar::{serve as serve_engine, ENGINE_FLAG};

use engine::{source::SourceSpec, EngineConfig};
use serde::Serialize;
use sidecar::{Control, EngineProcess, Request};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
struct EngineState(Mutex<Option<EngineProcess>>);

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("TRETA_MODELS_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path().app_data_dir().map(|d| d.join("models")).map_err(|e| e.to_string())
}

fn stop_current(state: &EngineState) {
    if let Some(mut p) = state.0.lock().expect("engine lock").take() {
        p.send(&Control::Stop);
    }
}

#[tauri::command]
fn start_engine(app: AppHandle, state: State<EngineState>, source: SourceSpec, config: EngineConfig, on_event: Channel<serde_json::Value>) -> Result<(), String> {
    stop_current(&state);
    let req = Request { source, config, models_dir: models_dir(&app)? };
    let process = EngineProcess::start(&req, move |ev| {
        let _ = on_event.send(ev);
    })?;
    *state.0.lock().expect("engine lock") = Some(process);
    Ok(())
}

#[tauri::command]
fn stop_engine(state: State<EngineState>) {
    stop_current(&state);
}

/// True when the engine received the request (it ignores unknown or equal ids).
#[tauri::command]
fn merge_speakers(state: State<EngineState>, from: usize, into: usize) -> bool {
    state.0.lock().expect("engine lock").as_mut().is_some_and(|p| p.send(&Control::Merge { from, into }))
}

/// Saves the whole debate; returns the archive path so the UI can show where it lives.
#[tauri::command]
async fn save_debate(app: AppHandle, archive: State<'_, store::Store>, snapshot: store::Snapshot) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("treta.sqlite");
    let mut conn = archive.0.lock().map_err(|_| "archive lock poisoned".to_string())?;
    if conn.is_none() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        *conn = Some(store::open(&path).map_err(|e| e.to_string())?);
    }
    let conn = conn.as_mut().ok_or("archive unavailable")?;
    store::save(conn, &snapshot)?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Tools {
    yt_dlp: bool,
    ffmpeg: bool,
}

#[tauri::command]
fn check_tools() -> Tools {
    Tools { yt_dlp: engine::source::tool_available("yt-dlp"), ffmpeg: engine::source::tool_available("ffmpeg") }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(EngineState::default())
        .manage(store::Store::default())
        .invoke_handler(tauri::generate_handler![
            start_engine,
            stop_engine,
            merge_speakers,
            check_tools,
            search::search_page,
            save_debate,
            secrets::secret_set,
            secrets::secret_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
