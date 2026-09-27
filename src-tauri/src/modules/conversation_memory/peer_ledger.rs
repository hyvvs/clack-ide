//! Atomic ownership of the existing PeerTask file, shared by every webview.
use super::{MemoryState, Result};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

fn path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("clack-ai-peer-tasks.json"))
}

pub(super) fn read(app: &tauri::AppHandle) -> Result<Value> {
    app.state::<MemoryState>().peers.revisioned(&path(app)?)
}

#[tauri::command]
pub async fn peer_ledger_read(app: tauri::AppHandle) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || read(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn peer_ledger_commit(app: tauri::AppHandle, expected: u64, tasks: Value) -> Result<u64> {
    tauri::async_runtime::spawn_blocking(move || {
        let list = tasks.as_array().ok_or("peer_invalid_ledger")?;
        if list.len() > 256
            || serde_json::to_vec(&tasks).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024
        {
            return Err("peer_ledger_too_large".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        for task in list {
            let id = task["id"].as_str().ok_or("peer_invalid_identity")?;
            if id.is_empty() || !ids.insert(id) {
                return Err("peer_duplicate_identity".into());
            }
        }
        let revision =
            app.state::<MemoryState>()
                .peers
                .compare_tasks(&path(&app)?, expected, tasks)?;
        let _ = app.emit("clack:peer-ledger-changed", revision);
        Ok(revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
