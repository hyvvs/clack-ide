//! Isolated two-process Tauri/WebView qualification of production R3b IPC.
//! This is NOT a replacement for the full Clack Agent/approval UI roundtrip.
use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use terax_lib::modules::{shell, workspace};

#[tauri::command]
fn r3c_exit(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let root = PathBuf::from(std::env::var("CLACK_R3C_OWNED_ROOT").expect("owned test root"))
        .canonicalize()
        .expect("test root exists");
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("r3c-native-"));
    let workspace = root
        .join("workspace")
        .canonicalize()
        .expect("temporary workspace");
    assert!(workspace.starts_with(&root));
    let url: tauri::Url = std::env::var("CLACK_R3C_ENTRY_URL")
        .expect("test host url")
        .parse()
        .expect("valid URL");
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/r3c-native-acceptance.html");

    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = root.join("data").to_string_lossy().replace('\\', "/");
    context.config_mut().build.dev_url = Some(url.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(shell::ShellState::default())
        .manage(workspace::WorkspaceRegistry::default())
        .setup(move |app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            assert!(
                data.canonicalize()?.starts_with(&root),
                "no real user app data"
            );
            app.state::<workspace::WorkspaceRegistry>()
                .authorize(&workspace)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .visible(false)
                .data_directory(root.join("webview"))
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            r3c_exit,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::verification::agent_workspace_fingerprint,
        ])
        .build(context)
        .expect("isolated Tauri host")
        .run(|_, _| {});
}
