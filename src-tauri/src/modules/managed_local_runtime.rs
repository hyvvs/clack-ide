//! Clack-managed GGUF inference. No WebView process spawning, PATH lookup,
//! automatic downloads, user-provided executable hashes or Ollama fallback.
//! A release must embed the approved b12248 archive AND executable SHA-256.
//! Missing release pins mean Not Installed rather than executable-by-name trust.
use getrandom::fill;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

pub const ENGINE: &str = "clack-managed-llama.cpp";
pub const ENGINE_VERSION: &str = "b12248";
const MAX_ARTIFACT_SIZE: u64 = 512 * 1024 * 1024 * 1024;
const MAX_BUNDLE_SIZE: u64 = 4 * 1024 * 1024 * 1024;
const MAX_LOG_BYTES: usize = 16 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(90);

#[cfg(windows)]
mod cpu_payload {
    include!("managed_llama_cpu_b12248_manifest.rs");
}
#[cfg(windows)]
mod windows_acl {
    include!("managed_llama_windows_acl.rs");
}

#[cfg(windows)]
const EXECUTABLE: &str = "llama-server.exe";
#[cfg(not(windows))]
const EXECUTABLE: &str = "llama-server";

/// Build-time allowlist, deliberately empty for ordinary developer builds.
/// Distribution packaging must pin the exact upstream release archive and
/// executable digests before enabling installation; a UI digest is NEVER trusted.
fn approved_digest(name: &'static str) -> Result<&'static str, String> {
    let value = match name {
        "archive" => option_env!("CLACK_MANAGED_LLAMA_BUNDLE_SHA256"),
        "executable" => option_env!("CLACK_MANAGED_LLAMA_BINARY_SHA256"),
        _ => None,
    };
    value.filter(|s| valid_hex(s)).ok_or_else(|| {
        "Clack Managed Runtime is not provisioned in this build (approved release digests are missing)".into()
    })
}

fn valid_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn source_file(path: &Path) -> Result<File, String> {
    let symlink = fs::symlink_metadata(path).map_err(|_| "Selected file is missing".to_owned())?;
    if !symlink.file_type().is_file() || symlink.len() > MAX_ARTIFACT_SIZE {
        return Err("Selected file must be a regular bounded file (not a symlink)".into());
    }
    File::open(path).map_err(|_| "Selected file cannot be read".into())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = source_file(path)?;
    let mut hasher = Sha256::new();
    let mut bytes = [0u8; 64 * 1024];
    loop {
        let len = file
            .read(&mut bytes)
            .map_err(|_| "Could not read file for integrity check")?;
        if len == 0 {
            break;
        }
        hasher.update(&bytes[..len]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn private_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("managed-local-runtime"))
        .map_err(|_| "Clack private runtime directory unavailable".into())
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(private_root(app)?.join("models"))
}

fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(private_root(app)?.join("engine").join(ENGINE_VERSION))
}

fn model_path(app: &AppHandle, digest: &str) -> Result<PathBuf, String> {
    let hex = digest
        .strip_prefix("sha256:")
        .filter(|v| valid_hex(v))
        .ok_or("Invalid GGUF artifact digest")?;
    Ok(models_dir(app)?.join(format!("{hex}.gguf")))
}

/// Lightweight UX observation only. SHA-256 is ALWAYS rechecked before
/// execution, so this filesystem-presence hint cannot authorize a route.
#[tauri::command]
pub fn managed_local_runtime_model_present(app: AppHandle, digest: String) -> Result<bool, String> {
    let path = model_path(&app, &digest)?;
    Ok(fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false))
}

fn verified_engine(app: &AppHandle) -> Result<PathBuf, String> {
    let expected = approved_digest("executable")?;
    approved_digest("archive")?;
    let path = engine_dir(app)?.join(EXECUTABLE);
    if sha256_file(&path)? != expected {
        return Err(
            "Managed runtime binary is missing or fails its pinned SHA-256 identity".into(),
        );
    }
    #[cfg(windows)]
    {
        let root = private_root(app)?;
        let parent = root.join("engine");
        windows_acl::check_private_acl(&root)?;
        windows_acl::check_private_acl(&parent)?;
        windows_acl::check_private_acl(&engine_dir(app)?)?;
        verify_payload_dir(&engine_dir(app)?)?;
    }
    Ok(path)
}

/// Verify all and only the files from the in-binary, upstream-attested
/// release manifest. No adjacent file can replace this trust authority.
#[cfg(windows)]
fn verify_payload_dir(dir: &Path) -> Result<(), String> {
    verify_payload_dir_expected(dir, cpu_payload::FILES)
}

#[cfg(windows)]
fn verify_payload_dir_expected(
    dir: &Path,
    expected_files: &[(&str, u64, &str)],
) -> Result<(), String> {
    use std::collections::HashSet;
    let metadata = fs::symlink_metadata(dir).map_err(|_| "Runtime directory is missing")?;
    if !metadata.is_dir() || windows_acl::is_reparse(&metadata) {
        return Err("Runtime directory is not a regular private directory".into());
    }
    let mut seen = HashSet::new();
    for entry in fs::read_dir(dir).map_err(|_| "Runtime payload directory unreadable")? {
        let entry = entry.map_err(|_| "Runtime payload entry unreadable")?;
        let name = entry.file_name();
        let name = name.to_str().ok_or("Runtime payload name is not Unicode")?;
        let expected = expected_files
            .iter()
            .find(|(filename, _, _)| *filename == name)
            .ok_or("Unexpected file in installed runtime payload")?;
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err("Duplicate runtime payload filename".into());
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| "Runtime file metadata missing")?;
        if !metadata.is_file()
            || windows_acl::is_reparse(&metadata)
            || metadata.len() != expected.1
            || sha256_file(&path)? != expected.2
        {
            return Err(format!(
                "Managed runtime dependency failed pinned identity: {name}"
            ));
        }
    }
    if seen.len() != expected_files.len() {
        return Err("Managed runtime payload is incomplete".into());
    }
    Ok(())
}

fn u32_from(reader: &mut impl Read) -> io::Result<u32> {
    let mut b = [0; 4];
    reader.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}
fn u64_from(reader: &mut impl Read) -> io::Result<u64> {
    let mut b = [0; 8];
    reader.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}
fn gguf_string(reader: &mut impl Read) -> io::Result<String> {
    let size = u64_from(reader)?;
    if size > 4096 {
        return Err(io::Error::other("GGUF field exceeds inspection budget"));
    }
    let mut b = vec![0u8; size as usize];
    reader.read_exact(&mut b)?;
    String::from_utf8(b).map_err(|_| io::Error::other("Invalid GGUF metadata string"))
}

/// Best-effort bounded metadata. Large tokenizer arrays are intentionally not
/// parsed; incomplete metadata stays unknown, never guessed from the filename.
fn gguf_value(reader: &mut impl Read, ty: u32, depth: u8) -> io::Result<Option<String>> {
    if depth > 2 {
        return Err(io::Error::other("GGUF nesting limit"));
    }
    let len = match ty {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        4 | 5 | 6 => 4,
        10..=12 => 8,
        8 => return gguf_string(reader).map(Some),
        9 => {
            let element = u32_from(reader)?;
            let count = u64_from(reader)?;
            if count > 8_192 {
                return Err(io::Error::other("GGUF array inspection limit"));
            }
            for _ in 0..count {
                gguf_value(reader, element, depth + 1)?;
            }
            return Ok(None);
        }
        _ => return Err(io::Error::other("Unknown GGUF field type")),
    };
    let mut data = [0u8; 8];
    reader.read_exact(&mut data[..len])?;
    Ok(match ty {
        0 | 7 => Some(data[0].to_string()),
        2 => Some(u16::from_le_bytes([data[0], data[1]]).to_string()),
        4 => Some(u32::from_le_bytes(data[..4].try_into().unwrap()).to_string()),
        10 => Some(u64::from_le_bytes(data).to_string()),
        _ => None,
    })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifact {
    pub digest: String,
    pub size: u64,
    pub format: &'static str,
    pub format_version: u32,
    pub display_name: String,
    pub family: Option<String>,
    pub quantization: Option<String>,
    pub declared_context: Option<u64>,
    pub file_identity: String,
}

fn inspect(path: &Path) -> Result<ManagedArtifact, String> {
    let mut file = source_file(path)?;
    let size = file
        .metadata()
        .map_err(|_| "GGUF file metadata unavailable")?
        .len();
    if size < 24 {
        return Err("GGUF header is incomplete".into());
    }
    let mut head = [0u8; 24];
    file.read_exact(&mut head)
        .map_err(|_| "GGUF header is incomplete")?;
    if &head[0..4] != b"GGUF" {
        return Err("Only a GGUF model file is supported".into());
    }
    let version = u32::from_le_bytes(head[4..8].try_into().unwrap());
    if !(2..=3).contains(&version) {
        return Err("Unsupported GGUF header version".into());
    }
    let count = u64::from_le_bytes(head[16..24].try_into().unwrap());
    if count > 1_000_000 {
        return Err("Malformed GGUF metadata count".into());
    }
    let mut prefix = vec![0u8; (size.min(2 * 1024 * 1024)) as usize];
    file = source_file(path)?;
    file.read_exact(&mut prefix)
        .map_err(|_| "GGUF read failed")?;
    let mut reader = io::Cursor::new(&prefix[24..]);
    let mut meta = std::collections::HashMap::<String, String>::new();
    for _ in 0..count.min(512) {
        let Ok(key) = gguf_string(&mut reader) else {
            break;
        };
        let Ok(ty) = u32_from(&mut reader) else {
            break;
        };
        let Ok(value) = gguf_value(&mut reader, ty, 0) else {
            break;
        };
        if let Some(value) = value {
            if matches!(
                key.as_str(),
                "general.architecture"
                    | "general.name"
                    | "llama.context_length"
                    | "qwen2.context_length"
                    | "qwen3.context_length"
                    | "gemma.context_length"
                    | "general.file_type"
            ) {
                meta.insert(key, value);
            }
        }
    }
    let hex = sha256_file(path)?;
    let family = meta
        .get("general.architecture")
        .cloned()
        .filter(|v| !v.is_empty());
    let declared_context = family
        .as_deref()
        .and_then(|v| meta.get(&format!("{v}.context_length")))
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0 && *v <= 8_388_608);
    let display_name = meta
        .get("general.name")
        .filter(|v| !v.is_empty() && !v.chars().any(char::is_control))
        .cloned()
        .unwrap_or_else(|| format!("GGUF {}", &hex[..12]));
    Ok(ManagedArtifact {
        digest: format!("sha256:{hex}"),
        size,
        format: "gguf",
        format_version: version,
        display_name,
        family,
        quantization: None,
        declared_context,
        file_identity: format!("{hex}:{size}"),
    })
}

#[tauri::command]
pub fn managed_local_runtime_inspect(path: String) -> Result<ManagedArtifact, String> {
    inspect(Path::new(&path))
}

/// Copy policy: the original is never modified. The digest, not a filename or
/// a caller-controlled path, selects the private content-addressed imported file.
#[tauri::command]
pub fn managed_local_runtime_import(
    app: AppHandle,
    path: String,
    expected_digest: String,
) -> Result<ManagedArtifact, String> {
    import_gguf_into(Path::new(&path), &expected_digest, &models_dir(&app)?)
}

/// A testable, native-only import transaction. This is not another artifact
/// registry; the existing LM2B fabric stores the digest and deployment.
fn import_gguf_into(
    source: &Path,
    expected_digest: &str,
    dir: &Path,
) -> Result<ManagedArtifact, String> {
    let before = inspect(source)?;
    if before.digest != expected_digest {
        return Err("Model changed since inspection".into());
    }
    fs::create_dir_all(dir).map_err(|_| "Could not create private model directory")?;
    let destination = dir.join(format!("{}.gguf", &before.digest[7..]));
    if destination.exists() {
        if inspect(&destination)?.digest == before.digest {
            return Ok(before);
        }
        return Err("Existing private model digest does not match".into());
    }
    let mut from = source_file(source)?;
    let mut staged = tempfile::NamedTempFile::new_in(dir)
        .map_err(|_| "Could not create private temporary model file")?;
    let mut sha = Sha256::new();
    let mut length = 0u64;
    let mut block = [0u8; 64 * 1024];
    loop {
        let size = from.read(&mut block).map_err(|_| "Model copy failed")?;
        if size == 0 {
            break;
        }
        length += size as u64;
        if length > MAX_ARTIFACT_SIZE {
            return Err("Model exceeds import size limit".into());
        }
        sha.update(&block[..size]);
        staged
            .write_all(&block[..size])
            .map_err(|_| "Model copy failed")?;
    }
    let actual = format!("sha256:{:x}", sha.finalize());
    if length != before.size || actual != before.digest {
        return Err("Model file changed while importing; no model registered".into());
    }
    staged
        .as_file()
        .sync_all()
        .map_err(|_| "Model import sync failed")?;
    match staged.persist_noclobber(&destination) {
        Ok(_) => {}
        Err(error) if destination.exists() => {
            drop(error);
            if inspect(&destination)?.digest != before.digest {
                return Err("Concurrent model import has different contents".into());
            }
        }
        Err(_) => return Err("Could not atomically register model".into()),
    }
    Ok(before)
}

/// User-initiated provisioning only. Release builds must embed both official
/// digest pins. ZIP entries cannot escape the private, staged installation.
#[tauri::command]
pub fn managed_local_runtime_install_bundle(app: AppHandle, path: String) -> Result<(), String> {
    let approved_archive = approved_digest("archive")?;
    let approved_binary = approved_digest("executable")?;
    let source = Path::new(&path);
    if !path.to_ascii_lowercase().ends_with(".zip") || sha256_file(source)? != approved_archive {
        return Err(
            "Runtime archive does not match Clack's approved upstream release digest".into(),
        );
    }
    let destination = engine_dir(&app)?;
    if destination.exists() {
        verified_engine(&app)?;
        return Ok(());
    }
    let parent = destination.parent().ok_or("Invalid runtime directory")?;
    fs::create_dir_all(parent).map_err(|_| "Runtime install directory unavailable")?;
    #[cfg(windows)]
    {
        windows_acl::apply_private_acl(&private_root(&app)?)?;
        windows_acl::apply_private_acl(parent)?;
    }
    let stage = tempfile::tempdir_in(parent).map_err(|_| "Runtime staging unavailable")?;
    #[cfg(windows)]
    windows_acl::apply_private_acl(stage.path())?;
    let mut archive = zip::ZipArchive::new(source_file(source)?)
        .map_err(|_| "Runtime archive cannot be opened")?;
    if archive.len() > 256 {
        return Err("Runtime archive has too many entries".into());
    }
    #[cfg(windows)]
    if archive.len() != cpu_payload::FILES.len() {
        return Err("Runtime archive has a different set of files than approved".into());
    }
    let mut total = 0u64;
    #[cfg(windows)]
    let mut seen = std::collections::HashSet::new();
    for index in 0..archive.len() {
        let mut item = archive
            .by_index(index)
            .map_err(|_| "Runtime archive is corrupt")?;
        let name = item
            .enclosed_name()
            .ok_or("Unsafe runtime archive path")?
            .to_owned();
        #[cfg(windows)]
        {
            let supplied = item.name();
            if name.components().count() != 1 || supplied != name.to_string_lossy() {
                return Err("Runtime archive contains an unapproved path or subdirectory".into());
            }
            let approved = cpu_payload::FILES
                .iter()
                .find(|(filename, _, _)| *filename == supplied)
                .ok_or("Runtime archive contains an unexpected dependency")?;
            if item.is_dir()
                || item.size() != approved.1
                || !seen.insert(supplied.to_ascii_lowercase())
            {
                return Err(
                    "Runtime archive has a directory, duplicate or incorrect file size".into(),
                );
            }
        }
        if item
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Runtime archive symlinks are not allowed".into());
        }
        total = total
            .checked_add(item.size())
            .filter(|v| *v <= MAX_BUNDLE_SIZE)
            .ok_or("Runtime archive exceeds extraction limit")?;
        let destination = stage.path().join(name);
        if item.is_dir() {
            fs::create_dir_all(destination).map_err(|_| "Runtime directory creation failed")?;
        } else {
            fs::create_dir_all(destination.parent().ok_or("Invalid archive file")?)
                .map_err(|_| "Runtime directory creation failed")?;
            let mut out = File::create(&destination).map_err(|_| "Runtime extraction failed")?;
            io::copy(&mut item, &mut out).map_err(|_| "Runtime extraction failed")?;
            out.sync_all()
                .map_err(|_| "Runtime extraction sync failed")?;
        }
    }
    #[cfg(windows)]
    {
        if seen.len() != cpu_payload::FILES.len() {
            return Err("Runtime archive is missing approved payload entries".into());
        }
        verify_payload_dir(stage.path())?;
        windows_acl::check_private_acl(stage.path())?;
    }
    if sha256_file(&stage.path().join(EXECUTABLE))? != approved_binary {
        return Err("Extracted runtime binary identity does not match the approved release".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            stage.path().join(EXECUTABLE),
            fs::Permissions::from_mode(0o700),
        )
        .map_err(|_| "Runtime permissions unavailable")?;
    }
    // No replacing an existing running binary or rewriting an unrelated path.
    fs::rename(stage.path(), &destination)
        .map_err(|_| "Runtime install collision; existing content was preserved")?;
    #[cfg(windows)]
    {
        windows_acl::check_private_acl(&destination)?;
        verify_payload_dir(&destination)?;
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct BoundDeployment {
    id: String,
    identity: String,
    digest: String,
    context: u64,
}

/// Native side independently checks the current native-CAS fabric. A WebView
/// cannot pick a different file, port, engine or deployment by fabricating an
/// HTTP URL or presenting a same-named model on another host.
fn validate_binding(state: &Value, id: &str, identity: &str) -> Result<BoundDeployment, String> {
    let invalid = || "Managed deployment identity is missing, stale, or incompatible".to_owned();
    let fabric = &state["fabric"];
    if fabric["version"] != 1 {
        return Err(invalid());
    }
    let deployments = fabric["deployments"].as_array().ok_or_else(invalid)?;
    let rows: Vec<_> = deployments.iter().filter(|row| row["id"] == id).collect();
    if rows.len() != 1 {
        return Err(invalid());
    }
    let deployment = rows[0];
    let runtime_id = &deployment["runtimeId"];
    let host_id = &deployment["hostId"];
    if runtime_id != ENGINE || host_id != "clack-this-pc" || deployment["profileId"].is_string() {
        return Err(invalid());
    }
    let runtime = fabric["runtimes"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .find(|row| {
            row["id"] == *runtime_id
                && row["hostId"] == *host_id
                && row["type"] == ENGINE
                && row["enabled"] == true
                && row["version"] == ENGINE_VERSION
        })
        .ok_or_else(invalid)?;
    let host = fabric["hosts"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .find(|row| {
            row["id"] == *host_id
                && row["enabled"] == true
                && row["location"] == "local"
                && row["runtimeIds"]
                    .as_array()
                    .is_some_and(|ids| ids.contains(runtime_id))
        })
        .ok_or_else(invalid)?;
    let _ = host;
    if deployment["configurationRevision"] != runtime["configurationRevision"] {
        return Err(invalid());
    }
    let artifact = fabric["artifacts"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .find(|row| row["id"] == deployment["artifactId"] && row["format"] == "gguf")
        .ok_or_else(invalid)?;
    let digest = artifact["digest"].as_str().ok_or_else(invalid)?;
    if !digest.strip_prefix("sha256:").is_some_and(valid_hex)
        || artifact["id"] != json!(["digest", digest]).to_string()
    {
        return Err(invalid());
    }
    let material = deployment["configurationIdentity"]
        .as_str()
        .ok_or_else(invalid)?;
    let config: Value = serde_json::from_str(material).map_err(|_| invalid())?;
    let object = config.as_object().ok_or_else(invalid)?;
    if object.len() != 5
        || config["version"] != 1
        || config["tool"] != false
        || config["grammar"] != false
        || config["gpu"] != 0
    {
        return Err(invalid());
    }
    let context = config["context"]
        .as_u64()
        .filter(|v| (512..=131_072).contains(v))
        .ok_or_else(invalid)?;
    // Match the TypeScript managedLocalConfigurationIdentity key order exactly.
    // JSON-object equivalence alone must not create two behavioral identities.
    let canonical =
        format!(r#"{{"version":1,"context":{context},"gpu":0,"tool":false,"grammar":false}}"#);
    if material != canonical
        || deployment["runtimeModelName"] != format!("managed-gguf:{digest}")
        || deployment["id"] != json!(["managed-gguf", digest, canonical]).to_string()
    {
        return Err(invalid());
    }
    let expected = json!([
        deployment["hostId"],
        deployment["runtimeId"],
        deployment["artifactId"],
        deployment["runtimeModelName"],
        deployment["configurationRevision"],
        deployment["variantId"],
        deployment["configurationIdentity"]
    ])
    .to_string();
    if expected != identity {
        return Err(invalid());
    }
    Ok(BoundDeployment {
        id: id.to_owned(),
        identity: identity.to_owned(),
        digest: digest.to_owned(),
        context,
    })
}

fn current_binding(
    app: &AppHandle,
    deployment_id: &str,
    identity: &str,
) -> Result<BoundDeployment, String> {
    let settings = app
        .store("terax-settings.json")
        .map_err(|_| "Managed deployment settings unavailable")?;
    let state = settings
        .get("selfHostedInference")
        .ok_or("Managed deployment is not registered in native settings")?;
    validate_binding(&state, deployment_id, identity)
}

/// The native conversation-switch CAS accepts a longer managed selection ID
/// only when it is the exact canonical ID of a currently registered, valid
/// Clack-owned deployment. This never authorizes a route or an executable:
/// native readiness, the runtime epoch, payload and model hashes are checked
/// again at actual inference admission.
pub(crate) fn validate_managed_model_switch(
    app: &AppHandle,
    selection_id: &str,
) -> Result<(), String> {
    let invalid = || "Managed model-switch selection is missing or invalid".to_owned();
    let json = selection_id
        .strip_prefix("managed-local:")
        .ok_or_else(invalid)?;
    if selection_id.len() > 2048 {
        return Err(invalid());
    }
    let parsed: Value = serde_json::from_str(json).map_err(|_| invalid())?;
    let values = parsed
        .as_array()
        .filter(|values| values.len() == 2)
        .ok_or_else(invalid)?;
    let deployment_id = values[0].as_str().ok_or_else(invalid)?;
    let identity = values[1].as_str().ok_or_else(invalid)?;
    let binding = current_binding(app, deployment_id, identity).map_err(|_| invalid())?;
    if selection_id != format!("managed-local:{}", json!([binding.id, binding.identity])) {
        return Err(invalid());
    }
    Ok(())
}

struct RuntimeOwner {
    child: Option<Child>,
    secret_file: Option<tempfile::NamedTempFile>,
    #[cfg(windows)]
    job: Option<crate::modules::pty::job::PtyJob>,
    state: &'static str,
    epoch: String,
    started_at: Option<Instant>,
    deployment: Option<BoundDeployment>,
    port: Option<u16>,
    key: Option<String>,
    alias: Option<String>,
    error: Option<String>,
    logs: Arc<Mutex<Vec<u8>>>,
}

impl Default for RuntimeOwner {
    fn default() -> Self {
        Self {
            child: None,
            secret_file: None,
            #[cfg(windows)]
            job: None,
            state: "Stopped",
            epoch: random_hex().unwrap_or_default(),
            started_at: None,
            deployment: None,
            port: None,
            key: None,
            alias: None,
            error: None,
            logs: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

static OWNER: OnceLock<Mutex<RuntimeOwner>> = OnceLock::new();
fn owner() -> &'static Mutex<RuntimeOwner> {
    OWNER.get_or_init(|| Mutex::new(RuntimeOwner::default()))
}
fn random_hex() -> Result<String, String> {
    let mut random = [0u8; 32];
    fill(&mut random).map_err(|_| "OS randomness unavailable")?;
    Ok(random.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn roll_epoch(owner: &mut RuntimeOwner) {
    // Cryptographically random on each start/stop/crash, including app restarts.
    // If the OS RNG fails, old qualification must not become valid again.
    owner.epoch = random_hex().unwrap_or_default();
}
fn forget_process(owner: &mut RuntimeOwner, state: &'static str, error: Option<String>) {
    if let Some(mut child) = owner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(windows)]
    {
        owner.job = None;
    } // KILL_ON_JOB_CLOSE also reaps any descendant process.
    owner.secret_file = None; // Delete the private ephemeral API-key file.
    owner.state = state;
    owner.deployment = None;
    owner.port = None;
    owner.key = None;
    owner.alias = None;
    owner.started_at = None;
    owner.error = error;
    roll_epoch(owner);
}
fn reap_crash(owner: &mut RuntimeOwner) {
    if owner.child.as_mut().is_some_and(|child| {
        child
            .try_wait()
            .map(|status| status.is_some())
            .unwrap_or(true)
    }) {
        forget_process(
            owner,
            "Failed",
            Some("Managed runtime exited or crashed".into()),
        );
    }
}
fn drain_bounded<R: Read + Send + 'static>(mut stream: R, output: Arc<Mutex<Vec<u8>>>) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(size) = stream.read(&mut buffer) {
            if size == 0 {
                break;
            }
            if let Ok(mut output) = output.lock() {
                output.extend_from_slice(&buffer[..size]);
                if output.len() > MAX_LOG_BYTES {
                    let excess = output.len() - MAX_LOG_BYTES;
                    output.drain(..excess);
                }
            }
        }
    });
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeStatus {
    installed: bool,
    state: &'static str,
    version: &'static str,
    epoch: String,
    deployment_id: Option<String>,
    model_digest: Option<String>,
    process_id: Option<u32>,
    port: Option<u16>,
    error: Option<String>,
}
fn snapshot(owner: &RuntimeOwner, installed: bool) -> ManagedRuntimeStatus {
    ManagedRuntimeStatus {
        installed,
        state: if !installed {
            "Not Installed"
        } else {
            owner.state
        },
        version: ENGINE_VERSION,
        epoch: owner.epoch.clone(),
        deployment_id: owner.deployment.as_ref().map(|d| d.id.clone()),
        model_digest: owner.deployment.as_ref().map(|d| d.digest.clone()),
        process_id: owner.child.as_ref().map(Child::id),
        port: owner.port,
        error: owner.error.clone(),
    }
}

async fn authenticated_ready(port: u16, key: &str, alias: &str) -> Result<Option<bool>, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(900))
        .build()
        .map_err(|_| "Local health client unavailable")?;
    let url = format!("http://127.0.0.1:{port}");
    let health = client
        .get(format!("{url}/health"))
        .send()
        .await
        .map_err(|_| "Local runtime is not accepting connections")?;
    if health.status().as_u16() == 503 {
        return Ok(Some(false));
    }
    if !health.status().is_success() {
        return Ok(None);
    }
    // /health is public. Readiness additionally demands our *secret* runtime
    // token and the exact loaded alias, not a port held by another process.
    let models = client
        .get(format!("{url}/v1/models"))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|_| "Model identity health check failed")?;
    if !models.status().is_success() || models.content_length().is_some_and(|n| n > 65_536) {
        return Ok(None);
    }
    let body = models
        .bytes()
        .await
        .map_err(|_| "Model identity response unreadable")?;
    if body.len() > 65_536 {
        return Ok(None);
    }
    let parsed: Value =
        serde_json::from_slice(&body).map_err(|_| "Model identity response invalid")?;
    Ok(Some(parsed["data"].as_array().is_some_and(|models| {
        models.iter().any(|model| model["id"] == alias)
    })))
}

#[tauri::command]
pub async fn managed_local_runtime_status(app: AppHandle) -> Result<ManagedRuntimeStatus, String> {
    let installed = verified_engine(&app).is_ok();
    let health = {
        let mut owner = owner().lock().map_err(|_| "Runtime state poisoned")?;
        reap_crash(&mut owner);
        if !installed && owner.child.is_some() {
            forget_process(
                &mut owner,
                "Failed",
                Some("Runtime binary identity changed".into()),
            );
        }
        if !installed {
            return Ok(snapshot(&owner, false));
        }
        match (owner.port, owner.key.clone(), owner.alias.clone()) {
            (Some(port), Some(key), Some(alias)) if owner.child.is_some() => {
                Some((port, key, alias, owner.epoch.clone()))
            }
            _ => None,
        }
    };
    if let Some((port, key, alias, epoch)) = health {
        let probe = authenticated_ready(port, &key, &alias).await;
        let mut owner = owner().lock().map_err(|_| "Runtime state poisoned")?;
        reap_crash(&mut owner);
        if owner.epoch == epoch && owner.child.is_some() {
            match probe {
                Ok(Some(true)) => owner.state = "Ready",
                Ok(Some(false)) => owner.state = "Loading",
                _ if owner.state == "Ready" => {
                    forget_process(
                        &mut owner,
                        "Failed",
                        Some("Managed runtime lost authenticated health".into()),
                    );
                }
                _ if owner
                    .started_at
                    .is_some_and(|time| time.elapsed() > START_TIMEOUT) =>
                {
                    forget_process(
                        &mut owner,
                        "Failed",
                        Some("Managed runtime startup/metadata timeout".into()),
                    )
                }
                _ => owner.state = "Starting",
            }
        }
        return Ok(snapshot(&owner, installed));
    }
    let owner = owner().lock().map_err(|_| "Runtime state poisoned")?;
    Ok(snapshot(&owner, installed))
}

#[tauri::command]
pub fn managed_local_runtime_start(
    app: AppHandle,
    deployment_id: String,
    deployment_identity: String,
) -> Result<ManagedRuntimeStatus, String> {
    let binding = current_binding(&app, &deployment_id, &deployment_identity)?;
    let binary = verified_engine(&app)?;
    let model = model_path(&app, &binding.digest)?;
    if sha256_file(&model)? != binding.digest.trim_start_matches("sha256:") {
        return Err("Imported GGUF file is missing or was modified".into());
    }
    let mut owner = owner().lock().map_err(|_| "Runtime state poisoned")?;
    reap_crash(&mut owner);
    if owner.child.is_some() {
        if owner.deployment.as_ref().is_some_and(|existing| {
            existing.id == binding.id && existing.identity == binding.identity
        }) {
            return Ok(snapshot(&owner, true));
        }
        return Err("Stop the current managed deployment before loading another".into());
    }
    let random_key = random_hex()?;
    let epoch = random_hex()?;
    let alias = format!("clack-{}", &binding.digest[7..23]);
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Could not allocate local runtime transport")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not read local runtime port")?
        .port();
    drop(listener);
    let mut command = Command::new(binary);
    // Never inject parent process secrets, credentials, proxies or untrusted
    // LLAMA_ARG_* defaults into the engine process. CPU-only release bundles
    // must have their own trusted dependencies next to the executable.
    command.env_clear();
    #[cfg(windows)]
    {
        // Do not inherit a user-controlled DLL PATH or a forged SystemRoot.
        // The only DLL locations available to the child are its verified
        // executable/current directory and the Windows system DLL directory.
        let system32 = windows_acl::system_directory()?;
        let windir = system32.parent().ok_or("Windows directory unavailable")?;
        command.env("SystemRoot", windir);
        command.env("WINDIR", windir);
        command.env("PATH", &system32);
    }
    let secret_dir = private_root(&app)?.join("run");
    fs::create_dir_all(&secret_dir)
        .map_err(|_| "Could not create private runtime credential directory")?;
    #[cfg(windows)]
    windows_acl::apply_private_acl(&secret_dir)?;
    let mut secret_file = tempfile::NamedTempFile::new_in(&secret_dir)
        .map_err(|_| "Could not create private runtime credential")?;
    secret_file
        .write_all(random_key.as_bytes())
        .map_err(|_| "Could not write private runtime credential")?;
    secret_file
        .as_file()
        .sync_all()
        .map_err(|_| "Could not sync private runtime credential")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(secret_file.path(), fs::Permissions::from_mode(0o600))
            .map_err(|_| "Could not protect runtime credential")?;
    }
    command
        .current_dir(engine_dir(&app)?)
        .arg("--model")
        .arg(&model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--ctx-size")
        .arg(binding.context.to_string())
        .arg("--n-gpu-layers")
        .arg("0")
        .arg("--alias")
        .arg(&alias)
        .arg("--api-key-file")
        .arg(secret_file.path())
        .arg("--offline")
        .arg("--no-webui")
        .arg("--log-disable")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        // Native owner death kills the server even if Clack crashes without
        // reaching RunEvent::Exit. Never leave a stale local inference socket.
        unsafe {
            command.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::getppid() == 1 {
                    return Err(io::Error::other("Managed runtime parent exited"));
                }
                Ok(())
            });
        }
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Managed runtime launch failed")?;
    #[cfg(windows)]
    let managed_job = match crate::modules::pty::job::PtyJob::create_for(child.id()) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Could not place managed runtime in parent-owned Windows job".into());
        }
    };
    owner.logs = Arc::new(Mutex::new(Vec::new()));
    if let Some(stdout) = child.stdout.take() {
        drain_bounded(stdout, owner.logs.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        drain_bounded(stderr, owner.logs.clone());
    }
    owner.child = Some(child);
    owner.secret_file = Some(secret_file);
    #[cfg(windows)]
    {
        owner.job = Some(managed_job);
    }
    owner.state = "Starting";
    owner.epoch = epoch;
    owner.started_at = Some(Instant::now());
    owner.deployment = Some(binding);
    owner.port = Some(port);
    owner.key = Some(random_key);
    owner.alias = Some(alias);
    owner.error = None;
    Ok(snapshot(&owner, true))
}

#[tauri::command]
pub fn managed_local_runtime_stop(app: AppHandle) -> Result<ManagedRuntimeStatus, String> {
    let installed = verified_engine(&app).is_ok();
    let mut owner = owner().lock().map_err(|_| "Runtime state poisoned")?;
    owner.state = "Stopping";
    forget_process(&mut owner, "Stopped", None);
    Ok(snapshot(&owner, installed))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeRoute {
    base_url: String,
    api_key: String,
    epoch: String,
    model_alias: String,
    process_id: u32,
}

#[tauri::command]
pub async fn managed_local_runtime_route(
    app: AppHandle,
    deployment_id: String,
    deployment_identity: String,
    epoch: Option<String>,
) -> Result<ManagedRuntimeRoute, String> {
    let current = current_binding(&app, &deployment_id, &deployment_identity)?;
    // Re-observe authenticated health on every routing admission, not simply
    // the state left behind by an earlier UI poll.
    let witnessed = managed_local_runtime_status(app.clone()).await?;
    if witnessed.state != "Ready" {
        return Err("Managed runtime has no current authenticated Ready observation".into());
    }
    let mut owner = owner().lock().map_err(|_| "Runtime state poisoned")?;
    reap_crash(&mut owner);
    if owner.state != "Ready"
        || owner.deployment.as_ref().is_none_or(|loaded| {
            loaded.id != current.id
                || loaded.identity != current.identity
                || loaded.digest != current.digest
        })
        || owner.epoch.is_empty()
        || epoch.as_ref().is_some_and(|e| *e != owner.epoch)
    {
        return Err("Exact managed deployment is not ready; no Ollama fallback".into());
    }
    Ok(ManagedRuntimeRoute {
        base_url: format!(
            "http://127.0.0.1:{}/v1",
            owner.port.ok_or("No managed port")?
        ),
        api_key: owner.key.clone().ok_or("No runtime authentication")?,
        epoch: owner.epoch.clone(),
        model_alias: owner.alias.clone().ok_or("No loaded model identity")?,
        process_id: owner
            .child
            .as_ref()
            .ok_or("Runtime process unavailable")?
            .id(),
    })
}

pub fn shutdown() {
    if let Ok(mut owner) = owner().lock() {
        forget_process(&mut owner, "Stopped", None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_gguf() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"GGUF");
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes()); // tensor count
        bytes.extend_from_slice(&1u64.to_le_bytes()); // metadata count
        bytes.extend_from_slice(&20u64.to_le_bytes());
        bytes.extend_from_slice(b"general.architecture");
        bytes.extend_from_slice(&8u32.to_le_bytes()); // string
        bytes.extend_from_slice(&5u64.to_le_bytes());
        bytes.extend_from_slice(b"llama");
        bytes
    }

    #[test]
    fn gguf_header_digest_and_unsupported_input_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("model.gguf");
        let bytes = small_gguf();
        fs::write(&file, &bytes).unwrap();
        let inspected = inspect(&file).unwrap();
        assert_eq!(inspected.family.as_deref(), Some("llama"));
        assert_eq!(inspected.size, bytes.len() as u64);
        assert!(inspected.digest.starts_with("sha256:"));
        assert!(inspected.quantization.is_none());
        fs::write(&file, b"not GGUF").unwrap();
        assert!(inspect(&file).is_err());
    }

    #[test]
    fn import_deduplicates_by_digest_preserves_original_and_rejects_missing_or_modified() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.gguf");
        let imported_dir = root.path().join("private");
        let bytes = small_gguf();
        fs::write(&source, &bytes).unwrap();
        let inspected = inspect(&source).unwrap();
        let first = import_gguf_into(&source, &inspected.digest, &imported_dir).unwrap();
        assert_eq!(first.digest, inspected.digest);
        assert_eq!(fs::read(&source).unwrap(), bytes);
        assert_eq!(
            import_gguf_into(&source, &first.digest, &imported_dir)
                .unwrap()
                .digest,
            first.digest
        );
        let imported = imported_dir.join(format!("{}.gguf", &first.digest[7..]));
        assert_eq!(sha256_file(&imported).unwrap(), first.digest[7..]);

        // Source disappearance does not invalidate the user's Clack-owned
        // copy. A missing private copy DOES invalidate the launch digest.
        fs::rename(&source, root.path().join("moved.gguf")).unwrap();
        assert!(inspect(&source).is_err());
        assert_eq!(sha256_file(&imported).unwrap(), first.digest[7..]);
        let moved = root.path().join("moved.gguf");
        fs::write(&moved, b"changed").unwrap();
        assert!(import_gguf_into(&moved, &first.digest, &imported_dir).is_err());
        fs::remove_file(&imported).unwrap();
        assert!(sha256_file(&imported).is_err());
    }

    #[test]
    fn lifecycle_stop_rotates_epoch_and_clears_ephemeral_process_authority() {
        let mut active = RuntimeOwner::default();
        active.state = "Ready";
        active.epoch = "old-process-epoch".into();
        active.port = Some(55123);
        active.key = Some("secret".into());
        active.alias = Some("clack-model".into());
        active.deployment = Some(BoundDeployment {
            id: "one".into(),
            identity: "bound".into(),
            digest: format!("sha256:{}", "a".repeat(64)),
            context: 4096,
        });
        forget_process(&mut active, "Stopped", None);
        assert_eq!(active.state, "Stopped");
        assert_ne!(active.epoch, "old-process-epoch");
        assert_eq!(active.epoch.len(), 64);
        assert!(active.deployment.is_none());
        assert!(active.key.is_none());
        assert!(active.port.is_none());
        assert!(active.alias.is_none());
        assert!(active.child.is_none());
    }

    #[test]
    fn managed_identity_is_host_runtime_artifact_and_material_scoped() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let artifact_id = json!(["digest", digest]).to_string();
        let material =
            r#"{"version":1,"context":4096,"gpu":0,"tool":false,"grammar":false}"#.to_owned();
        let deployment_id = json!(["managed-gguf", digest, material]).to_string();
        let runtime_model_name = format!("managed-gguf:{digest}");
        let deployment = json!({
            "id": deployment_id, "hostId":"clack-this-pc",
            "runtimeId":ENGINE, "artifactId":artifact_id, "runtimeModelName":runtime_model_name,
            "configurationRevision":1, "configurationIdentity":material
        });
        let state = json!({"fabric":{"version":1,
            "hosts":[{"id":"clack-this-pc","enabled":true,"location":"local","runtimeIds":[ENGINE]}],
            "runtimes":[{"id":ENGINE,"hostId":"clack-this-pc","type":ENGINE,"enabled":true,
                "configurationRevision":1,"version":ENGINE_VERSION}],
            "artifacts":[{"id":artifact_id,"format":"gguf","digest":digest}],
            "deployments":[deployment]
        }});
        let identity = json!([
            "clack-this-pc",
            ENGINE,
            artifact_id,
            runtime_model_name,
            1,
            null,
            material
        ])
        .to_string();
        assert!(validate_binding(&state, &deployment_id, &identity).is_ok());
        let mut altered = state.clone();
        altered["fabric"]["runtimes"][0]["version"] = json!("b12249");
        assert!(validate_binding(&altered, &deployment_id, &identity).is_err());
        let mut altered = state.clone();
        altered["fabric"]["runtimes"][0]["type"] = json!("ollama");
        assert!(validate_binding(&altered, &deployment_id, &identity).is_err());
        let mut altered = state.clone();
        altered["fabric"]["deployments"][0]["configurationRevision"] = json!(2);
        assert!(validate_binding(&altered, &deployment_id, &identity).is_err());
        let mut altered = state.clone();
        altered["fabric"]["deployments"][0]["configurationIdentity"] =
            json!(r#"{"version":1,"context":8192,"gpu":0,"tool":false,"grammar":false}"#);
        assert!(validate_binding(&altered, &deployment_id, &identity).is_err());
        let mut altered = state.clone();
        altered["fabric"]["artifacts"][0]["digest"] = json!(format!("sha256:{}", "b".repeat(64)));
        assert!(validate_binding(&altered, &deployment_id, &identity).is_err());
    }

    #[test]
    fn unapproved_executable_never_becomes_installed_by_filename() {
        if option_env!("CLACK_MANAGED_LLAMA_BUNDLE_SHA256").is_none() {
            assert!(approved_digest("archive").is_err());
        }
        assert!(!valid_hex("untrusted"));
        assert!(valid_hex(&"a".repeat(64)));
    }

    #[cfg(windows)]
    #[test]
    fn private_windows_acl_and_complete_payload_enforcement() {
        let staging = tempfile::tempdir().unwrap();
        let dir = staging.path().join("managed-runtime-test");
        fs::create_dir(&dir).unwrap();
        windows_acl::apply_private_acl(&dir).unwrap();
        windows_acl::check_private_acl(&dir).unwrap();

        let dependency = dir.join("llama-server-impl.dll");
        fs::write(&dependency, b"fixture dependency").unwrap();
        let expected = [(
            "llama-server-impl.dll",
            18u64,
            "901b608999d7683ab72289c6ce73dd2c580dbdc9c4eb14ab440f1d3a47d30926",
        )];
        // Use the computed fixture SHA only; never treat test data as the
        // production, statically embedded trusted dependency manifest.
        let digest = sha256_file(&dependency).unwrap();
        let fixture = [(expected[0].0, 18u64, digest.as_str())];
        assert!(verify_payload_dir_expected(&dir, &fixture).is_ok());

        fs::write(&dependency, b"fixture tampered!!").unwrap();
        assert!(verify_payload_dir_expected(&dir, &fixture).is_err());
        fs::write(&dependency, b"fixture dependency").unwrap();

        fs::write(dir.join("unexpected.dll"), b"unexpected").unwrap();
        assert!(verify_payload_dir_expected(&dir, &fixture).is_err());
        fs::remove_file(dir.join("unexpected.dll")).unwrap();
        fs::remove_file(&dependency).unwrap();
        assert!(verify_payload_dir_expected(&dir, &fixture).is_err());
    }
}
