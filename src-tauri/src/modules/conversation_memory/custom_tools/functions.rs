//! T3b imports immutable core WASIp1 commands. Paths in JSON are only data.
use super::*;
use std::io::Read;

pub const ABI: &str = "wasi-preview1-json-v1";
pub const MAX_MODULE: usize = 1024 * 1024;
pub const MEMORY_BYTES: usize = 64 * 1024 * 1024;

pub(super) fn host_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(crate::modules::fs::to_canon(path).replace('/', "\\"))
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

pub(super) fn binding(hash: String) -> Binding {
    Binding::Wasi {
        schema_version: 1,
        hash,
        abi: ABI.into(),
        export: "_start".into(),
        runtime: confinement::CAPABILITY_VERSION.into(),
    }
}

pub(super) fn validate_binding(binding: &Binding) -> Result<()> {
    match binding {
        Binding::Wasi {
            schema_version: 1,
            hash,
            abi,
            export,
            runtime,
        } if hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            && abi == ABI
            && export == "_start"
            && runtime == confinement::CAPABILITY_VERSION =>
        {
            Ok(())
        }
        _ => Err("tool_wasi_binding".into()),
    }
}

pub(super) fn platform_verified() -> bool {
    let evidence = confinement::platform::current();
    evidence.verified()
}

fn store(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "tool_wasi_storage")?
        .join("ai-attachments"))
}

pub(super) fn module_path(app: &tauri::AppHandle, definition: &Definition) -> Result<PathBuf> {
    validate_binding(&definition.binding)?;
    let Binding::Wasi { hash, .. } = &definition.binding else {
        unreachable!()
    };
    let root = store(app)?;
    let bytes = read_content_from(&root, hash).map_err(|_| "tool_wasi_content_unavailable")?;
    confinement::validate_function(&bytes).map_err(|_| "tool_wasi_invalid_module")?;
    Ok(root.join(hash))
}

pub(super) fn registered_module(
    app: &tauri::AppHandle,
    registry: &Registry,
    access: &Access,
    definition: &Definition,
) -> Result<()> {
    let Binding::Wasi { hash, .. } = &definition.binding else {
        return Ok(());
    };
    if !known_module(registry, access, hash) {
        return Err("tool_wasi_import_required".into());
    }
    module_path(app, definition).map(|_| ())
}

fn known_module(registry: &Registry, access: &Access, hash: &str) -> bool {
    registry.entries.iter().any(|entry| {
        entry.workspace_id == access.workspace && entry.versions.iter().any(|v|
        matches!(&v.definition.binding, Binding::Wasi { hash: known, .. } if known == hash))
    })
}

pub(crate) fn retention_roots(app: &tauri::AppHandle) -> Result<Vec<String>> {
    Ok(module_roots(&load(app)?))
}

fn module_roots(registry: &Registry) -> Vec<String> {
    registry
        .entries
        .iter()
        .flat_map(|e| &e.versions)
        .filter_map(|v| match &v.definition.binding {
            Binding::Wasi { hash, .. } => Some(hash.clone()),
            _ => None,
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn read_import(path: &Path) -> Result<Vec<u8>> {
    let canonical = fs::canonicalize(path).map_err(|_| "tool_wasi_import_unavailable")?;
    if [path, canonical.as_path()].iter().any(|p| {
        crate::modules::archive::is_sensitive_archive_path(&p.to_string_lossy().replace('\\', "/"))
    }) {
        return Err("protected-path".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "tool_wasi_import_unavailable")?;
    if !metadata.is_file() || metadata.is_symlink() || metadata.len() > MAX_MODULE as u64 {
        return Err("tool_wasi_invalid_module".into());
    }
    let mut bytes = vec![];
    fs::File::open(path)
        .map_err(|_| "tool_wasi_import_unavailable")?
        .take(MAX_MODULE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "tool_wasi_import_unavailable")?;
    confinement::validate_function(&bytes).map_err(|_| "tool_wasi_invalid_module")?;
    Ok(bytes)
}

// Only this native-picker path can introduce module bytes. Agent proposals can
// reference already imported same-workspace content, but cannot import/approve it.
#[tauri::command]
pub async fn custom_tools_import_wasi(
    app: tauri::AppHandle,
    session_id: String,
    expected_revision: u64,
    mut definition: Definition,
    tool_id: Option<String>,
) -> Result<Value> {
    blocking(move || {
        let captured = access(&app, &session_id)?;
        if load(&app)?.revision != expected_revision { return Err("tool_stale_revision".into()); }
        let selected = app.dialog().file().add_filter("WASM/WASI module", &["wasm"])
            .set_title("Import reviewed WASI function").blocking_pick_file().ok_or("tool_import_cancelled")?;
        let selected = selected.into_path().map_err(|_| "tool_wasi_import_unavailable")?;
        let bytes = read_import(&selected)?;
        definition.binding = binding(digest(&bytes));
        validate(&definition)?;
        assignments(&app, &definition, &captured)?;
        let change = match tool_id { Some(id) => Change::Edit { id, definition: definition.clone() }, None => Change::Create { definition: definition.clone() } };
        let preview = apply(&load(&app)?, &captured, expected_revision, change, Authority::NativeUser)?;
        let description = format!("Module: {}\nSHA-256: {}\n{} bytes\nABI: {}\nWorkspace: {}\n\nImport immutable code as an inactive draft? Authorization and each execution require separate approval.",
            selected.file_name().unwrap_or_default().to_string_lossy(), digest(&bytes), bytes.len(), ABI, captured.workspace);
        if !app.dialog().message(description).title("Clack WASI module import").buttons(MessageDialogButtons::OkCancel).blocking_show() { return Err("tool_native_consent_required".into()); }
        let _collection = CONTENT_COLLECTION.read().map_err(|_| "tool_wasi_storage")?;
        let state = app.state::<MemoryState>();
        let lock = state.owner("custom-tools")?;
        let _guard = lock.lock().map_err(|_| "tool_wasi_storage")?;
        if access(&app, &session_id)? != captured || load(&app)?.revision != expected_revision { return Err("tool_stale_revision".into()); }
        assignments(&app, &definition, &captured)?;
        put_content_in(&store(&app)?, &bytes)?;
        publish(&app, &preview)?;
        Ok(view(&preview, &captured))
    }).await
}

#[cfg(test)]
mod tests;
