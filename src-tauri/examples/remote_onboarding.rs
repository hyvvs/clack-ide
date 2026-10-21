//! Read-only remote acceptance: no inference or remote mutation command is registered.
use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;
use terax_lib::modules::{conversation_memory, inference_probe, remote_ssh, self_hosted_profiles};

async fn run(app: tauri::AppHandle, root: std::path::PathBuf) -> Result<(), String> {
    let id = "remote-acceptance";
    let url = remote_ssh::logical_url(id);
    let key = dirs::home_dir()
        .ok_or("home unavailable")?
        .join(".ssh/clack_hylab_ed25519");
    let endpoint = json!({"id":id,"alias":"labpc","baseURL":url,"credentialRef":null,"allowPrivateNetwork":true,
        "transportSecurity":"http-unencrypted","revision":1,"configurationRevision":1,"createdAt":1,"updatedAt":1,
        "ssh":{"host":"192.168.1.44","username":"hylab","port":22,"keyPath":key,"remoteHost":"127.0.0.1","remotePort":11434}});
    let state = json!({"version":1,"revision":1,"endpoints":[endpoint],"profiles":[]});
    assert!(self_hosted_profiles::self_hosted_profiles_compare_and_swap(
        app.clone(),
        Value::Null,
        state
    )?);
    let connected = remote_ssh::remote_ssh_connect(app.clone(), id.into(), None).await?;
    std::fs::write(
        root.join("transport.json"),
        serde_json::to_vec_pretty(&connected).unwrap(),
    )
    .map_err(|_| "evidence write")?;
    if connected.state != "connected" {
        return Err(format!("transport: {}", connected.state));
    }
    let first = remote_ssh::resolve(format!("{url}api/tags").parse().unwrap())?;
    assert_ne!(first.port(), Some(11435));
    assert_eq!(first.host_str(), Some("127.0.0.1"));
    let options = || {
        serde_json::from_value(json!({"endpointId":id,"allowPrivateNetwork":true,"force":true}))
            .unwrap()
    };
    let inventory = inference_probe::self_hosted_probe(app.clone(), options())
        .await
        .map_err(|e| format!("{e:?}"))?;
    assert!(inventory.connected);
    assert_eq!(serde_json::to_value(inventory.backend).unwrap(), "ollama");
    assert!(!inventory.models.is_empty());
    let before = app
        .store("terax-settings.json")
        .unwrap()
        .get("selfHostedInference")
        .unwrap();
    let profile = &before["profiles"][0];
    let selection = format!(
        "self-hosted:{}",
        json!([
            id,
            profile["transportModelId"],
            profile["deploymentId"],
            profile["modelRevision"],
            profile["backend"]
        ])
    );
    let saved = json!({"id":"remote-lifecycle-saved-chat","title":"Offline historical chat","createdAt":1,"updatedAt":1,"profileVersion":1,
        "profile":{"agentId":"builtin:coder","modelId":selection,"workspaceId":null,"workspaceRoot":null}});
    let history = json!([{"id":"offline-history","role":"user","parts":[{"type":"text","text":"Historical test conversation, no inference requested."}]}]);
    conversation_memory::conversation_source_set(
        app.clone(),
        app.state::<conversation_memory::MemoryState>(),
        "sessions".into(),
        json!([saved]),
    )
    .await?;
    conversation_memory::conversation_source_set(
        app.clone(),
        app.state::<conversation_memory::MemoryState>(),
        "messages:remote-lifecycle-saved-chat".into(),
        history.clone(),
    )
    .await?;
    let settings = app.store("terax-settings.json").unwrap();
    settings.set("favoriteModelIds", json!([selection]));
    settings.set("recentModelIds", json!([selection]));
    settings.save().map_err(|_| "settings write")?;
    remote_ssh::remote_ssh_disconnect(id.into());
    assert_eq!(
        remote_ssh::remote_ssh_status(id.into()).state,
        "disconnected"
    );
    assert!(std::net::TcpStream::connect(("127.0.0.1", first.port().unwrap())).is_err());
    assert_eq!(
        conversation_memory::conversation_session_get(
            app.clone(),
            "messages:remote-lifecycle-saved-chat".into()
        )
        .await?,
        Some(history.clone())
    );
    assert_eq!(
        remote_ssh::remote_ssh_status(id.into()).state,
        "disconnected"
    );
    let restored = conversation_memory::conversation_session_get(app.clone(), "sessions".into())
        .await?
        .ok_or("saved chat missing")?;
    assert_eq!(restored[0], saved);
    let selected = restored[0]["profile"]["modelId"]
        .as_str()
        .ok_or("binding missing")?;
    let logical: Value = serde_json::from_str(
        selected
            .strip_prefix("self-hosted:")
            .ok_or("binding changed")?,
    )
    .map_err(|_| "binding malformed")?;
    let restored_endpoint = logical[0].as_str().ok_or("endpoint missing")?;
    let (chat, picker) = tokio::join!(
        remote_ssh::remote_ssh_acquire(
            app.clone(),
            restored_endpoint.into(),
            "saved-chat-consumer".into()
        ),
        remote_ssh::remote_ssh_acquire(
            app.clone(),
            restored_endpoint.into(),
            "picker-consumer".into()
        )
    );
    let reconnected = chat?;
    assert_eq!(picker?.state, "connected");
    assert_eq!(reconnected.state, "connected");
    remote_ssh::remote_ssh_release(id.into(), "picker-consumer".into());
    assert_eq!(remote_ssh::remote_ssh_status(id.into()).state, "connected");
    let second = remote_ssh::resolve(format!("{url}api/tags").parse().unwrap())?;
    let again = inference_probe::self_hosted_probe(app.clone(), options())
        .await
        .map_err(|e| format!("{e:?}"))?;
    let after = app
        .store("terax-settings.json")
        .unwrap()
        .get("selfHostedInference")
        .unwrap();
    assert_eq!(
        before["endpoints"][0]["configurationRevision"],
        after["endpoints"][0]["configurationRevision"]
    );
    assert_eq!(
        inventory
            .models
            .iter()
            .map(|m| (&m.id, &m.digest))
            .collect::<Vec<_>>(),
        again
            .models
            .iter()
            .map(|m| (&m.id, &m.digest))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        conversation_memory::conversation_session_get(app.clone(), "sessions".into()).await?,
        Some(restored.clone())
    );
    assert_eq!(settings.get("favoriteModelIds"), Some(json!([selection])));
    assert_eq!(settings.get("recentModelIds"), Some(json!([selection])));
    assert_eq!(
        before["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| &p["id"])
            .collect::<Vec<_>>(),
        after["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| &p["id"])
            .collect::<Vec<_>>()
    );
    let mut removed = after.clone();
    removed["revision"] = json!(after["revision"].as_u64().unwrap() + 1);
    removed["endpoints"][0]["deletedAt"] = json!(2);
    assert!(self_hosted_profiles::self_hosted_profiles_compare_and_swap(
        app.clone(),
        after.clone(),
        removed
    )?);
    assert!(std::net::TcpStream::connect(("127.0.0.1", second.port().unwrap())).is_err());
    let store = app.store("terax-settings.json").unwrap();
    let removed = store.get("selfHostedInference").unwrap();
    let mut restored = after.clone();
    restored["revision"] = json!(removed["revision"].as_u64().unwrap() + 1);
    assert!(self_hosted_profiles::self_hosted_profiles_compare_and_swap(
        app.clone(),
        removed,
        restored
    )?);
    std::thread::sleep(std::time::Duration::from_secs(2));
    assert_eq!(
        remote_ssh::remote_ssh_connect(app.clone(), id.into(), None)
            .await?
            .state,
        "connected"
    );
    let exit_port = remote_ssh::resolve(format!("{url}api/tags").parse().unwrap())?.port();
    std::fs::write(root.join("result.json"),serde_json::to_vec_pretty(&json!({"transport":connected,"reconnected":reconnected,
            "firstPort":first.port(),"secondPort":second.port(),"exitPort":exit_port,"inventory":inventory,"state":after,"removedTunnelClosed":true,
        "savedChat":saved,"offlineHistory":history,"sameLogicalBinding":true,"concurrentConsumers":2,"sharedConsumerCancellation":true,"automaticReconnect":true,
        "firstTunnelClosed":true,"inference":0,"downloads":0,"cloudInference":0})).unwrap()).map_err(|_| "evidence write")?;
    Ok(())
}
fn main() {
    if remote_ssh::guardian::entry() {
        return;
    }
    let root = std::fs::canonicalize(
        std::env::var("CLACK_REMOTE_ROOT").expect("isolated evidence root required"),
    )
    .unwrap();
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("remote-onboarding-"));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = root.join("data").to_string_lossy().replace('\\', "/");
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(inference_probe::ProbeState::default())
        .manage(conversation_memory::MemoryState::default())
        .setup(move |app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            assert!(std::fs::canonicalize(data)?.starts_with(&root));
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .data_directory(root.join("webview"))
            .build()?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = run(handle.clone(), root.clone()).await;
                std::fs::write(
                    root.join("exit.json"),
                    serde_json::to_vec(&json!({"error":result.as_ref().err()})).unwrap(),
                )
                .unwrap();
                handle.exit(if result.is_ok() { 0 } else { 1 });
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(120));
                handle.exit(2);
            });
            Ok(())
        })
        .build(context)
        .unwrap()
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                remote_ssh::shutdown();
            }
        });
}
