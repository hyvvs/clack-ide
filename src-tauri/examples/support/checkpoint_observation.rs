use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use tauri::Manager;
use terax_lib::modules::conversation_memory::{checkpoint, MemoryState, Owner, Preparation};

fn capture(app: &tauri::AppHandle, command: &str, input: Value, result: Value) {
    let root = std::env::var("CLACK_ACCEPTANCE_ROOT").expect("owned evidence root");
    let phase = std::env::var("CLACK_REAL_PRODUCT_PHASE").expect("owned phase");
    assert!(phase
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-'));
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let session = input["owner"]["sessionId"]
        .as_str()
        .expect("captured owner");
    let manifest_path = app
        .path()
        .app_data_dir()
        .expect("isolated data")
        .join("ai-conversation-memory")
        .join(format!("{:x}", Sha256::digest(session.as_bytes())))
        .join("manifest.json");
    let manifest = std::fs::read(&manifest_path)
        .ok()
        .filter(|bytes| bytes.len() <= 256 * 1024)
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let event = json!({"at":at,"command":command,"input":input,"result":result,"manifest":manifest,
        "appData":app.path().app_data_dir().expect("isolated data")});
    let destination = std::path::Path::new(&root).join(format!("{phase}.checkpoints.jsonl"));
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(destination)
        .expect("owned checkpoint evidence");
    writeln!(file, "{}", event).expect("checkpoint evidence persisted");
}

#[tauri::command]
pub async fn conversation_checkpoint_observe(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    run_id: u64,
    tool_call_id: String,
    path: String,
    input_hash: String,
) -> Result<(), String> {
    let input = json!({"owner":owner,"runId":run_id,"toolCallId":tool_call_id,"path":path,"inputHash":input_hash});
    let result = checkpoint::conversation_checkpoint_observe(
        app.clone(),
        state,
        owner,
        run_id,
        tool_call_id,
        path,
        input_hash,
    )
    .await;
    capture(&app, "observe", input, json!(&result));
    result
}

#[tauri::command]
pub async fn conversation_checkpoint_prepare(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    preparation: Preparation,
) -> Result<Option<checkpoint::Snapshot>, String> {
    let input = json!(&preparation);
    let result = checkpoint::conversation_checkpoint_prepare(app.clone(), state, preparation).await;
    capture(&app, "prepare", input, json!(&result));
    result
}

#[tauri::command]
pub async fn conversation_checkpoint_validate(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    revision: String,
) -> Result<(), String> {
    let input = json!({"owner":owner,"revision":revision});
    let result =
        checkpoint::conversation_checkpoint_validate(app.clone(), state, owner, revision).await;
    capture(&app, "validate", input, json!(&result));
    result
}

#[tauri::command]
pub async fn conversation_checkpoint_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, MemoryState>,
    owner: Owner,
    revision: String,
    evidence_id: String,
) -> Result<Value, String> {
    let input = json!({"owner":owner,"revision":revision,"evidenceId":evidence_id});
    let result = checkpoint::conversation_checkpoint_restore(
        app.clone(),
        state,
        owner,
        revision,
        evidence_id,
    )
    .await;
    capture(&app, "restore", input, json!(&result));
    result
}
