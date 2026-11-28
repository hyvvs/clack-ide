//! Clack-managed GGUF inference. No WebView process spawning, PATH lookup,
//! automatic downloads, user-provided executable hashes or Ollama fallback.
//! A release must embed the approved b12248 archive AND executable SHA-256.
//! Missing release pins mean Not Installed rather than executable-by-name trust.
use getrandom::fill;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub const ENGINE: &str = "clack-managed-llama.cpp";
pub const ENGINE_VERSION: &str = "b12248";
const MAX_ARTIFACT_SIZE: u64 = 512 * 1024 * 1024 * 1024;
const MAX_BUNDLE_SIZE: u64 = 4 * 1024 * 1024 * 1024;
const MAX_LOG_BYTES: usize = 512 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(90);

#[cfg(windows)]
mod cpu_payload {
    include!("managed_llama_cpu_b12248_manifest.rs");
}
#[cfg(windows)]
mod cuda_payload {
    include!("managed_llama_cuda_b12248_manifest.rs");
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

/// The already-pinned CPU payload remains in engine/b12248 untouched. The
/// independently verified CUDA DLL/engine release is a sibling *variant*.
fn cuda_engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(engine_dir(app)?.join("cuda"))
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

#[cfg(windows)]
fn verified_cuda_engine(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = cuda_engine_dir(app)?;
    for path in [
        private_root(app)?,
        engine_dir(app)?.parent().unwrap().to_path_buf(),
        engine_dir(app)?,
        directory.clone(),
    ] {
        windows_acl::check_private_acl(&path)?;
    }
    verify_payload_dir_expected(&directory, cuda_payload::ALL_FILES)?;
    let system32 = windows_acl::system_directory()?;
    if !system32.join("nvcuda.dll").is_file() {
        return Err("NVIDIA driver CUDA library is unavailable in Windows System32".into());
    }
    // This complete SHA-verified snapshot is safe to reuse for read-only
    // status of the same running application. Every future start verifies
    // all files again rather than relying on the status cache.
    cuda_status_cache()
        .lock()
        .ok()
        .map(|mut map| map.insert(directory.clone(), Instant::now()));
    Ok(directory.join(EXECUTABLE))
}
#[cfg(not(windows))]
fn verified_cuda_engine(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Managed CUDA release is not supported on this platform".into())
}

#[cfg(windows)]
fn validate_cuda_release_archive(path: &Path, expected: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Approved CUDA ZIP is missing")?;
    if !metadata.is_file()
        || windows_acl::is_reparse(&metadata)
        || metadata.len() > 1024 * 1024 * 1024
        || path.extension().and_then(|v| v.to_str()) != Some("zip")
        || sha256_file(path)? != expected
    {
        return Err(
            "CUDA archive does not match its pinned official llama.cpp release SHA-256".into(),
        );
    }
    Ok(())
}

#[cfg(windows)]
fn extract_cuda_release_archive(
    path: &Path,
    stage: &Path,
    expected: &[(&str, u64, &str)],
) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(source_file(path)?)
        .map_err(|_| "Approved CUDA archive could not be opened")?;
    if archive.len() != expected.len() || archive.len() > 128 {
        return Err("CUDA archive does not contain its exact pinned file manifest".into());
    }
    let mut names = HashSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "CUDA archive entry unreadable")?;
        let enclosed = entry.enclosed_name().ok_or("Unsafe CUDA ZIP entry")?;
        let filename = entry.name().to_string();
        if enclosed.components().count() != 1
            || filename != enclosed.to_string_lossy()
            || !names.insert(filename.to_ascii_lowercase())
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Unsafe, duplicate or non-file CUDA archive entry".into());
        }
        let approved = expected
            .iter()
            .find(|(name, _, _)| *name == filename)
            .ok_or("Unapproved CUDA dependency in archive")?;
        if entry.size() != approved.1 {
            return Err("CUDA dependency size differs from pinned release".into());
        }
        total = total
            .checked_add(entry.size())
            .filter(|n| *n <= MAX_BUNDLE_SIZE)
            .ok_or("CUDA release exceeds bounded installation size")?;
        let dest = stage.join(&filename);
        let mut out = File::create(&dest).map_err(|_| "Could not extract approved CUDA file")?;
        io::copy(&mut entry, &mut out).map_err(|_| "CUDA extraction failed")?;
        out.sync_all().map_err(|_| "CUDA dependency sync failed")?;
        if sha256_file(&dest)? != approved.2 {
            return Err(format!(
                "CUDA release file failed pinned identity: {filename}"
            ));
        }
    }
    if names.len() != expected.len() {
        return Err("CUDA release manifest incomplete".into());
    }
    Ok(())
}

/// User-triggered, two-archive official CUDA 13.5 provisioning under the SAME
/// native managed runtime owner. No PATH search, unverified sidecar, or CPU
/// runtime overwrite. Atomic private stage→rename only after all 56 files pass.
#[tauri::command]
pub fn managed_local_runtime_install_cuda_bundles(
    app: AppHandle,
    engine_zip_path: String,
    cuda_dll_zip_path: String,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = (app, engine_zip_path, cuda_dll_zip_path);
        Err("CUDA provisioning is Windows x64 only".into())
    }
    #[cfg(windows)]
    {
        if std::env::consts::ARCH != "x86_64" {
            return Err("Pinned CUDA runtime is Windows x64 only".into());
        }
        validate_cuda_release_archive(
            Path::new(&engine_zip_path),
            cuda_payload::ENGINE_ARCHIVE_SHA256,
        )?;
        validate_cuda_release_archive(
            Path::new(&cuda_dll_zip_path),
            cuda_payload::CUDA_DLLS_ARCHIVE_SHA256,
        )?;
        let destination = cuda_engine_dir(&app)?;
        if destination.exists() {
            verified_cuda_engine(&app)?;
            return Ok(());
        }
        let parent = engine_dir(&app)?;
        fs::create_dir_all(&parent).map_err(|_| "Managed CUDA parent unavailable")?;
        for path in [
            private_root(&app)?,
            parent.parent().unwrap().to_path_buf(),
            parent.clone(),
        ] {
            windows_acl::apply_private_acl(&path)?;
        }
        let stage = tempfile::tempdir_in(&parent).map_err(|_| "CUDA staging unavailable")?;
        windows_acl::apply_private_acl(stage.path())?;
        extract_cuda_release_archive(
            Path::new(&engine_zip_path),
            stage.path(),
            cuda_payload::ENGINE_FILES,
        )?;
        extract_cuda_release_archive(
            Path::new(&cuda_dll_zip_path),
            stage.path(),
            cuda_payload::CUDA_DLLS_FILES,
        )?;
        verify_payload_dir_expected(stage.path(), cuda_payload::ALL_FILES)?;
        windows_acl::check_private_acl(stage.path())?;
        fs::rename(stage.path(), &destination)
            .map_err(|_| "CUDA install collision; existing managed engine preserved")?;
        verified_cuda_engine(&app)?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedCudaVariantStatus {
    pub installed: bool,
    runtime_variant_id: &'static str,
    backend: &'static str,
    version: &'static str,
    platform: &'static str,
    source: &'static str,
    pub engine_archive_sha256: &'static str,
    pub dependency_archive_sha256: &'static str,
    pub executable_sha256: &'static str,
    license: &'static str,
    pub error: Option<String>,
}

#[tauri::command]
pub fn managed_local_runtime_cuda_variant_status(app: AppHandle) -> ManagedCudaVariantStatus {
    #[cfg(windows)]
    let engine_sha = cuda_payload::ENGINE_FILES
        .iter()
        .find(|(name, _, _)| *name == EXECUTABLE)
        .map(|(_, _, sha)| *sha)
        .unwrap_or("");
    #[cfg(not(windows))]
    let engine_sha = "";
    // Display/read-only status may reuse a recently verified private bundle.
    // The native start path always revalidates every file independently.
    let observation = if verified_cuda_engine_status(&app) {
        cuda_engine_dir(&app).map(|dir| dir.join(EXECUTABLE))
    } else {
        verified_cuda_engine(&app)
    };
    ManagedCudaVariantStatus {
        installed: observation.is_ok(),
        runtime_variant_id: "b12248/cuda",
        backend: "cuda",
        version: ENGINE_VERSION,
        platform: "windows-x64-cuda13.5",
        source: "github.com/ggml-org/llama.cpp/releases/tag/b12248",
        #[cfg(windows)]
        engine_archive_sha256: cuda_payload::ENGINE_ARCHIVE_SHA256,
        #[cfg(not(windows))]
        engine_archive_sha256: "",
        #[cfg(windows)]
        dependency_archive_sha256: cuda_payload::CUDA_DLLS_ARCHIVE_SHA256,
        #[cfg(not(windows))]
        dependency_archive_sha256: "",
        executable_sha256: engine_sha,
        license: "MIT llama.cpp; NVIDIA CUDA redistributable libraries carry NVIDIA licensing",
        error: observation.err(),
    }
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
        // The CPU b12248 root also owns the independently verified CUDA
        // variant subtree. It is not part of the CPU ZIP file manifest.
        if expected_files.len() == cpu_payload::FILES.len()
            && dir.file_name().is_some_and(|part| part == ENGINE_VERSION)
            && name == "cuda"
        {
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|_| "CUDA variant directory metadata unavailable")?;
            if !metadata.is_dir() || windows_acl::is_reparse(&metadata) {
                return Err("CUDA variant path is not a regular private directory".into());
            }
            continue;
        }
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
        4..=6 => 4,
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
    /// Read from the bounded GGUF header, not a filename or estimated family.
    pub block_count: Option<u64>,
    pub embedding_length: Option<u64>,
    pub attention_head_count: Option<u64>,
    pub attention_head_count_kv: Option<u64>,
    pub attention_key_length: Option<u64>,
    pub attention_value_length: Option<u64>,
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
                    | "general.size_label"
                    | "llama.context_length"
                    | "qwen2.context_length"
                    | "qwen3.context_length"
                    | "gemma.context_length"
                    | "general.file_type"
            ) || (key.len() <= 96
                && [
                    ".block_count",
                    ".embedding_length",
                    ".attention.head_count",
                    ".attention.head_count_kv",
                    ".attention.key_length",
                    ".attention.value_length",
                ]
                .iter()
                .any(|suffix| key.ends_with(suffix)))
            {
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
    let numeric = |suffix: &str| {
        family
            .as_deref()
            .and_then(|arch| meta.get(&format!("{arch}.{suffix}")))
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0 && *value <= 1_048_576)
    };
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
        family: family.clone(),
        quantization: None,
        declared_context,
        file_identity: format!("{hex}:{size}"),
        block_count: numeric("block_count"),
        embedding_length: numeric("embedding_length"),
        attention_head_count: numeric("attention.head_count"),
        attention_head_count_kv: numeric("attention.head_count_kv"),
        attention_key_length: numeric("attention.key_length"),
        attention_value_length: numeric("attention.value_length"),
    })
}

/// Read-only metadata on the *existing* content-addressed imported GGUF.
/// Recheck full digest: a private filename is not proof that bytes are intact.
/// Does not load a model, start a server, or change its settings.
#[tauri::command]
pub fn managed_local_runtime_model_metadata(
    app: AppHandle,
    digest: String,
) -> Result<ManagedArtifact, String> {
    let path = model_path(&app, &digest)?;
    let observed = inspect(&path)?;
    if observed.digest != digest {
        return Err("Imported GGUF no longer matches the exact digest".into());
    }
    Ok(observed)
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

/// The persisted requestedExecution object is the one authoritative launch
/// policy. Serde field order mirrors the Fabric/Zod schema so native identity
/// validation matches the exact JSON.stringify identity of v3 deployments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedFallback {
    policy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    order: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedCandidate {
    backend: String,
    device_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gpu_layers: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_variant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_build_digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedMemoryBudget {
    #[serde(skip_serializing_if = "Option::is_none")]
    max_device_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_host_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reserve_device_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reserve_host_bytes: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedDeviceStrategy {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    primary_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    split_strategy: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedExecutionPolicy {
    backend: String,
    device_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gpu_layers: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_threads: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_available_device_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_available_host_bytes: Option<u64>,
    fallback: PersistedFallback,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidates: Option<Vec<PersistedCandidate>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_budget: Option<PersistedMemoryBudget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    device_strategy: Option<PersistedDeviceStrategy>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCandidateEvidence {
    policy_position: usize,
    backend: String,
    device_ids: Vec<String>,
    runtime_variant_id: Option<String>,
    installed: bool,
    verified: bool,
    healthy: Option<bool>,
    memory_admissible: bool,
    trust_state: &'static str,
    qualification_state: &'static str,
    state: &'static str,
    reasons: Vec<String>,
    estimated_required_bytes: Option<u64>,
    observed_available_bytes: Option<u64>,
}

struct NativeLaunchPlan {
    binary: PathBuf,
    backend: &'static str,
    device: Option<String>,
    gpu_layers: u32,
    cuda_model: Option<String>,
    gpu_free: Option<u64>,
    gpu_estimate: Option<u64>,
    host_free: Option<u64>,
    host_estimate: Option<u64>,
    reason: Option<String>,
    selected_index: usize,
    candidates: Vec<NativeCandidateEvidence>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BoundDeployment {
    id: String,
    identity: String,
    digest: String,
    context: u64,
    /// Exact request bound to persisted ModelDeployment, not IPC flags.
    requested_backend: String,
    device_id: Option<String>,
    gpu_layers: u32,
    cpu_fallback_allowed: bool,
    persisted_policy: Option<PersistedExecutionPolicy>,
}

fn valid_policy_backend(value: &str) -> bool {
    value.len() <= 64
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn valid_pinned_cuda_id(value: &str) -> bool {
    value
        .strip_prefix("clack-this-pc:accelerator:GPU-")
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && value.len() <= 160
                && suffix.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        })
}

fn parse_v3_policy(value: &Value, context: u64) -> Result<PersistedExecutionPolicy, String> {
    let invalid = || "Invalid persisted managed execution policy".to_owned();
    let request: PersistedExecutionPolicy =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    let candidates = request
        .candidates
        .as_ref()
        .filter(|candidates| !candidates.is_empty() && candidates.len() <= 16)
        .ok_or_else(invalid)?;
    if !valid_policy_backend(&request.backend)
        || request.context_length != Some(context)
        || request.device_ids.len() > 16
        || request.gpu_layers.is_some_and(|n| n > 1_000_000)
        || request.cpu_threads.is_some_and(|n| n == 0 || n > 65_536)
        || [
            request.min_available_device_bytes,
            request.min_available_host_bytes,
        ]
        .into_iter()
        .flatten()
        .any(|n| n > 9_007_199_254_740_991)
    {
        return Err(invalid());
    }
    let first = &candidates[0];
    if first.backend != request.backend
        || first.device_ids != request.device_ids
        || first
            .gpu_layers
            .is_some_and(|layers| Some(layers) != request.gpu_layers)
    {
        return Err("Persisted first candidate differs from requested execution".into());
    }
    let remaining: Vec<_> = candidates
        .iter()
        .skip(1)
        .map(|c| c.backend.clone())
        .collect();
    match request.fallback.policy.as_str() {
        "disabled" if candidates.len() == 1 && request.fallback.order.is_none() => {}
        "allow-compatible"
            if candidates.len() == 2
                && first.backend == "cuda"
                && remaining == ["cpu"]
                && request.fallback.order.is_none() => {}
        "explicit-order"
            if candidates.len() > 1 && request.fallback.order.as_ref() == Some(&remaining) => {}
        _ => return Err("Persisted backend ordering and fallback authorization disagree".into()),
    }
    for candidate in candidates {
        if !valid_policy_backend(&candidate.backend)
            || candidate.device_ids.len() > 16
            || candidate
                .device_ids
                .iter()
                .any(|id| id.is_empty() || id.len() > 2048)
            || candidate.device_ids.iter().collect::<HashSet<_>>().len()
                != candidate.device_ids.len()
            || candidate.gpu_layers.is_some_and(|n| n > 1_000_000)
            || candidate
                .runtime_variant_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 2048)
            || candidate
                .runtime_build_digest
                .as_ref()
                .is_some_and(|sha| !sha.strip_prefix("sha256:").is_some_and(valid_hex))
        {
            return Err(invalid());
        }
        if candidate.backend == "cuda"
            && candidate
                .device_ids
                .iter()
                .any(|id| !valid_pinned_cuda_id(id))
        {
            return Err("CUDA candidate lacks durable NVIDIA UUID identity".into());
        }
    }
    if let Some(budget) = request.memory_budget.as_ref() {
        if [
            budget.max_device_bytes,
            budget.max_host_bytes,
            budget.reserve_device_bytes,
            budget.reserve_host_bytes,
        ]
        .into_iter()
        .flatten()
        .any(|n| n > 9_007_199_254_740_991)
        {
            return Err("Persisted memory budget exceeds safe integer bounds".into());
        }
    }
    if let Some(strategy) = request.device_strategy.as_ref() {
        if !matches!(strategy.kind.as_str(), "single" | "multi")
            || strategy
                .primary_device_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 2048)
            || strategy
                .split_strategy
                .as_ref()
                .is_some_and(|split| !matches!(split.as_str(), "none" | "layers" | "rows"))
        {
            return Err("Unrecognized persisted multi-device strategy".into());
        }
        if let Some(primary) = strategy.primary_device_id.as_ref() {
            if !request.device_ids.contains(primary) {
                return Err("Persisted primary device is not in the ordered device set".into());
            }
        }
    }
    Ok(request)
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
    let cuda = deployment["variantId"] == "b12248/cuda";
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
        || artifact["id"].as_str() != Some(json!(["digest", digest]).to_string().as_str())
    {
        return Err(invalid());
    }
    let material = deployment["configurationIdentity"]
        .as_str()
        .ok_or_else(invalid)?;
    let config: Value = serde_json::from_str(material).map_err(|_| invalid())?;
    let object = config.as_object().ok_or_else(invalid)?;
    let v3 = config["version"] == 3;
    if config["tool"] != false
        || config["grammar"] != false
        || (v3 && (object.len() != 4 || deployment["variantId"].is_string()))
        || (!v3 && cuda && (object.len() != 4 || config["version"] != 2))
        || (!v3 && !cuda && (object.len() != 5 || config["version"] != 1 || config["gpu"] != 0))
    {
        return Err(invalid());
    }
    let context = config["context"]
        .as_u64()
        .filter(|v| (512..=131_072).contains(v))
        .ok_or_else(invalid)?;
    // Match the TypeScript managedLocalConfigurationIdentity key order exactly.
    // JSON-object equivalence alone must not create two behavioral identities.
    let canonical = if v3 {
        format!(r#"{{"version":3,"context":{context},"tool":false,"grammar":false}}"#)
    } else if cuda {
        format!(r#"{{"version":2,"context":{context},"tool":false,"grammar":false}}"#)
    } else {
        format!(r#"{{"version":1,"context":{context},"gpu":0,"tool":false,"grammar":false}}"#)
    };
    if material != canonical || deployment["runtimeModelName"] != format!("managed-gguf:{digest}") {
        return Err(invalid());
    }
    let mut persisted_policy = None;
    let (requested_backend, device_id, gpu_layers, cpu_fallback_allowed, requested_json) = if v3 {
        let request = parse_v3_policy(&deployment["requestedExecution"], context)?;
        let normalized = serde_json::to_string(&request).map_err(|_| invalid())?;
        let first = request
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .ok_or_else(invalid)?;
        let layers = request.gpu_layers.unwrap_or(0);
        let cpu_allowed = request.fallback.policy != "disabled"
            && request.candidates.as_ref().is_some_and(|candidates| {
                candidates
                    .iter()
                    .skip(1)
                    .any(|candidate| candidate.backend == "cpu")
            });
        let deployment_prefix = json!(["managed-gguf-policy-v3", digest, canonical]).to_string();
        let expected_id = format!(
            "{},{}]",
            deployment_prefix.trim_end_matches(']'),
            normalized
        );
        if deployment["id"] != expected_id {
            return Err("Persisted execution policy does not match exact deployment ID".into());
        }
        let result = (
            request.backend.clone(),
            first.device_ids.first().cloned(),
            layers,
            cpu_allowed,
            Some(normalized),
        );
        persisted_policy = Some(request);
        result
    } else if cuda {
        let request = &deployment["requestedExecution"];
        let device_ids = request["deviceIds"].as_array().ok_or_else(invalid)?;
        let device = device_ids
            .first()
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let layers = request["gpuLayers"]
            .as_u64()
            .filter(|n| (1..=999).contains(n))
            .ok_or_else(invalid)?;
        let policy = request["fallback"]["policy"].as_str().ok_or_else(invalid)?;
        if request.as_object().is_none_or(|fields| fields.len() != 5)
            || request["backend"] != "cuda"
            || device_ids.len() != 1
            || request["contextLength"] != context
            || request["fallback"]
                .as_object()
                .is_none_or(|fields| fields.len() != 1)
            || !matches!(policy, "disabled" | "allow-compatible")
            || !device.starts_with("clack-this-pc:accelerator:GPU-")
            || device.len() > 160
            || device
                .strip_prefix("clack-this-pc:accelerator:GPU-")
                .is_none_or(|id| !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
        {
            return Err(invalid());
        }
        let gpu_layers = layers as u32;
        if deployment["id"].as_str()
            != Some(
                json!([
                    "managed-gguf-cuda",
                    digest,
                    canonical,
                    layers,
                    device,
                    policy
                ])
                .to_string()
                .as_str(),
            )
        {
            return Err(invalid());
        }
        // Zod outputs the schema-defined field order; serde_json map values
        // are alphabetically sorted. Reconstruct exact canonical JS identity.
        let request_json = format!(
            r#"{{"backend":"cuda","deviceIds":[{}],"gpuLayers":{layers},"contextLength":{context},"fallback":{{"policy":"{policy}"}}}}"#,
            json!(device)
        );
        (
            "cuda".to_owned(),
            Some(device.to_owned()),
            gpu_layers,
            policy == "allow-compatible",
            Some(request_json),
        )
    } else {
        if deployment.get("requestedExecution").is_some()
            || deployment["variantId"].is_string()
            || deployment["id"].as_str()
                != Some(
                    json!(["managed-gguf", digest, canonical])
                        .to_string()
                        .as_str(),
                )
        {
            return Err(invalid());
        }
        ("cpu".to_owned(), None, 0, false, None)
    };
    let original = json!([
        deployment["hostId"],
        deployment["runtimeId"],
        deployment["artifactId"],
        deployment["runtimeModelName"],
        deployment["configurationRevision"],
        deployment["variantId"],
        deployment["configurationIdentity"]
    ])
    .to_string();
    let expected = if let Some(request_json) = requested_json {
        format!("{},{}]", &original[..original.len() - 1], request_json)
    } else {
        original
    };
    if expected != identity {
        return Err(invalid());
    }
    Ok(BoundDeployment {
        id: id.to_owned(),
        identity: identity.to_owned(),
        digest: digest.to_owned(),
        context,
        requested_backend,
        device_id,
        gpu_layers,
        cpu_fallback_allowed,
        persisted_policy,
    })
}

fn current_binding(
    app: &AppHandle,
    deployment_id: &str,
    identity: &str,
) -> Result<BoundDeployment, String> {
    let state =
        super::self_hosted_profiles::authoritative_settings_value(app, "selfHostedInference")
            .map_err(|_| "Managed deployment settings unavailable")?
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
    // Kept for the lifetime of this exact process, including its startup
    // health phase. A stopped/crashed owner releases only its own port claim.
    port_reservation: Option<PortReservation>,
    #[cfg(windows)]
    job: Option<crate::modules::pty::job::PtyJob>,
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    acceptance_root: Option<PathBuf>,
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    acceptance: bool,
    state: &'static str,
    epoch: String,
    started_at: Option<Instant>,
    deployment: Option<BoundDeployment>,
    port: Option<u16>,
    last_port: Option<u16>,
    key: Option<String>,
    alias: Option<String>,
    error: Option<String>,
    logs: Arc<Mutex<Vec<u8>>>,
    selected_backend: &'static str,
    selected_device_id: Option<String>,
    selected_gpu_layers: u32,
    cuda_offloaded_layers: Option<u32>,
    cuda_model: Option<String>,
    gpu_free_before_bytes: Option<u64>,
    gpu_free_after_bytes: Option<u64>,
    gpu_estimated_required_bytes: Option<u64>,
    measured_host_available_bytes: Option<u64>,
    estimated_host_required_bytes: Option<u64>,
    selected_candidate_index: Option<usize>,
    candidate_evaluations: Vec<NativeCandidateEvidence>,
    fallback_reason: Option<String>,
    /// A failed CUDA startup may be retried ONLY before the first route grant.
    /// This ticket lives in the existing per-deployment process owner, not a
    /// second scheduler. Stop/epoch rotation cancels it.
    pending_cpu_recovery: Option<StartupRecoveryTicket>,
    inference_route_issued: bool,
    failure_kind: Option<&'static str>,
}

#[derive(Clone, Debug)]
struct StartupRecoveryTicket {
    binding: BoundDeployment,
    invalidated_epoch: String,
    cuda_failure_reason: String,
    failure_kind: &'static str,
    failed_candidate_index: Option<usize>,
}

impl Default for RuntimeOwner {
    fn default() -> Self {
        Self {
            child: None,
            secret_file: None,
            port_reservation: None,
            #[cfg(windows)]
            job: None,
            #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
            acceptance_root: None,
            #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
            acceptance: false,
            state: "Stopped",
            epoch: random_hex().unwrap_or_default(),
            started_at: None,
            deployment: None,
            port: None,
            last_port: None,
            key: None,
            alias: None,
            error: None,
            logs: Arc::new(Mutex::new(Vec::new())),
            selected_backend: "cpu",
            selected_device_id: None,
            selected_gpu_layers: 0,
            cuda_offloaded_layers: None,
            cuda_model: None,
            gpu_free_before_bytes: None,
            gpu_free_after_bytes: None,
            gpu_estimated_required_bytes: None,
            measured_host_available_bytes: None,
            estimated_host_required_bytes: None,
            selected_candidate_index: None,
            candidate_evaluations: Vec::new(),
            fallback_reason: None,
            pending_cpu_recovery: None,
            inference_route_issued: false,
            failure_kind: None,
        }
    }
}

// A deployment's canonical ID includes its artifact and execution configuration;
// its native-validated identity additionally binds the registered host/runtime
// revision. Never use a renderer-supplied endpoint, model alias or bearer as a key.
type RuntimeKey = (String, String);
const MAX_MANAGED_OWNER_SLOTS: usize = 64;
const MAX_LIVE_MANAGED_CHILDREN: usize = 8;

#[derive(Default)]
struct RuntimeRegistryEntries {
    owners: HashMap<RuntimeKey, Arc<Mutex<RuntimeOwner>>>,
    // Short-lived launch reservations live in this SAME owner registry. They
    // prevent simultaneous launches from exceeding the native child bound.
    starting: HashSet<RuntimeKey>,
    reserved_ports: HashSet<u16>,
}

struct RuntimeRegistry {
    entries: Mutex<RuntimeRegistryEntries>,
    closing: AtomicBool,
    idle_epoch: String,
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    pending_synthetic_key: Mutex<Option<String>>,
}

static OWNER_REGISTRY: OnceLock<RuntimeRegistry> = OnceLock::new();
// One narrow transition fence over the EXISTING owner registry, not a second
// scheduler. Switching an artifact between immutable v3 policy identities
// retires the previous v3 child and its route before starting the replacement.
static POLICY_SWITCH_FENCE: Mutex<()> = Mutex::new(());
fn registry() -> &'static RuntimeRegistry {
    OWNER_REGISTRY.get_or_init(|| RuntimeRegistry {
        entries: Mutex::new(RuntimeRegistryEntries::default()),
        closing: AtomicBool::new(false),
        idle_epoch: random_hex().unwrap_or_default(),
        #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
        pending_synthetic_key: Mutex::new(None),
    })
}

fn runtime_key(binding: &BoundDeployment) -> RuntimeKey {
    (binding.id.clone(), binding.identity.clone())
}

fn retire_prior_persisted_policy_owner(binding: &BoundDeployment) -> Result<(), String> {
    if binding.persisted_policy.is_none() {
        return Ok(());
    }
    let targets = {
        let entries = registry()
            .entries
            .lock()
            .map_err(|_| "Managed owner registry unavailable")?;
        entries
            .owners
            .iter()
            .filter(|(key, _)| key.0 != binding.id || key.1 != binding.identity)
            .map(|(key, slot)| (key.clone(), slot.clone()))
            .collect::<Vec<_>>()
    };
    for (_key, slot) in targets {
        let mut owner = slot
            .lock()
            .map_err(|_| "Prior managed policy owner is busy")?;
        if owner
            .deployment
            .as_ref()
            .is_some_and(|old| old.digest == binding.digest && old.persisted_policy.is_some())
        {
            // The same artifact survives; old process, credential, PID, epoch
            // and route do not. Legacy CPU/CUDA owners are never changed here.
            forget_process(&mut owner, "Stopped", None);
        }
    }
    Ok(())
}

fn get_or_insert_owner(key: RuntimeKey) -> Result<Arc<Mutex<RuntimeOwner>>, String> {
    let registry = registry();
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| "Managed owner registry unavailable")?;
    if registry.closing.load(Ordering::Acquire) {
        return Err("Managed runtime host is shutting down".into());
    }
    get_or_insert_owner_in(&mut entries, key)
}

fn get_or_insert_owner_in(
    entries: &mut RuntimeRegistryEntries,
    key: RuntimeKey,
) -> Result<Arc<Mutex<RuntimeOwner>>, String> {
    if let Some(existing) = entries.owners.get(&key) {
        return Ok(existing.clone());
    }
    if entries.owners.len() >= MAX_MANAGED_OWNER_SLOTS {
        return Err("Managed runtime owner slot limit reached".into());
    }
    let owner = Arc::new(Mutex::new(RuntimeOwner::default()));
    entries.owners.insert(key, owner.clone());
    Ok(owner)
}

/// A selector is either an exact pair or entirely absent. Legacy unscoped
/// callers remain valid only while the native registry is unambiguous.
fn select_owner(
    deployment_id: Option<&str>,
    deployment_identity: Option<&str>,
) -> Result<Option<Arc<Mutex<RuntimeOwner>>>, String> {
    let entries = registry()
        .entries
        .lock()
        .map_err(|_| "Managed owner registry unavailable")?;
    select_owner_from_entries(&entries, deployment_id, deployment_identity)
}

fn select_owner_from_entries(
    entries: &RuntimeRegistryEntries,
    deployment_id: Option<&str>,
    deployment_identity: Option<&str>,
) -> Result<Option<Arc<Mutex<RuntimeOwner>>>, String> {
    match (deployment_id, deployment_identity) {
        (Some(id), Some(identity)) if !id.is_empty() && !identity.is_empty() => Ok(entries
            .owners
            .get(&(id.to_owned(), identity.to_owned()))
            .cloned()),
        (None, None) if entries.owners.is_empty() => Ok(None),
        (None, None) if entries.owners.len() == 1 => Ok(entries.owners.values().next().cloned()),
        // Stopped entries remain a historical native identity. A lone live
        // process among several keys NEVER gives an unscoped Stop authority.
        (None, None) => Err("Managed runtime requires an exact deployment selector".into()),
        _ => Err("Managed runtime selector requires both deployment ID and identity".into()),
    }
}

fn owners_for_deployment(id: &str) -> Result<Vec<Arc<Mutex<RuntimeOwner>>>, String> {
    let entries = registry()
        .entries
        .lock()
        .map_err(|_| "Managed owner registry unavailable")?;
    Ok(entries
        .owners
        .iter()
        .filter(|(key, _)| key.0 == id)
        .map(|(_, slot)| slot.clone())
        .collect())
}

struct StartReservation(RuntimeKey);
impl Drop for StartReservation {
    fn drop(&mut self) {
        if let Ok(mut entries) = registry().entries.lock() {
            entries.starting.remove(&self.0);
        }
    }
}

/// Admit one additional process under this exact key, counting all already
/// owned children and pending launches. A registry lock is retained only for
/// these short checks and the reservation insertion; never for the launch.
fn reserve_child_start(key: &RuntimeKey) -> Result<StartReservation, String> {
    let registry = registry();
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| "Managed owner registry unavailable")?;
    if registry.closing.load(Ordering::Acquire) {
        return Err("Managed runtime host is shutting down".into());
    }
    check_child_start_capacity(&entries, key)?;
    entries.starting.insert(key.clone());
    Ok(StartReservation(key.clone()))
}

fn check_child_start_capacity(
    entries: &RuntimeRegistryEntries,
    key: &RuntimeKey,
) -> Result<(), String> {
    if entries.starting.contains(key) {
        return Err("Exact managed deployment is already starting".into());
    }
    let own = entries
        .owners
        .get(key)
        .ok_or("Managed runtime owner must be registered before launch")?;
    let current = own
        .try_lock()
        .map_err(|_| "Exact managed runtime lifecycle is busy")?;
    if current.child.is_some() {
        return Err("Exact managed runtime already owns a child".into());
    }
    drop(current);
    let mut others_live = 0;
    for (other_key, other_slot) in &entries.owners {
        if other_key == key {
            continue;
        }
        let starting = entries.starting.contains(other_key);
        let other = other_slot
            .try_lock()
            .map_err(|_| "Concurrent managed runtime lifecycle is busy")?;
        let live = starting || other.child.is_some();
        if live && other_key.0 == key.0 {
            return Err("Stop the prior identity of this managed deployment first".into());
        }
        if live {
            others_live += 1;
        }
    }
    if others_live >= MAX_LIVE_MANAGED_CHILDREN {
        return Err("Managed runtime concurrent child limit reached".into());
    }
    Ok(())
}

/// The native registry, rather than a disposable TcpListener, owns the port
/// claim from selection until process stop/crash. This prevents two native
/// launches from selecting the same released ephemeral localhost port.
struct PortReservation(u16);
impl Drop for PortReservation {
    fn drop(&mut self) {
        if let Ok(mut entries) = registry().entries.lock() {
            entries.reserved_ports.remove(&self.0);
        }
    }
}

fn claim_port(entries: &mut RuntimeRegistryEntries, port: u16) -> bool {
    port != 0 && entries.reserved_ports.insert(port)
}

fn reserve_port(port: u16) -> Result<PortReservation, String> {
    let registry = registry();
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| "Managed port registry unavailable")?;
    if registry.closing.load(Ordering::Acquire) || !claim_port(&mut entries, port) {
        return Err("Managed runtime loopback port is already reserved or unavailable".into());
    }
    Ok(PortReservation(port))
}

fn reserve_fresh_loopback_port(exclude: Option<u16>) -> Result<(u16, PortReservation), String> {
    // Native siblings can race the ephemeral OS allocator after another
    // owner dropped its bind probe; retry only bounded candidate selections.
    for _ in 0..16 {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| "Could not allocate local runtime transport")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not read local runtime port")?
            .port();
        if exclude == Some(port) {
            continue;
        }
        let claimed = reserve_port(port);
        drop(listener);
        if let Ok(reservation) = claimed {
            return Ok((port, reservation));
        }
        if registry().closing.load(Ordering::Acquire) {
            return Err("Managed runtime host is shutting down".into());
        }
    }
    Err("Managed runtime could not claim a distinct loopback port".into())
}

/// The authenticated WebView acceptance runner can own only this fixed root
/// or an immediate child of its cases/ directory. Reparse/symlink escapes
/// cannot make an arbitrary AppData directory a qualification authority.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
pub fn acceptance_is_owned_webview_root(root: &Path) -> bool {
    let Ok(manifest) = Path::new(env!("CARGO_MANIFEST_DIR")).canonicalize() else {
        return false;
    };
    let fixed = manifest.join("target/lm11-b01-b03-authenticated-webview-20261119");
    let (Ok(actual_fixed), Ok(candidate)) = (fixed.canonicalize(), root.canonicalize()) else {
        return false;
    };
    // The named fixed root itself must not redirect through a junction.
    if actual_fixed != fixed
        || !candidate.is_dir()
        || fs::symlink_metadata(root).is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return false;
    }
    acceptance_is_direct_owned_webview_root(&fixed, &candidate)
}

/// Compare already-canonical paths. Keeping this small predicate separate
/// makes sibling and nested-case denial testable without filesystem effects.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_is_direct_owned_webview_root(fixed: &Path, candidate: &Path) -> bool {
    candidate == fixed || candidate.parent() == Some(fixed.join("cases").as_path())
}

/// Verify BOTH Tauri native storage roots, including the final data/
/// directory. The comparison deliberately does not trust the process
/// environment, a JavaScript request, or a path merely sharing a prefix.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_app_data_is_owned(app: &AppHandle, root: &Path) -> bool {
    if !acceptance_is_owned_webview_root(root) {
        return false;
    }
    let Ok(expected) = root.join("data").canonicalize() else {
        return false;
    };
    let Ok(data) = app.path().app_data_dir() else {
        return false;
    };
    let Ok(local_data) = app.path().app_local_data_dir() else {
        return false;
    };
    let (Ok(actual), Ok(actual_local)) = (data.canonicalize(), local_data.canonicalize()) else {
        return false;
    };
    let Ok(store) = tauri_plugin_store::resolve_store_path(app, "terax-settings.json") else {
        return false;
    };
    let Some(store_parent) = store.parent() else {
        return false;
    };
    let Ok(store_parent) = store_parent.canonicalize() else {
        return false;
    };
    expected.parent() == Some(root)
        && actual == expected
        && expected.is_dir()
        && actual_local.starts_with(root)
        && actual_local != root
        && actual_local.is_dir()
        && store_parent == expected
        && store.file_name() == Some(std::ffi::OsStr::new("terax-settings.json"))
}

/// Only an explicitly bound native child of the isolated acceptance host may
/// stand in for an installed engine. Normal hosts keep verified_engine().
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_synthetic_installed(app: &AppHandle, current: &RuntimeOwner) -> bool {
    current.acceptance
        && current
            .acceptance_root
            .as_ref()
            .is_some_and(|root| current.child.is_some() && acceptance_app_data_is_owned(app, root))
}

/// Generate the synthetic server's bearer secret in native code, before its
/// child is spawned. The caller supplies it to that child and returns it when
/// binding the exact process. The native owner admits that one issued secret,
/// rather than merely accepting an arbitrary 64-character hexadecimal key.
/// There is no WebView/IPC credential minting API.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
pub fn acceptance_new_synthetic_key() -> Result<String, String> {
    let key = random_hex()?;
    if registry().closing.load(Ordering::Acquire) {
        return Err("Managed runtime host is shutting down".into());
    }
    // The one pending test-only native secret is a sequential admission
    // handshake, not a live-runtime singleton. Already bound A/B/C children
    // retain their own independently rotated bearer keys and epochs.
    let mut pending = registry()
        .pending_synthetic_key
        .lock()
        .map_err(|_| "Synthetic key admission unavailable")?;
    if pending.is_some() {
        return Err("A synthetic native key is already pending".into());
    }
    *pending = Some(key.clone());
    Ok(key)
}

#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_valid_synthetic_route(port: u16, key: &str, alias: &str, digest: &str) -> bool {
    let Some(digest) = digest.strip_prefix("sha256:").filter(|hex| valid_hex(hex)) else {
        return false;
    };
    port != 0 && valid_hex(key) && alias == format!("clack-{}", &digest[..16])
}

/// Binding a child and a bearer token is NOT an authenticated Ready
/// observation. Only managed_local_runtime_status may promote to Ready after
/// the real /health and bearer /v1/models checks succeed.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn acceptance_unverified_owner_state() -> &'static str {
    "Starting"
}

/// Bind an actual child PID and loopback server to the existing production
/// owner, using the canonical deployment from this app's isolated Store.
/// The ordinary status and route commands still perform real authenticated
/// GET /health and bearer GET /v1/models before exposing any inference route.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
pub fn acceptance_bind_synthetic_child(
    app: &AppHandle,
    root: &Path,
    child: Child,
    port: u16,
    key: String,
    alias: String,
    deployment_id: &str,
    identity: &str,
) -> Result<(String, u32), String> {
    let mut incoming = Some(child);
    let result: Result<(String, u32), String> = (|| {
        let canonical_root = root
            .canonicalize()
            .map_err(|_| "Authenticated acceptance root is missing")?;
        if !acceptance_app_data_is_owned(app, &canonical_root) {
            return Err("Synthetic managed owner requires exact isolated AppData".into());
        }
        let binding = current_binding(app, deployment_id, identity)?;
        if !acceptance_valid_synthetic_route(port, &key, &alias, &binding.digest) {
            return Err("Synthetic runtime port, secret or model alias is invalid".into());
        }
        let process_id = incoming.as_ref().expect("Owned child not consumed").id();
        if incoming
            .as_mut()
            .expect("Owned child not consumed")
            .try_wait()
            .map_err(|_| "Synthetic child process status unavailable")?
            .is_some()
        {
            return Err("Synthetic child exited before binding".into());
        }
        let epoch = random_hex()?;
        let binding_key = runtime_key(&binding);
        let slot = get_or_insert_owner(binding_key.clone())?;
        let _reservation = reserve_child_start(&binding_key)?;
        let mut current = slot.lock().map_err(|_| "Managed owner unavailable")?;
        reap_crash(&mut current);
        if current.child.is_some() {
            return Err("Managed runtime already owns a child".into());
        }
        let mut pending = registry()
            .pending_synthetic_key
            .lock()
            .map_err(|_| "Synthetic key admission unavailable")?;
        if pending.as_deref() != Some(key.as_str()) {
            return Err("Synthetic runtime secret was not issued by this native owner".into());
        }
        let reserved_port = reserve_port(port)?;
        let job = crate::modules::pty::job::PtyJob::create_for(process_id)
            .map_err(|_| "Synthetic child could not join a parent-owned Windows job")?;
        *pending = None;
        current.logs = Arc::new(Mutex::new(Vec::new()));
        let child = incoming.as_mut().expect("Owned child not consumed");
        if let Some(stdout) = child.stdout.take() {
            drain_bounded(stdout, current.logs.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            drain_bounded(stderr, current.logs.clone());
        }
        current.child = incoming.take();
        current.secret_file = None;
        current.port_reservation = Some(reserved_port);
        current.job = Some(job);
        current.acceptance_root = Some(canonical_root);
        current.acceptance = true;
        current.state = acceptance_unverified_owner_state();
        current.epoch = epoch.clone();
        current.started_at = Some(Instant::now());
        current.deployment = Some(binding);
        current.port = Some(port);
        current.key = Some(key.clone());
        current.alias = Some(alias);
        current.error = None;
        Ok((epoch, process_id))
    })();
    // std::process::Child does not kill on Drop. A rejected binding must not
    // strand the harness's already spawned, untrusted synthetic service.
    if result.is_err() {
        if let Ok(mut pending) = registry().pending_synthetic_key.lock() {
            if pending.as_deref() == Some(key.as_str()) {
                *pending = None;
            }
        }
        if let Some(mut child) = incoming {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    result
}

/// Rotate only the isolated synthetic native owner's epoch to reproduce
/// stale-route/stale-CAS behavior; the child stays alive and must re-auth.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
pub fn acceptance_rotate_synthetic_epoch(app: &AppHandle, root: &Path) -> Result<String, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Authenticated acceptance root is missing")?;
    if !acceptance_app_data_is_owned(app, &canonical_root) {
        return Err("Synthetic epoch rotation requires exact isolated AppData".into());
    }
    let slot = select_owner(None, None)?.ok_or("No bound synthetic managed owner to rotate")?;
    let mut current = slot.lock().map_err(|_| "Managed owner unavailable")?;
    reap_crash(&mut current);
    if !current.acceptance
        || current.acceptance_root.as_ref() != Some(&canonical_root)
        || current.child.is_none()
        || current.state != "Ready"
    {
        return Err("No bound synthetic managed owner to rotate".into());
    }
    roll_epoch(&mut current);
    Ok(current.epoch.clone())
}

/// The feature host may stop only its exact case-owned synthetic deployment.
/// This leaves sibling B/C children, their credentials, epochs and routes live.
#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
pub fn acceptance_stop_synthetic_child(
    app: &AppHandle,
    root: &Path,
    deployment_id: &str,
    identity: &str,
) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Authenticated acceptance root is missing")?;
    if !acceptance_app_data_is_owned(app, &canonical_root) {
        return Err("Synthetic stop requires exact isolated AppData".into());
    }
    let slot = select_owner(Some(deployment_id), Some(identity))?
        .ok_or("No exact native synthetic deployment to stop")?;
    let mut current = slot.lock().map_err(|_| "Managed owner unavailable")?;
    if !current.acceptance
        || current.acceptance_root.as_ref() != Some(&canonical_root)
        || current
            .deployment
            .as_ref()
            .is_none_or(|binding| binding.id != deployment_id || binding.identity != identity)
        || current.child.is_none()
    {
        return Err("Synthetic stop does not own this exact native child".into());
    }
    forget_process(&mut current, "Stopped", None);
    Ok(())
}

/// The acceptance feature can affect only the one specifically authorized
/// root, or one direct per-case directory under its cases/ subdirectory.
/// Canonicalization also rejects symlinks/reparse points escaping that root.
#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
pub fn acceptance_is_owned_scenario_root(root: &Path) -> bool {
    let fixed = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/lm11-b03-native-acceptance-20261119-real-host");
    let (Ok(fixed), Ok(candidate)) = (fixed.canonicalize(), root.canonicalize()) else {
        return false;
    };
    candidate == fixed || candidate.parent() == Some(fixed.join("cases").as_path())
}

/// Acceptance-only synthetic Ready owner with a REAL benign child OS PID.
/// The production qualification admission and pre-replace process/epoch
/// checks remain unchanged. No model executable, port or inference is used.
#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
pub fn acceptance_bind_benign_child(
    root: &Path,
    deployment_id: &str,
) -> Result<(String, u32), String> {
    let expected = std::fs::canonicalize(root).map_err(|_| "Acceptance root must already exist")?;
    if !acceptance_is_owned_scenario_root(&expected) {
        return Err("Refusing to seed managed runtime outside owned acceptance root".into());
    }
    let exe = std::env::current_exe().map_err(|_| "Acceptance binary unavailable")?;
    let child = Command::new(exe)
        .arg("--b03-benign-child")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not launch acceptance-only idle child")?;
    let pid = child.id();
    let mut incoming = Some(child);
    let result = (|| {
        let identity = "b03-isolated-fake-owner";
        let slot = get_or_insert_owner((deployment_id.to_string(), identity.into()))?;
        let mut current = slot.lock().map_err(|_| "Managed owner unavailable")?;
        if current.child.is_some() {
            return Err("Already have an acceptance managed child".into());
        }
        // A failed entropy source must never strand an already-spawned child
        // in the registry without a usable epoch or recovery identity.
        let epoch = random_hex()?;
        current.child = incoming.take();
        current.state = "Ready";
        current.epoch = epoch.clone();
        current.deployment = Some(BoundDeployment {
            id: deployment_id.to_string(),
            identity: identity.into(),
            digest: "no-model-ever-loaded".into(),
            context: 1,
            requested_backend: "cpu".into(),
            device_id: None,
            gpu_layers: 0,
            cpu_fallback_allowed: false,
            persisted_policy: None,
        });
        Ok((epoch, pid))
    })();
    if result.is_err() {
        if let Some(mut child) = incoming {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    result
}

#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
pub fn acceptance_rotate_benign_epoch() -> Result<String, String> {
    let slot = select_owner(None, None)?.ok_or("No acceptance process to fence")?;
    let mut current = slot.lock().map_err(|_| "Managed owner unavailable")?;
    if current.child.is_none() || current.state != "Ready" {
        return Err("No acceptance process to fence".into());
    }
    roll_epoch(&mut current);
    Ok(current.epoch.clone())
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
    owner.port_reservation = None;
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    {
        owner.acceptance_root = None;
        owner.acceptance = false;
    }
    owner.state = state;
    owner.deployment = None;
    owner.last_port = owner.port.take().or(owner.last_port);
    owner.key = None;
    owner.alias = None;
    owner.started_at = None;
    owner.error = error;
    owner.pending_cpu_recovery = None;
    owner.inference_route_issued = false;
    owner.failure_kind = None;
    owner.candidate_evaluations.clear();
    owner.selected_candidate_index = None;
    owner.measured_host_available_bytes = None;
    owner.estimated_host_required_bytes = None;
    // A failed CUDA owner must remain labeled CUDA until the next start/stop.
    // Otherwise a crash on a host with only the CUDA variant installed turns
    // into a misleading "Not Installed" CPU status and loses the real reason.
    // The child/secret/port/epoch are ALWAYS reaped and invalidated above.
    if state != "Failed" && state != "Recovering" {
        owner.selected_backend = "cpu";
        owner.selected_device_id = None;
        owner.selected_gpu_layers = 0;
        owner.cuda_model = None;
        owner.gpu_free_before_bytes = None;
        owner.fallback_reason = None;
    }
    owner.cuda_offloaded_layers = None;
    owner.gpu_free_after_bytes = None;
    owner.gpu_estimated_required_bytes = None;
    roll_epoch(owner);
}

/// Classify startup failure from real owned-child observations. The diagnostic
/// is bounded and contains neither command-line credentials nor model paths.
fn classify_startup_failure(logs: &[u8], timed_out: bool) -> &'static str {
    let log = String::from_utf8_lossy(logs).to_ascii_lowercase();
    if log.contains("address already in use")
        || log.contains("bind failed")
        || log.contains("failed to bind")
    {
        "port-collision"
    } else if log.contains("failed to load")
        || log.contains("dll not found")
        || log.contains("could not load")
        || log.contains("loadlibrary")
        || log.contains("cublas64")
    {
        "dependency-load-failure"
    } else if timed_out {
        "ready-timeout"
    } else {
        "child-exited-before-ready"
    }
}

fn can_fallback_after_spawn(
    backend: &str,
    state: &str,
    route_issued: bool,
    policy_allows_cpu: bool,
) -> bool {
    backend == "cuda"
        && matches!(state, "Starting" | "Loading")
        && !route_issued
        && policy_allows_cpu
}

/// Retire and reap the failed CUDA child BEFORE issuing any alternate launch
/// reservation. No CPU retry after Ready, any route grant, or a CPU failure.
fn fail_or_stage_cuda_recovery(owner: &mut RuntimeOwner, reason: String, timed_out: bool) {
    let failure_kind = owner
        .logs
        .lock()
        .ok()
        .map(|logs| classify_startup_failure(&logs, timed_out))
        .unwrap_or("startup-failed");
    let can_recover_cpu = owner.deployment.as_ref().is_some_and(|binding| {
        binding.persisted_policy.as_ref().is_none_or(|policy| {
            policy.candidates.as_ref().is_some_and(|candidates| {
                candidates
                    .iter()
                    .skip(owner.selected_candidate_index.unwrap_or(0) + 1)
                    .any(|candidate| candidate.backend == "cpu")
            })
        })
    });
    let eligible = owner.child.is_some()
        && can_recover_cpu
        && can_fallback_after_spawn(
            owner.selected_backend,
            owner.state,
            owner.inference_route_issued,
            owner
                .deployment
                .as_ref()
                .is_some_and(|binding| binding.cpu_fallback_allowed),
        );
    let former = if eligible {
        owner.deployment.clone()
    } else {
        None
    };
    let failed_candidate_index = owner.selected_candidate_index;
    forget_process(
        owner,
        if eligible { "Recovering" } else { "Failed" },
        Some(reason.clone()),
    );
    owner.failure_kind = Some(failure_kind);
    if let Some(binding) = former {
        owner.pending_cpu_recovery = Some(StartupRecoveryTicket {
            binding,
            invalidated_epoch: owner.epoch.clone(),
            cuda_failure_reason: reason,
            failure_kind,
            failed_candidate_index,
        });
    }
}
fn reap_crash(owner: &mut RuntimeOwner) {
    if owner.child.as_mut().is_some_and(|child| {
        child
            .try_wait()
            .map(|status| status.is_some())
            .unwrap_or(true)
    }) {
        fail_or_stage_cuda_recovery(
            owner,
            "Managed runtime child exited before authenticated readiness or lost health".into(),
            false,
        );
    }
}

/// Read-only LM11 native persistence fence. This never probes, installs or
/// starts the runtime. The process epoch rotates on crash/start and restart.
pub(super) fn qualification_runtime_is_current(
    deployment_id: &str,
    runtime_epoch: &str,
    process_id: u32,
) -> bool {
    let Ok(slots) = owners_for_deployment(deployment_id) else {
        return false;
    };
    for slot in slots {
        let Ok(mut current) = slot.lock() else {
            return false;
        };
        reap_crash(&mut current);
        if current.state == "Ready"
            && current.epoch == runtime_epoch
            && current.child.as_ref().map(Child::id) == Some(process_id)
            && current
                .deployment
                .as_ref()
                .is_some_and(|d| d.id == deployment_id)
        {
            return true;
        }
    }
    false
}

/// The existing RuntimeOwner is the epoch authority. Hold its lock across
/// the ONE physical replacement syscall: start/stop/crash epoch mutation
/// cannot interleave after validation but before the irreversible boundary.
/// No process launch, external probe, or second operation registry.
pub(super) fn with_current_qualification_runtime<T>(
    deployment_id: &str,
    runtime_epoch: &str,
    process_id: u32,
    commit: impl FnOnce() -> T,
) -> Option<T> {
    let slots = owners_for_deployment(deployment_id).ok()?;
    for slot in slots {
        let mut current = slot.lock().ok()?;
        reap_crash(&mut current);
        if current.state == "Ready"
            && current.epoch == runtime_epoch
            && current.child.as_ref().map(Child::id) == Some(process_id)
            && current
                .deployment
                .as_ref()
                .is_some_and(|d| d.id == deployment_id)
        {
            // An A stop/epoch change must acquire this same per-key mutex;
            // sibling B/C can progress while A's actual replace is fenced.
            return Some(commit());
        }
    }
    None
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

/// Exact native startup evidence: the CUDA backend must initialize and the
/// model loader must report *positive* offloaded layers on the selected GPU.
/// A CLI flag or CUDA-capable display adapter alone never counts as execution.
fn observed_cuda_offload(logs: &[u8], model: &str) -> Option<u32> {
    let output = String::from_utf8_lossy(logs);
    // Upstream b12248 emits its device/backend evidence at informational log
    // verbosity, with `llama_prepare_model_devices` and `load_tensors` names.
    // It does NOT reliably emit a `ggml_cuda_init` marker. Require all three
    // independent statements: the exact selected NVIDIA model, positive CUDA0
    // model-buffer allocation, and positive offloaded model layers.
    let selected = output.lines().any(|line| {
        line.contains("llama_prepare_model_devices: using device CUDA0") && line.contains(model)
    });
    let gpu_allocated = output.lines().any(|line| {
        let Some((_, bytes)) = line.split_once("CUDA0 model buffer size =") else {
            return false;
        };
        bytes
            .split_whitespace()
            .next()
            .and_then(|number| number.parse::<f64>().ok())
            .is_some_and(|amount| amount.is_finite() && amount > 0.0)
    });
    if !selected || !gpu_allocated {
        return None;
    }
    output
        .lines()
        .filter_map(|line| {
            let (_, after) = line.split_once("offloaded ")?;
            if !after.contains(" layers to GPU") {
                return None;
            }
            let fraction = after.split_whitespace().next()?;
            let (used, total) = fraction.split_once('/')?;
            let layers = used.parse::<u32>().ok()?;
            let possible = total.parse::<u32>().ok()?;
            (layers > 0 && layers <= possible && possible <= 1000).then_some(layers)
        })
        .next_back()
}

fn verified_selected_engine(app: &AppHandle, backend: &str) -> bool {
    match backend {
        "cuda" => verified_cuda_engine_status(app),
        "cpu" => verified_engine(app).is_ok(),
        _ => false,
    }
}

/// Conservative initial CUDA memory admission. Available memory is independent
/// of total device capacity; absence of either is UNKNOWN and must reject.
/// The model file + context + runtime headroom is a lower-bound estimate, not
/// a promise that GPU allocation or quantized KV buffers will fit at launch.
fn cuda_memory_admission(
    model_bytes: u64,
    context: u64,
    requested_layers: u32,
    observed_transformer_blocks: Option<u64>,
    total: Option<u64>,
    free: Option<u64>,
) -> Result<u64, String> {
    if requested_layers == 0 {
        return Err("CUDA requires positive requested GPU-offload layers".into());
    }
    let total = total.ok_or("CUDA total VRAM is UNKNOWN")?;
    let free = free.ok_or("CUDA available VRAM is UNKNOWN")?;
    if free > total {
        return Err("CUDA free VRAM exceeds total: invalid device observation".into());
    }
    // Approximate a lower-bound *offloaded* model portion from inspected
    // GGUF tensor-block geometry; if unknown, conservatively use the entire
    // model. This is an admission heuristic, NOT a promised CUDA allocation.
    let model_part = if let Some(total_blocks) =
        observed_transformer_blocks.filter(|blocks| *blocks > 0 && *blocks < 1_000_000)
    {
        let total_layers = total_blocks + 1;
        let requested = (requested_layers as u64).min(total_layers);
        ((model_bytes as u128) * (requested as u128) / (total_layers as u128))
            .min(model_bytes as u128) as u64
    } else {
        model_bytes
    };
    let estimate = model_part
        .checked_add(
            context
                .checked_mul(64 * 1024)
                .ok_or("CUDA context memory estimate overflow")?,
        )
        .and_then(|size| size.checked_add(512 * 1024 * 1024))
        .ok_or("CUDA memory estimate overflow")?;
    if estimate > total || estimate > free {
        return Err(format!("Insufficient measured CUDA VRAM: approximate admission estimate at least {} MiB ({} requested GPU layers, model/context/runtime headroom); {} MiB free of {} MiB",
            estimate/(1024*1024),requested_layers,free/(1024*1024),total/(1024*1024)));
    }
    Ok(estimate)
}

/// CPU fallback is also admitted against measured free system RAM. Legacy
/// pinned CPU-only launches retain their original admission behavior; this
/// check is stricter only for an explicit accelerated→CPU fallback.
fn verified_admissible_fallback_cpu(
    app: &AppHandle,
    model_bytes: u64,
    context: u64,
) -> Result<PathBuf, String> {
    let memory = crate::modules::hardware_profile::local_hardware_observation();
    let free = memory
        .available_ram_bytes
        .ok_or("CPU fallback memory admission UNKNOWN: host free RAM is not measured")?;
    let estimated = model_bytes
        .checked_add(
            context
                .checked_mul(16 * 1024)
                .ok_or("CPU context memory estimate overflow")?,
        )
        .and_then(|n| n.checked_add(256 * 1024 * 1024))
        .ok_or("CPU memory estimate overflow")?;
    if free < estimated {
        return Err(format!(
            "CPU fallback insufficient RAM: approximate {} MiB required; {} MiB free",
            estimated / (1024 * 1024),
            free / (1024 * 1024)
        ));
    }
    verified_engine(app)
}

fn estimated_cpu_working_bytes(model_bytes: u64, context: u64) -> Result<u64, String> {
    model_bytes
        .checked_add(
            context
                .checked_mul(16 * 1024)
                .ok_or("CPU context memory estimate overflow")?,
        )
        .and_then(|n| n.checked_add(256 * 1024 * 1024))
        .ok_or_else(|| "CPU memory estimate overflow".into())
}

/// V3 policy evaluation uses the persisted, order-preserving candidate list.
/// This is a deterministic prelaunch admission over real local observations,
/// NOT a source of actual execution evidence. Unsupported future adapters
/// remain visible as rejected entries, never as executable launch choices.
fn resolve_persisted_launch(
    app: &AppHandle,
    binding: &BoundDeployment,
    model_bytes: u64,
    block_count: Option<u64>,
    resume_after: Option<usize>,
) -> Result<NativeLaunchPlan, String> {
    let policy = binding
        .persisted_policy
        .as_ref()
        .ok_or("Persisted execution policy is absent")?;
    let ordered = policy
        .candidates
        .as_ref()
        .ok_or("Persisted candidate order absent")?;
    let memory = crate::modules::hardware_profile::local_hardware_observation();
    let free_host = memory.available_ram_bytes;
    let host_estimate = estimated_cpu_working_bytes(model_bytes, binding.context)?;
    let budget = policy.memory_budget.as_ref();
    let mut evaluations = Vec::with_capacity(ordered.len());
    let mut prior_rejections = Vec::new();
    let mut chosen: Option<NativeLaunchPlan> = None;
    for (index, candidate) in ordered.iter().enumerate() {
        let is_skipped = chosen.is_some() || resume_after.is_some_and(|start| index <= start);
        let variant = match candidate.backend.as_str() {
            "cpu" => Some("b12248/cpu"),
            "cuda" => Some("b12248/cuda"),
            _ => None,
        };
        let mut entry = NativeCandidateEvidence {
            policy_position: index,
            backend: candidate.backend.clone(),
            device_ids: candidate.device_ids.clone(),
            runtime_variant_id: variant.map(str::to_owned),
            installed: false,
            verified: false,
            healthy: None,
            memory_admissible: false,
            trust_state: "UNKNOWN",
            qualification_state: "UNQUALIFIED",
            state: "rejected",
            reasons: Vec::new(),
            estimated_required_bytes: None,
            observed_available_bytes: None,
        };
        if is_skipped {
            entry.state = "not-evaluated";
            entry.reasons.push(if chosen.is_some() {
                "Earlier ordered candidate admitted; no second child will launch".into()
            } else {
                "Earlier candidate is ineligible for post-spawn recovery".into()
            });
            evaluations.push(entry);
            continue;
        }
        let reject = |message: &str, entry: &mut NativeCandidateEvidence| {
            entry.reasons.push(message.to_owned());
        };
        if resume_after.is_some() && candidate.backend != "cpu" {
            reject(
                "Post-spawn CUDA recovery permits only a later CPU candidate",
                &mut entry,
            );
        } else if variant.is_none() {
            reject(
                "Execution backend is not implemented on this host",
                &mut entry,
            );
        } else if policy.device_strategy.as_ref().is_some_and(|strategy| {
            strategy.kind == "multi"
                || strategy
                    .split_strategy
                    .as_deref()
                    .is_some_and(|split| split != "none")
        }) || candidate.device_ids.len() != 1
            || (candidate.backend == "cuda" && !valid_pinned_cuda_id(&candidate.device_ids[0]))
            || (candidate.backend == "cpu" && candidate.device_ids[0] != "clack-this-pc:cpu:0")
        {
            reject(
                "MULTI_GPU_EXECUTION_UNSUPPORTED or requested device identity invalid",
                &mut entry,
            );
        } else if candidate
            .runtime_variant_id
            .as_deref()
            .is_some_and(|pin| Some(pin) != variant)
        {
            reject(
                "Pinned runtime variant does not match candidate backend",
                &mut entry,
            );
        } else {
            let backend = candidate.backend.as_str();
            let expected_digest = match backend {
                "cpu" => approved_digest("archive").map(str::to_owned),
                "cuda" => {
                    #[cfg(windows)]
                    {
                        Ok(cuda_payload::ENGINE_ARCHIVE_SHA256.to_owned())
                    }
                    #[cfg(not(windows))]
                    {
                        Err("CUDA is unsupported on this host".into())
                    }
                }
                _ => Err("Unknown executable backend".into()),
            };
            if candidate.runtime_build_digest.as_ref().is_some_and(|pin| {
                expected_digest
                    .as_ref()
                    .is_ok_and(|expected| pin != &format!("sha256:{expected}"))
            }) {
                reject(
                    "Pinned runtime archive digest differs from verified release",
                    &mut entry,
                );
            } else if let Err(error) = expected_digest {
                entry.reasons.push(error);
            } else {
                entry.installed = match backend {
                    "cpu" => engine_dir(app).is_ok_and(|dir| dir.join(EXECUTABLE).is_file()),
                    "cuda" => cuda_engine_dir(app).is_ok_and(|dir| dir.join(EXECUTABLE).is_file()),
                    _ => false,
                };
                let verified = if backend == "cuda" {
                    verified_cuda_engine(app)
                } else {
                    verified_engine(app)
                };
                match verified {
                    Err(error) => entry
                        .reasons
                        .push(format!("Runtime manifest verification failed: {error}")),
                    Ok(binary) => {
                        entry.verified = true;
                        entry.trust_state = "VERIFIED";
                        if free_host.is_none() {
                            reject("Available host RAM measurement UNKNOWN", &mut entry);
                        } else {
                            let free = free_host.unwrap_or(0);
                            let required_host_min =
                                host_estimate.max(policy.min_available_host_bytes.unwrap_or(0));
                            if budget
                                .and_then(|b| b.max_host_bytes)
                                .is_some_and(|limit| host_estimate > limit)
                            {
                                reject(
                                    "Estimated host RAM requirement exceeds hard policy budget",
                                    &mut entry,
                                );
                            } else if free.saturating_sub(
                                budget.and_then(|b| b.reserve_host_bytes).unwrap_or(0),
                            ) < required_host_min
                            {
                                reject(
                                    "Insufficient measured host RAM after policy reserve",
                                    &mut entry,
                                );
                            } else if backend == "cpu" {
                                entry.estimated_required_bytes = Some(host_estimate);
                                entry.observed_available_bytes = Some(free);
                                entry.memory_admissible = true;
                                entry.state = "admitted";
                                chosen = Some(NativeLaunchPlan {
                                    binary,
                                    backend: "cpu",
                                    device: None,
                                    gpu_layers: 0,
                                    cuda_model: None,
                                    gpu_free: None,
                                    gpu_estimate: None,
                                    host_free: Some(free),
                                    host_estimate: Some(host_estimate),
                                    reason: None,
                                    selected_index: index,
                                    candidates: Vec::new(),
                                });
                            } else {
                                let layers =
                                    candidate.gpu_layers.or(policy.gpu_layers).unwrap_or(0);
                                let gpu = crate::modules::hardware_profile::cuda_device_for_request(
                                    &candidate.device_ids[0],
                                );
                                match gpu {
                                    Err(error) => entry
                                        .reasons
                                        .push(format!("CUDA device unavailable: {error}")),
                                    Ok(gpu) => {
                                        let total = gpu.total_vram_bytes.as_ref().map(|v| v.value);
                                        let available =
                                            gpu.available_vram_bytes.as_ref().map(|v| v.value);
                                        entry.observed_available_bytes = available;
                                        match cuda_memory_admission(
                                            model_bytes,
                                            binding.context,
                                            layers,
                                            block_count,
                                            total,
                                            available,
                                        ) {
                                            Err(error) => entry.reasons.push(error),
                                            Ok(estimate) => {
                                                entry.estimated_required_bytes = Some(estimate);
                                                let free = available.unwrap_or(0);
                                                let require = estimate.max(
                                                    policy.min_available_device_bytes.unwrap_or(0),
                                                );
                                                if budget
                                                    .and_then(|b| b.max_device_bytes)
                                                    .is_some_and(|limit| estimate > limit)
                                                {
                                                    reject("Estimated VRAM requirement exceeds hard policy device budget",&mut entry);
                                                } else if free.saturating_sub(
                                                    budget
                                                        .and_then(|b| b.reserve_device_bytes)
                                                        .unwrap_or(0),
                                                ) < require
                                                {
                                                    reject("Insufficient measured VRAM after policy reserve",&mut entry);
                                                } else if let Some(model) =
                                                    gpu.model.map(|v| v.value)
                                                {
                                                    entry.memory_admissible = true;
                                                    entry.state = "admitted";
                                                    chosen = Some(NativeLaunchPlan {
                                                        binary,
                                                        backend: "cuda",
                                                        device: Some(
                                                            candidate.device_ids[0].clone(),
                                                        ),
                                                        gpu_layers: layers,
                                                        cuda_model: Some(model),
                                                        gpu_free: Some(free),
                                                        gpu_estimate: Some(estimate),
                                                        host_free: Some(free_host.unwrap_or(0)),
                                                        host_estimate: Some(host_estimate),
                                                        reason: None,
                                                        selected_index: index,
                                                        candidates: Vec::new(),
                                                    });
                                                } else {
                                                    reject(
                                                        "NVIDIA device model identity UNKNOWN",
                                                        &mut entry,
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if entry.state == "rejected" {
            prior_rejections.push(format!(
                "#{} {}: {}",
                index,
                candidate.backend,
                entry.reasons.join("; ")
            ));
        }
        evaluations.push(entry);
    }
    let mut selected = chosen.ok_or_else(|| {
        format!(
            "Persisted execution candidates rejected: {}",
            prior_rejections.join(" | ")
        )
    })?;
    if selected.selected_index > 0 {
        selected.reason = Some(format!(
            "Persisted ordered fallback admitted candidate #{}: {}",
            selected.selected_index,
            prior_rejections.join(" | ")
        ));
    }
    selected.candidates = evaluations;
    Ok(selected)
}

/// A rejected CUDA admission can select only a separately verified managed
/// CPU variant and only when the persisted deployment explicitly allows it.
/// The reason is retained for the native requested-vs-actual status record.
fn authorized_cuda_cpu_fallback(
    allowed: bool,
    cuda_reason: String,
    verify_cpu: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<(PathBuf, String), String> {
    if !allowed {
        return Err(format!(
            "CUDA execution rejected; fallback disabled: {cuda_reason}"
        ));
    }
    let binary = verify_cpu().map_err(|cpu_error| {
        format!(
            "CUDA rejected ({cuda_reason}); authorized CPU fallback is unavailable: {cpu_error}"
        )
    })?;
    Ok((binary, cuda_reason))
}

/// Hot status/route polling never launches a new executable. Cache a strictly
/// positive full-file verification for a short period; every CUDA *start*
/// independently reruns the exact 56-file SHA-256 manifest validation. This
/// avoids rehashing ~700 MiB on every 750ms health tick while preserving the
/// fail-closed pre-exec integrity gate and native owned-process epoch fence.
#[cfg(windows)]
fn cuda_status_cache() -> &'static Mutex<HashMap<PathBuf, Instant>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Instant>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
#[cfg(windows)]
fn verified_cuda_engine_status(app: &AppHandle) -> bool {
    let Ok(path) = cuda_engine_dir(app) else {
        return false;
    };
    let store = cuda_status_cache();
    if store.lock().ok().is_some_and(|map| {
        map.get(&path)
            .is_some_and(|time| time.elapsed() < Duration::from_secs(180))
    }) {
        return true;
    }
    let okay = verified_cuda_engine(app).is_ok();
    if let Ok(mut map) = store.lock() {
        if okay {
            map.insert(path, Instant::now());
        } else {
            map.remove(&path);
        }
    }
    okay
}
#[cfg(not(windows))]
fn verified_cuda_engine_status(_app: &AppHandle) -> bool {
    false
}

#[cfg(feature = "managed-cuda-native-acceptance")]
pub fn managed_cuda_acceptance_log_summary(deployment_id: &str, identity: &str) -> Vec<String> {
    let Ok(Some(slot)) = select_owner(Some(deployment_id), Some(identity)) else {
        return vec![];
    };
    let Ok(owner) = slot.lock() else {
        return vec![];
    };
    let Ok(bytes) = owner.logs.lock() else {
        return vec![];
    };
    let log = String::from_utf8_lossy(&bytes);
    log.lines()
        .filter(|line| {
            let l = line.to_ascii_lowercase();
            (l.contains("cuda")
                || l.contains("offload")
                || l.contains("gpu")
                || l.contains("ggml")
                || l.contains("error")
                || l.contains("failed")
                || l.contains("invalid")
                || l.contains("unknown")
                || l.contains("load")
                || l.contains("option"))
                && !l.contains("key")
                && !l.contains("secret")
                && !l.contains("password")
                && !l.contains("token")
                && !l.contains("\\")
                && !l.contains(".gguf")
                && !l.contains("/users/")
        })
        .take(80)
        .map(|line| line.chars().take(256).collect())
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedExecutionReceipt {
    version: u8,
    deployment_id: String,
    deployment_identity: String,
    policy_identity: String,
    selected_candidate_index: usize,
    process_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_build_digest: Option<String>,
    fallback_used: bool,
    fallback_authorized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    measured_host_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    measured_device_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedActualExecution {
    pub backend: &'static str,
    pub device_ids: Vec<String>,
    pub gpu_layers: u32,
    pub runtime_variant_id: &'static str,
    runtime_epoch: String,
    source: &'static str,
    context_length: u64,
    observed_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    execution_receipt: Option<ManagedExecutionReceipt>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeStatus {
    pub installed: bool,
    pub state: &'static str,
    runtime_id: &'static str,
    version: &'static str,
    pub epoch: String,
    deployment_id: Option<String>,
    deployment_identity_hash: Option<String>,
    model_digest: Option<String>,
    pub process_id: Option<u32>,
    pub port: Option<u16>,
    pub error: Option<String>,
    /// Only native-owned, authenticated Ready with a verified pinned launcher
    /// establishes actual CPU execution; a backend request never does.
    pub actual_execution: Option<ManagedActualExecution>,
    requested_backend: Option<String>,
    pub selected_backend: Option<&'static str>,
    requested_gpu_layers: Option<u32>,
    selected_gpu_layers: Option<u32>,
    selected_device_id: Option<String>,
    pub fallback_used: bool,
    pub fallback_authorized: bool,
    pub fallback_reason: Option<String>,
    pub gpu_free_before_bytes: Option<u64>,
    pub gpu_free_after_bytes: Option<u64>,
    pub cuda_process_vram_bytes: Option<u64>,
    pub gpu_estimated_required_bytes: Option<u64>,
    pub recovery_state: &'static str,
    pub failure_kind: Option<&'static str>,
    pub inference_route_issued: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    requested_execution: Option<PersistedExecutionPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_candidate_index: Option<usize>,
    candidate_evaluations: Vec<NativeCandidateEvidence>,
}
fn snapshot(owner: &RuntimeOwner, installed: bool) -> ManagedRuntimeStatus {
    ManagedRuntimeStatus {
        installed,
        state: if !installed {
            "Not Installed"
        } else {
            owner.state
        },
        runtime_id: ENGINE,
        version: ENGINE_VERSION,
        epoch: owner.epoch.clone(),
        deployment_id: owner.deployment.as_ref().map(|d| d.id.clone()),
        deployment_identity_hash: owner
            .deployment
            .as_ref()
            .map(|d| format!("sha256:{:x}", Sha256::digest(d.identity.as_bytes()))),
        model_digest: owner.deployment.as_ref().map(|d| d.digest.clone()),
        process_id: owner.child.as_ref().map(Child::id),
        port: owner.port,
        error: owner.error.clone(),
        actual_execution: owner.deployment.as_ref().and_then(|binding| {
            (installed && owner.state == "Ready" && owner.child.is_some())
                .then(|| ManagedActualExecution {
                    backend: owner.selected_backend,
                    device_ids: if owner.selected_backend == "cuda" {
                        owner.selected_device_id.clone().into_iter().collect()
                    } else {
                        vec!["clack-this-pc:cpu:0".to_owned()]
                    },
                    gpu_layers: if owner.selected_backend == "cuda" {
                        owner.cuda_offloaded_layers.unwrap_or(0)
                    } else {
                        0
                    },
                    runtime_variant_id: if owner.selected_backend == "cuda" {
                        "b12248/cuda"
                    } else {
                        "b12248/cpu"
                    },
                    runtime_epoch: owner.epoch.clone(),
                    source: if owner.selected_backend == "cuda" {
                        "native-verified-cuda-init-and-layer-offload"
                    } else {
                        "native-verified-managed-cpu-launch"
                    },
                    context_length: binding.context,
                    observed_at: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                        .min(u64::MAX as u128) as u64,
                    execution_receipt: binding.persisted_policy.as_ref().and_then(|policy| {
                        let index = owner.selected_candidate_index?;
                        let pid = owner.child.as_ref()?.id();
                        let policy_json = serde_json::to_string(policy).ok()?;
                        let build_sha = match owner.selected_backend {
                            "cpu" => approved_digest("archive").ok().map(str::to_owned),
                            "cuda" => {
                                #[cfg(windows)]
                                {
                                    Some(cuda_payload::ENGINE_ARCHIVE_SHA256.to_owned())
                                }
                                #[cfg(not(windows))]
                                {
                                    None
                                }
                            }
                            _ => None,
                        };
                        Some(ManagedExecutionReceipt {
                            version: 3,
                            deployment_id: binding.id.clone(),
                            deployment_identity: binding.identity.clone(),
                            policy_identity: policy_json,
                            selected_candidate_index: index,
                            process_id: pid,
                            runtime_build_digest: build_sha.map(|sha| format!("sha256:{sha}")),
                            fallback_used: owner.fallback_reason.is_some(),
                            fallback_authorized: owner.fallback_reason.is_some()
                                && policy.fallback.policy != "disabled",
                            measured_host_bytes: owner.measured_host_available_bytes,
                            measured_device_bytes: owner.gpu_free_before_bytes,
                        })
                    }),
                })
                .filter(|_| {
                    owner.selected_backend != "cuda" || owner.cuda_offloaded_layers.is_some()
                })
        }),
        requested_backend: owner
            .deployment
            .as_ref()
            .map(|d| d.requested_backend.clone()),
        selected_backend: (owner.deployment.is_some() || owner.state == "Failed")
            .then_some(owner.selected_backend),
        requested_gpu_layers: owner.deployment.as_ref().map(|d| d.gpu_layers),
        selected_gpu_layers: (owner.deployment.is_some() || owner.state == "Failed")
            .then_some(owner.selected_gpu_layers),
        selected_device_id: owner.selected_device_id.clone(),
        fallback_used: owner.deployment.is_some() && owner.fallback_reason.is_some(),
        fallback_authorized: owner.deployment.as_ref().is_some_and(|d| {
            d.persisted_policy
                .as_ref()
                .is_some_and(|policy| policy.fallback.policy != "disabled")
                || d.cpu_fallback_allowed
        }) && owner.fallback_reason.is_some(),
        fallback_reason: owner.fallback_reason.clone(),
        gpu_free_before_bytes: owner.gpu_free_before_bytes,
        gpu_free_after_bytes: owner.gpu_free_after_bytes,
        gpu_estimated_required_bytes: owner.gpu_estimated_required_bytes,
        cuda_process_vram_bytes: if installed
            && owner.state == "Ready"
            && owner.selected_backend == "cuda"
        {
            owner.child.as_ref().and_then(|child| {
                crate::modules::hardware_profile::cuda_process_vram_bytes(child.id())
            })
        } else {
            None
        },
        recovery_state: if owner.pending_cpu_recovery.is_some() {
            "pending-cpu-recovery"
        } else if owner.fallback_reason.is_some() {
            "cpu-fallback-launched"
        } else if owner.state == "Failed" {
            "failed"
        } else {
            "none"
        },
        failure_kind: owner.failure_kind,
        inference_route_issued: owner.inference_route_issued,
        requested_execution: owner
            .deployment
            .as_ref()
            .and_then(|d| d.persisted_policy.clone()),
        selected_candidate_index: owner.selected_candidate_index,
        candidate_evaluations: owner
            .candidate_evaluations
            .iter()
            .cloned()
            .map(|mut candidate| {
                if owner.state == "Ready"
                    && owner.selected_candidate_index == Some(candidate.policy_position)
                {
                    candidate.healthy = Some(true);
                }
                candidate
            })
            .collect(),
    }
}

fn idle_snapshot(installed: bool) -> ManagedRuntimeStatus {
    ManagedRuntimeStatus {
        installed,
        state: if installed {
            "Stopped"
        } else {
            "Not Installed"
        },
        runtime_id: ENGINE,
        version: ENGINE_VERSION,
        epoch: registry().idle_epoch.clone(),
        deployment_id: None,
        deployment_identity_hash: None,
        model_digest: None,
        process_id: None,
        port: None,
        error: None,
        actual_execution: None,
        requested_backend: None,
        selected_backend: None,
        requested_gpu_layers: None,
        selected_gpu_layers: None,
        selected_device_id: None,
        fallback_used: false,
        fallback_authorized: false,
        fallback_reason: None,
        gpu_free_before_bytes: None,
        gpu_free_after_bytes: None,
        cuda_process_vram_bytes: None,
        gpu_estimated_required_bytes: None,
        recovery_state: "none",
        failure_kind: None,
        inference_route_issued: false,
        requested_execution: None,
        selected_candidate_index: None,
        candidate_evaluations: Vec::new(),
    }
}

fn idle_snapshot_for(binding: &BoundDeployment, installed: bool) -> ManagedRuntimeStatus {
    let mut status = idle_snapshot(installed);
    status.deployment_id = Some(binding.id.clone());
    status.deployment_identity_hash = Some(format!(
        "sha256:{:x}",
        Sha256::digest(binding.identity.as_bytes())
    ));
    status.model_digest = Some(binding.digest.clone());
    status
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

async fn managed_local_runtime_status_observe(
    app: AppHandle,
    deployment_id: Option<String>,
    deployment_identity: Option<String>,
) -> Result<ManagedRuntimeStatus, String> {
    let requested = match (deployment_id.as_deref(), deployment_identity.as_deref()) {
        (Some(id), Some(identity)) => {
            // A scoped status must be for a registered, native-canonical
            // deployment, never an arbitrary renderer-named slot. Observing
            // 65 distinct registered models must not allocate 65 owner slots.
            Some(current_binding(&app, id, identity)?)
        }
        (None, None) => None,
        _ => return Err("Managed runtime status requires an exact selector pair".into()),
    };
    let slot = select_owner(deployment_id.as_deref(), deployment_identity.as_deref())?;
    let approved_installed = match requested.as_ref() {
        Some(binding) if binding.requested_backend == "cuda" => {
            verified_cuda_engine_status(&app)
                || (binding.cpu_fallback_allowed && verified_engine(&app).is_ok())
        }
        Some(_) => verified_engine(&app).is_ok(),
        None => verified_engine(&app).is_ok() || verified_cuda_engine_status(&app),
    };
    let Some(slot) = slot else {
        return Ok(match requested.as_ref() {
            Some(binding) => idle_snapshot_for(binding, approved_installed),
            None => idle_snapshot(approved_installed),
        });
    };
    let health = {
        let mut owner = slot.lock().map_err(|_| "Runtime state poisoned")?;
        reap_crash(&mut owner);
        #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
        let installed = (owner.child.is_none() && owner.state != "Failed" && approved_installed)
            || verified_selected_engine(&app, owner.selected_backend)
            || acceptance_synthetic_installed(&app, &owner);
        #[cfg(not(all(windows, feature = "lm11-authenticated-webview-acceptance")))]
        let installed = (owner.child.is_none() && owner.state != "Failed" && approved_installed)
            || verified_selected_engine(&app, owner.selected_backend);
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
        let mut owner = slot.lock().map_err(|_| "Runtime state poisoned")?;
        reap_crash(&mut owner);
        if owner.epoch == epoch && owner.child.is_some() {
            match probe {
                Ok(Some(true)) if owner.selected_backend == "cuda" => {
                    let proof = owner.logs.lock().ok().and_then(|logs| {
                        observed_cuda_offload(&logs, owner.cuda_model.as_deref().unwrap_or(""))
                    });
                    if let Some(layers) = proof {
                        owner.cuda_offloaded_layers = Some(layers);
                        owner.gpu_free_after_bytes = owner
                            .selected_device_id
                            .as_deref()
                            .and_then(|id| {
                                crate::modules::hardware_profile::cuda_device_for_request(id).ok()
                            })
                            .and_then(|gpu| gpu.available_vram_bytes.map(|free| free.value));
                        owner.state = "Ready";
                    } else if owner
                        .started_at
                        .is_some_and(|t| t.elapsed() > START_TIMEOUT)
                    {
                        fail_or_stage_cuda_recovery(&mut owner,
                            "CUDA runtime became healthy but NVIDIA initialization/positive GPU layer offload was not verified".into(),true);
                    } else {
                        owner.state = "Loading";
                    }
                }
                Ok(Some(true)) => owner.state = "Ready",
                Ok(Some(false)) => owner.state = "Loading",
                _ if owner.state == "Ready" => {
                    fail_or_stage_cuda_recovery(
                        &mut owner,
                        "Managed runtime lost authenticated health".into(),
                        false,
                    );
                }
                _ if owner
                    .started_at
                    .is_some_and(|time| time.elapsed() > START_TIMEOUT) =>
                {
                    fail_or_stage_cuda_recovery(
                        &mut owner,
                        "Managed runtime startup/metadata timeout".into(),
                        true,
                    )
                }
                _ => owner.state = "Starting",
            }
        }
        #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
        let installed = verified_selected_engine(&app, owner.selected_backend)
            || acceptance_synthetic_installed(&app, &owner);
        #[cfg(not(all(windows, feature = "lm11-authenticated-webview-acceptance")))]
        let installed = verified_selected_engine(&app, owner.selected_backend);
        return Ok(snapshot(&owner, installed));
    }
    let owner = slot.lock().map_err(|_| "Runtime state poisoned")?;
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    let installed = (owner.child.is_none() && owner.state != "Failed" && approved_installed)
        || verified_selected_engine(&app, owner.selected_backend)
        || acceptance_synthetic_installed(&app, &owner);
    #[cfg(not(all(windows, feature = "lm11-authenticated-webview-acceptance")))]
    let installed = (owner.child.is_none() && owner.state != "Failed" && approved_installed)
        || verified_selected_engine(&app, owner.selected_backend);
    Ok(snapshot(&owner, installed))
}

/// One health observation may retire a real failed CUDA child, invalidate its
/// route/credential/epoch and then launch a verified CPU variant. The existing
/// native owner registry is the sole process authority for both attempts.
#[tauri::command]
pub async fn managed_local_runtime_status(
    app: AppHandle,
    deployment_id: Option<String>,
    deployment_identity: Option<String>,
) -> Result<ManagedRuntimeStatus, String> {
    let initial = managed_local_runtime_status_observe(
        app.clone(),
        deployment_id.clone(),
        deployment_identity.clone(),
    )
    .await?;
    if initial.state != "Recovering" {
        return Ok(initial);
    }
    let (Some(id), Some(identity)) = (deployment_id.as_deref(), deployment_identity.as_deref())
    else {
        // Unscoped legacy status never chooses a recovery target implicitly.
        return Ok(initial);
    };
    if let Err(error) = recover_failed_cuda_startup(app.clone(), id, identity) {
        // Do not retain the recovery ticket after a failed CPU attempt. Manual
        // retry must use a fresh, explicit native start, never spin on polling.
        if let Ok(Some(slot)) = select_owner(Some(id), Some(identity)) {
            if let Ok(mut owner) = slot.lock() {
                if owner.pending_cpu_recovery.is_some() && owner.child.is_none() {
                    forget_process(
                        &mut owner,
                        "Failed",
                        Some(format!("CUDA startup recovery failed closed: {error}")),
                    );
                    owner.failure_kind = Some("cpu-recovery-failed");
                }
            }
        }
    }
    managed_local_runtime_status_observe(app, deployment_id, deployment_identity).await
}

fn recover_failed_cuda_startup(
    app: AppHandle,
    deployment_id: &str,
    identity: &str,
) -> Result<(), String> {
    let slot = select_owner(Some(deployment_id), Some(identity))?
        .ok_or("Native CUDA recovery owner missing")?;
    let ticket = {
        let owner = slot.lock().map_err(|_| "Native recovery owner poisoned")?;
        if owner.state != "Recovering" || owner.child.is_some() {
            return Err("CUDA recovery was cancelled or altered".into());
        }
        owner
            .pending_cpu_recovery
            .clone()
            .ok_or("No native CPU recovery ticket")?
    };
    let current = current_binding(&app, deployment_id, identity)?;
    if current != ticket.binding {
        return Err("Managed deployment changed after CUDA startup failure".into());
    }
    start_bound_runtime(app, current, Some(ticket))?;
    Ok(())
}

#[tauri::command]
pub fn managed_local_runtime_start(
    app: AppHandle,
    deployment_id: String,
    deployment_identity: String,
) -> Result<ManagedRuntimeStatus, String> {
    let binding = current_binding(&app, &deployment_id, &deployment_identity)?;
    start_bound_runtime(app, binding, None)
}

fn start_bound_runtime(
    app: AppHandle,
    binding: BoundDeployment,
    recovery: Option<StartupRecoveryTicket>,
) -> Result<ManagedRuntimeStatus, String> {
    let _switch_guard = if binding.persisted_policy.is_some() {
        Some(
            POLICY_SWITCH_FENCE
                .lock()
                .map_err(|_| "Native policy transition unavailable")?,
        )
    } else {
        None
    };
    let model = model_path(&app, &binding.digest)?;
    let inspected = inspect(&model)?;
    if inspected.digest != binding.digest {
        return Err("Imported GGUF file is missing or was modified".into());
    }
    let mut selected_backend = "cpu";
    let mut selected_device = None;
    let mut gpu_free_before = None;
    let mut cuda_model = None;
    let mut fallback_reason = None;
    let mut gpu_layers = 0;
    let mut gpu_estimated_required = None;
    let mut candidate_evaluations = Vec::new();
    let mut selected_candidate_index = None;
    let mut measured_host_available = None;
    let mut estimated_host_required = None;
    let binary = if binding.persisted_policy.is_some() {
        if let Some(ticket) = recovery.as_ref() {
            if ticket.binding != binding
                || !binding.cpu_fallback_allowed
                || ticket.failed_candidate_index.is_none()
            {
                return Err("Persisted post-spawn recovery identity or ordering mismatch".into());
            }
        }
        let plan = resolve_persisted_launch(
            &app,
            &binding,
            inspected.size,
            inspected.block_count,
            recovery
                .as_ref()
                .and_then(|ticket| ticket.failed_candidate_index),
        )?;
        if recovery.is_some() && plan.backend != "cpu" {
            return Err("Post-spawn recovery must independently launch verified CPU".into());
        }
        selected_backend = plan.backend;
        selected_device = plan.device;
        gpu_layers = plan.gpu_layers;
        cuda_model = plan.cuda_model;
        gpu_free_before = plan.gpu_free;
        gpu_estimated_required = plan.gpu_estimate;
        measured_host_available = plan.host_free;
        estimated_host_required = plan.host_estimate;
        selected_candidate_index = Some(plan.selected_index);
        candidate_evaluations = plan.candidates;
        fallback_reason = if let Some(ticket) = recovery.as_ref() {
            Some(format!(
                "CUDA post-spawn {}: {}",
                ticket.failure_kind, ticket.cuda_failure_reason
            ))
        } else {
            plan.reason
        };
        plan.binary
    } else if let Some(ticket) = recovery.as_ref() {
        if ticket.binding != binding
            || !binding.cpu_fallback_allowed
            || binding.requested_backend != "cuda"
        {
            return Err("Native post-spawn CPU recovery policy or identity mismatch".into());
        }
        let (cpu_binary, rejected_reason) = authorized_cuda_cpu_fallback(
            binding.cpu_fallback_allowed,
            ticket.cuda_failure_reason.clone(),
            || verified_admissible_fallback_cpu(&app, inspected.size, binding.context),
        )?;
        fallback_reason = Some(format!(
            "CUDA post-spawn {}: {rejected_reason}",
            ticket.failure_kind
        ));
        cpu_binary
    } else if binding.requested_backend == "cuda" {
        let admission = (|| -> Result<(PathBuf, String, String, u64, u64), String> {
            let device_id = binding
                .device_id
                .as_deref()
                .ok_or("CUDA request has no exact device")?;
            let gpu = crate::modules::hardware_profile::cuda_device_for_request(device_id)?;
            let total = gpu.total_vram_bytes.as_ref().map(|v| v.value);
            let free = gpu.available_vram_bytes.as_ref().map(|v| v.value);
            let estimated = cuda_memory_admission(
                inspected.size,
                binding.context,
                binding.gpu_layers,
                inspected.block_count,
                total,
                free,
            )?;
            let free = free.ok_or("CUDA available VRAM is UNKNOWN")?;
            let model_name = gpu
                .model
                .map(|value| value.value)
                .ok_or("Selected NVIDIA GPU model identity is UNKNOWN")?;
            let binary = verified_cuda_engine(&app)?;
            Ok((binary, device_id.to_owned(), model_name, free, estimated))
        })();
        match admission {
            Ok((cuda_binary, device, model, free, estimated)) => {
                selected_backend = "cuda";
                selected_device = Some(device);
                gpu_free_before = Some(free);
                cuda_model = Some(model);
                gpu_layers = binding.gpu_layers;
                gpu_estimated_required = Some(estimated);
                cuda_binary
            }
            Err(reason) => {
                let (cpu_binary, rejected_reason) =
                    authorized_cuda_cpu_fallback(binding.cpu_fallback_allowed, reason, || {
                        verified_admissible_fallback_cpu(&app, inspected.size, binding.context)
                    })?;
                fallback_reason = Some(rejected_reason);
                cpu_binary
            }
        }
    } else {
        verified_engine(&app)?
    };
    if recovery.is_none() {
        retire_prior_persisted_policy_owner(&binding)?;
    }
    let key = runtime_key(&binding);
    let slot = get_or_insert_owner(key.clone())?;
    {
        let mut current = slot.lock().map_err(|_| "Runtime state poisoned")?;
        reap_crash(&mut current);
        if !recovery_matches_owner(&current, recovery.as_ref()) {
            return Err(
                "Managed recovery epoch changed or pending CUDA recovery must complete first"
                    .into(),
            );
        }
        if current.child.is_some() {
            if current.deployment.as_ref().is_some_and(|existing| {
                existing.id == binding.id && existing.identity == binding.identity
            }) {
                return Ok(snapshot(
                    &current,
                    verified_selected_engine(&app, current.selected_backend),
                ));
            }
            return Err("Exact managed runtime owner changed during start".into());
        }
    }
    let _reservation = reserve_child_start(&key)?;
    let mut owner = slot.lock().map_err(|_| "Runtime state poisoned")?;
    if registry().closing.load(Ordering::Acquire) {
        return Err("Managed runtime host is shutting down".into());
    }
    reap_crash(&mut owner);
    if !recovery_matches_owner(&owner, recovery.as_ref()) {
        return Err("Managed recovery was cancelled by stop/start or a newer epoch".into());
    }
    if owner.child.is_some() {
        return Err("Exact managed deployment started under another reservation".into());
    }
    let random_key = random_hex()?;
    let epoch = random_hex()?;
    let alias = format!("clack-{}", &binding.digest[7..23]);
    let (port, reserved_port) = reserve_fresh_loopback_port(owner.last_port)?;
    let mut command = Command::new(binary);
    // Never inject parent process secrets, credentials, proxies or untrusted
    // LLAMA_ARG_* defaults into the engine process. Both release variants
    // have their full verified dependencies alongside the executable.
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
        if selected_backend == "cuda" {
            let uuid = selected_device
                .as_deref()
                .and_then(|id| id.strip_prefix("clack-this-pc:accelerator:"))
                .ok_or("CUDA device UUID is invalid")?;
            // NVIDIA's official CUDA UUID selector scopes the runtime to the
            // one verified GPU; llama.cpp then observes it as CUDA0.
            command.env("CUDA_VISIBLE_DEVICES", uuid);
        }
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
        .current_dir(if selected_backend == "cuda" {
            cuda_engine_dir(&app)?
        } else {
            engine_dir(&app)?
        })
        .arg("--model")
        .arg(&model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--ctx-size")
        .arg(binding.context.to_string())
        .arg("--n-gpu-layers")
        .arg(gpu_layers.to_string())
        .arg("--alias")
        .arg(&alias)
        .arg("--api-key-file")
        .arg(secret_file.path())
        .arg("--offline")
        .arg("--no-webui")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Consume the same persisted v3 CPU thread preference admitted above.
    // Legacy v1/v2 launches retain their upstream defaults.
    if let Some(threads) = binding
        .persisted_policy
        .as_ref()
        .and_then(|p| p.cpu_threads)
    {
        command.arg("--threads").arg(threads.to_string());
    }
    if selected_backend == "cpu" {
        command.arg("--log-disable");
    }
    if selected_backend == "cuda" {
        // b12248 defaults can suppress LLAMA_LOG_INFO model/offload records.
        // Set the upstream-documented informational/debug threshold so Ready
        // can be grounded in the native `offloaded N/N layers to GPU` record.
        // The stdout/stderr capture is still bounded and never sent to the UI.
        command
            .arg("--device")
            .arg("CUDA0")
            .arg("--log-verbosity")
            .arg("4");
    }
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
    owner.port_reservation = Some(reserved_port);
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
    owner.selected_backend = selected_backend;
    owner.selected_device_id = selected_device;
    owner.selected_gpu_layers = gpu_layers;
    owner.cuda_offloaded_layers = None;
    owner.cuda_model = cuda_model;
    owner.gpu_free_before_bytes = gpu_free_before;
    owner.gpu_free_after_bytes = None;
    owner.gpu_estimated_required_bytes = gpu_estimated_required;
    owner.measured_host_available_bytes = measured_host_available;
    owner.estimated_host_required_bytes = estimated_host_required;
    owner.selected_candidate_index = selected_candidate_index;
    owner.candidate_evaluations = candidate_evaluations;
    owner.fallback_reason = fallback_reason;
    owner.failure_kind = recovery.as_ref().map(|ticket| ticket.failure_kind);
    owner.pending_cpu_recovery = None;
    owner.inference_route_issued = false;
    Ok(snapshot(&owner, true))
}

fn recovery_matches_owner(owner: &RuntimeOwner, ticket: Option<&StartupRecoveryTicket>) -> bool {
    match ticket {
        Some(ticket) => {
            owner.state == "Recovering"
                && owner.child.is_none()
                && owner.epoch == ticket.invalidated_epoch
                && owner.pending_cpu_recovery.as_ref().is_some_and(|pending| {
                    pending.invalidated_epoch == ticket.invalidated_epoch
                        && pending.binding == ticket.binding
                })
        }
        None => owner.pending_cpu_recovery.is_none() && owner.state != "Recovering",
    }
}

#[tauri::command]
pub fn managed_local_runtime_stop(
    app: AppHandle,
    deployment_id: Option<String>,
    deployment_identity: Option<String>,
) -> Result<ManagedRuntimeStatus, String> {
    let slot = select_owner(deployment_id.as_deref(), deployment_identity.as_deref())?;
    let Some(slot) = slot else {
        // Stop is idempotent when no native deployment has ever been owned.
        // An exact unknown selector is different: do not silently target another.
        if deployment_id.is_some() {
            return Err("Exact managed deployment is not owned by this native process".into());
        }
        return Ok(idle_snapshot(
            verified_engine(&app).is_ok() || verified_cuda_engine_status(&app),
        ));
    };
    let mut owner = slot.lock().map_err(|_| "Runtime state poisoned")?;
    // Stop reports the installed *selected variant*, not whether the legacy
    // CPU payload happens to exist. CUDA-only hosts must not claim that a
    // correctly stopped, reaped CUDA child is "Not Installed" CPU.
    let installed = verified_selected_engine(&app, owner.selected_backend);
    owner.state = "Stopping";
    forget_process(&mut owner, "Stopped", None);
    Ok(snapshot(&owner, installed))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeRoute {
    pub base_url: String,
    pub api_key: String,
    pub epoch: String,
    pub model_alias: String,
    pub process_id: u32,
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
    let witnessed = managed_local_runtime_status(
        app.clone(),
        Some(deployment_id.clone()),
        Some(deployment_identity.clone()),
    )
    .await?;
    if witnessed.state != "Ready" {
        return Err("Managed runtime has no current authenticated Ready observation".into());
    }
    if witnessed.actual_execution.as_ref().is_none_or(|actual| {
        actual.backend != witnessed.selected_backend.unwrap_or("unknown")
            || (actual.backend == "cuda" && actual.gpu_layers == 0)
    }) {
        return Err(
            "Managed runtime has no verified actual CPU/CUDA backend execution evidence".into(),
        );
    }
    let slot = select_owner(Some(&deployment_id), Some(&deployment_identity))?
        .ok_or("Exact managed deployment has no native process owner")?;
    let mut owner = slot.lock().map_err(|_| "Runtime state poisoned")?;
    reap_crash(&mut owner);
    if registry().closing.load(Ordering::Acquire)
        || owner.state != "Ready"
        || owner.deployment.as_ref().is_none_or(|loaded| {
            loaded.id != current.id
                || loaded.identity != current.identity
                || loaded.digest != current.digest
        })
        || owner.epoch.is_empty()
        || witnessed.epoch != owner.epoch
        || witnessed.process_id != owner.child.as_ref().map(Child::id)
        || epoch.as_ref().is_some_and(|e| *e != owner.epoch)
    {
        return Err("Exact managed deployment is not ready; no Ollama fallback".into());
    }
    // The renderer receives the authenticated transport authority after this
    // point. It can dispatch bytes without another native callback; therefore
    // route issuance is the conservative irreversible dispatch barrier. Never
    // auto-replay or transparently fail over once it has happened.
    owner.inference_route_issued = true;
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
    let registry = registry();
    registry.closing.store(true, Ordering::Release);
    // Snapshot only Arc handles under the map lock; process kill/wait and job
    // teardown hold each deployment's own lock and never block sibling lookup.
    let slots = registry
        .entries
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .owners
        .values()
        .cloned()
        .collect::<Vec<_>>();
    for slot in slots {
        let mut owner = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        forget_process(&mut owner, "Stopped", None);
    }
    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    if let Ok(mut pending) = registry.pending_synthetic_key.lock() {
        *pending = None;
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
    fn bounded_gguf_scalar_geometry_has_exact_header_provenance() {
        let mut bytes = small_gguf();
        // Expand the tiny synthetic GGUF's metadata count without changing
        // its header. No real model runtime or external provider is invoked.
        bytes[16..24].copy_from_slice(&8u64.to_le_bytes());
        for (key, value) in [
            ("llama.block_count", 24u64),
            ("llama.embedding_length", 896),
            ("llama.attention.head_count", 14),
            ("llama.attention.head_count_kv", 2),
            ("llama.attention.key_length", 64),
            ("llama.attention.value_length", 64),
            ("llama.context_length", 32_768),
        ] {
            bytes.extend_from_slice(&(key.len() as u64).to_le_bytes());
            bytes.extend_from_slice(key.as_bytes());
            bytes.extend_from_slice(&10u32.to_le_bytes()); // GGUF uint64
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("metadata.gguf");
        fs::write(&file, bytes).unwrap();
        let data = inspect(&file).unwrap();
        assert_eq!(data.family.as_deref(), Some("llama"));
        assert_eq!(data.block_count, Some(24));
        assert_eq!(data.embedding_length, Some(896));
        assert_eq!(data.attention_head_count, Some(14));
        assert_eq!(data.attention_head_count_kv, Some(2));
        assert_eq!(data.attention_key_length, Some(64));
        assert_eq!(data.attention_value_length, Some(64));
        assert_eq!(data.declared_context, Some(32_768));
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
        let mut active = RuntimeOwner {
            state: "Ready",
            ..RuntimeOwner::default()
        };
        active.epoch = "old-process-epoch".into();
        active.port = Some(55123);
        active.key = Some("secret".into());
        active.alias = Some("clack-model".into());
        active.deployment = Some(BoundDeployment {
            id: "one".into(),
            identity: "bound".into(),
            digest: format!("sha256:{}", "a".repeat(64)),
            context: 4096,
            requested_backend: "cpu".into(),
            device_id: None,
            gpu_layers: 0,
            cpu_fallback_allowed: false,
            persisted_policy: None,
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

    fn bound_for_owner(id: &str, identity: &str) -> BoundDeployment {
        BoundDeployment {
            id: id.into(),
            identity: identity.into(),
            digest: format!("sha256:{}", "a".repeat(64)),
            context: 4096,
            requested_backend: "cpu".into(),
            device_id: None,
            gpu_layers: 0,
            cpu_fallback_allowed: false,
            persisted_policy: None,
        }
    }

    #[test]
    fn keyed_registry_reuses_only_the_exact_native_identity_and_bounds_slots() {
        let mut entries = RuntimeRegistryEntries::default();
        let a = ("deployment-A".into(), "identity-A".into());
        let a2 = ("deployment-A".into(), "identity-A2".into());
        let b = ("deployment-B".into(), "identity-B".into());
        let first = get_or_insert_owner_in(&mut entries, a.clone()).unwrap();
        let repeated = get_or_insert_owner_in(&mut entries, a).unwrap();
        let changed = get_or_insert_owner_in(&mut entries, a2).unwrap();
        let sibling = get_or_insert_owner_in(&mut entries, b).unwrap();
        assert!(Arc::ptr_eq(&first, &repeated));
        assert!(!Arc::ptr_eq(&first, &changed));
        assert!(!Arc::ptr_eq(&first, &sibling));
        assert_eq!(entries.owners.len(), 3);
        for n in 3..MAX_MANAGED_OWNER_SLOTS {
            get_or_insert_owner_in(&mut entries, (format!("d-{n}"), format!("i-{n}"))).unwrap();
        }
        assert_eq!(entries.owners.len(), MAX_MANAGED_OWNER_SLOTS);
        assert!(get_or_insert_owner_in(&mut entries, ("extra".into(), "exact".into())).is_err());
    }

    #[test]
    fn scoped_status_lookup_is_pure_and_unscoped_ambiguity_fails_closed() {
        let mut entries = RuntimeRegistryEntries::default();
        for n in 0..70 {
            assert!(select_owner_from_entries(
                &entries,
                Some(&format!("deployment-{n}")),
                Some("valid-identity")
            )
            .unwrap()
            .is_none());
        }
        assert!(entries.owners.is_empty()); // Reading 70 registered owners allocates ZERO slots.
        assert!(select_owner_from_entries(&entries, None, None)
            .unwrap()
            .is_none());
        let key_a = ("deployment-A".into(), "identity-A".into());
        let key_b = ("deployment-B".into(), "identity-B".into());
        let a = get_or_insert_owner_in(&mut entries, key_a.clone()).unwrap();
        assert!(Arc::ptr_eq(
            &select_owner_from_entries(&entries, None, None)
                .unwrap()
                .unwrap(),
            &a
        ));
        get_or_insert_owner_in(&mut entries, key_b).unwrap();
        assert!(select_owner_from_entries(&entries, None, None).is_err());
        assert!(select_owner_from_entries(&entries, Some("deployment-A"), None).is_err());
        assert!(select_owner_from_entries(&entries, None, Some("identity-A")).is_err());
        assert!(
            select_owner_from_entries(&entries, Some("deployment-A"), Some("identity-wrong"))
                .unwrap()
                .is_none()
        );
        assert!(Arc::ptr_eq(
            &select_owner_from_entries(&entries, Some(&key_a.0), Some(&key_a.1))
                .unwrap()
                .unwrap(),
            &a
        ));
    }

    #[test]
    fn launch_reservations_deny_same_deployment_old_identity_but_allow_siblings() {
        let mut entries = RuntimeRegistryEntries::default();
        let a = ("deployment-A".into(), "revision-1".into());
        let a2 = ("deployment-A".into(), "revision-2".into());
        let b = ("deployment-B".into(), "revision-1".into());
        let c = ("deployment-C".into(), "revision-1".into());
        for key in [&a, &a2, &b, &c] {
            get_or_insert_owner_in(&mut entries, key.clone()).unwrap();
        }
        entries.starting.insert(a.clone());
        assert!(check_child_start_capacity(&entries, &a).is_err());
        assert!(check_child_start_capacity(&entries, &a2).is_err());
        assert!(check_child_start_capacity(&entries, &b).is_ok());
        assert!(check_child_start_capacity(&entries, &c).is_ok());
        entries.starting.insert(b.clone());
        entries.starting.insert(c.clone());
        assert!(check_child_start_capacity(&entries, &a2).is_err());
        entries.starting.remove(&a);
        assert!(check_child_start_capacity(&entries, &a2).is_ok());
        for n in 0..(MAX_LIVE_MANAGED_CHILDREN - 2) {
            let key = (format!("extra-{n}"), format!("identity-{n}"));
            get_or_insert_owner_in(&mut entries, key.clone()).unwrap();
            entries.starting.insert(key);
        }
        assert!(check_child_start_capacity(&entries, &a2).is_err());
    }

    #[test]
    fn loopback_ports_are_uniquely_reserved_and_reusable_after_owner_release() {
        let mut entries = RuntimeRegistryEntries::default();
        assert!(!claim_port(&mut entries, 0));
        assert!(claim_port(&mut entries, 61001));
        assert!(!claim_port(&mut entries, 61001));
        assert!(claim_port(&mut entries, 61002));
        assert_eq!(entries.reserved_ports.len(), 2);
        assert!(entries.reserved_ports.remove(&61001));
        assert!(claim_port(&mut entries, 61001));
        assert_eq!(entries.reserved_ports.len(), 2);
    }

    #[test]
    fn stopping_one_owner_rotates_only_its_epoch_and_forgets_only_its_credential() {
        let mut a = RuntimeOwner::default();
        let mut b = RuntimeOwner::default();
        let mut c = RuntimeOwner::default();
        for (owner, id) in [(&mut a, "A"), (&mut b, "B"), (&mut c, "C")] {
            owner.deployment = Some(bound_for_owner(id, "identity-1"));
            owner.epoch = format!("epoch-{id}");
            owner.key = Some(format!("secret-{id}"));
            owner.port = Some(61001);
            owner.state = "Ready";
        }
        forget_process(&mut a, "Stopped", None);
        assert_eq!(a.state, "Stopped");
        assert!(a.deployment.is_none() && a.key.is_none() && a.port.is_none());
        assert_ne!(a.epoch, "epoch-A");
        assert_eq!(b.epoch, "epoch-B");
        assert_eq!(c.epoch, "epoch-C");
        assert_eq!(b.key.as_deref(), Some("secret-B"));
        assert_eq!(c.key.as_deref(), Some("secret-C"));
        assert_eq!(b.deployment.as_ref().map(|x| x.id.as_str()), Some("B"));
        assert_eq!(c.deployment.as_ref().map(|x| x.id.as_str()), Some("C"));
    }

    #[test]
    fn scoped_status_exposes_identity_digest_but_no_bearer_or_secret_path() {
        let binding = bound_for_owner("deployment-A", "revision-2");
        let status = idle_snapshot_for(&binding, true);
        let serialized = serde_json::to_value(&status).unwrap();
        assert_eq!(serialized["runtimeId"], ENGINE);
        assert_eq!(serialized["deploymentId"], "deployment-A");
        assert_eq!(serialized["modelDigest"], binding.digest);
        assert_eq!(
            serialized["deploymentIdentityHash"],
            format!("sha256:{:x}", Sha256::digest(b"revision-2"))
        );
        assert_eq!(serialized["state"], "Stopped");
        assert!(
            serialized["actualExecution"].is_null(),
            "An idle runtime cannot claim actual CPU or CUDA execution"
        );
        assert!(serialized.get("apiKey").is_none());
        assert!(serialized.get("credentialFingerprint").is_none());
        assert!(serialized.get("secretFile").is_none());
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
        let mut altered = state.clone();
        altered["fabric"]["deployments"][0]["requestedExecution"] = json!({
            "backend":"cuda", "gpuLayers":40,
            "fallback":{"policy":"disabled"}
        });
        assert!(
            validate_binding(&altered, &deployment_id, &identity).is_err(),
            "The CPU-only native launcher must reject explicit backend requests"
        );
    }

    #[test]
    fn cuda_v2_identity_is_native_exact_and_legacy_cpu_remains_unchanged() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let artifact = json!(["digest", digest]).to_string();
        let device = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
        let config = r#"{"version":2,"context":2048,"tool":false,"grammar":false}"#;
        let id = json!(["managed-gguf-cuda", digest, config, 40, device, "disabled"]).to_string();
        let request = json!({"backend":"cuda","deviceIds":[device],"gpuLayers":40,
            "contextLength":2048,"fallback":{"policy":"disabled"}});
        let deployment = json!({"id":id,"hostId":"clack-this-pc","runtimeId":ENGINE,
            "artifactId":artifact,"runtimeModelName":format!("managed-gguf:{digest}"),
            "configurationRevision":1,"configurationIdentity":config,
            "variantId":"b12248/cuda","requestedExecution":request});
        let state = json!({"fabric":{"version":1,
            "hosts":[{"id":"clack-this-pc","enabled":true,"location":"local","runtimeIds":[ENGINE]}],
            "runtimes":[{"id":ENGINE,"hostId":"clack-this-pc","type":ENGINE,
                "enabled":true,"configurationRevision":1,"version":ENGINE_VERSION}],
            "artifacts":[{"id":artifact,"format":"gguf","digest":digest}],
            "deployments":[deployment]}});
        // The eighth JSON-array entry follows TypeScript's *schema* field order
        // (not serde_json's object-key order).
        let request_canonical = format!(
            r#"{{"backend":"cuda","deviceIds":[{}],"gpuLayers":40,"contextLength":2048,"fallback":{{"policy":"disabled"}}}}"#,
            json!(device)
        );
        let identity = format!(
            "{},{}]",
            json!([
                "clack-this-pc",
                ENGINE,
                artifact,
                format!("managed-gguf:{digest}"),
                1,
                "b12248/cuda",
                config
            ])
            .to_string()
            .trim_end_matches(']'),
            request_canonical
        );
        let binding = validate_binding(&state, &id, &identity).expect("canonical CUDA deployment");
        assert_eq!(binding.requested_backend, "cuda");
        assert_eq!(binding.device_id.as_deref(), Some(device));
        assert_eq!(binding.gpu_layers, 40);
        assert!(!binding.cpu_fallback_allowed);
        let mut altered = state.clone();
        altered["fabric"]["deployments"][0]["requestedExecution"]["gpuLayers"] = json!(0);
        assert!(validate_binding(&altered, &id, &identity).is_err());
        let mut altered = state.clone();
        altered["fabric"]["deployments"][0]["requestedExecution"]["fallback"]["policy"] =
            json!("allow-compatible");
        assert!(validate_binding(&altered, &id, &identity).is_err());
        let mut altered = state.clone();
        altered["fabric"]["deployments"][0]["requestedExecution"]["deviceIds"] =
            json!(["GPU-arbitrary"]);
        assert!(validate_binding(&altered, &id, &identity).is_err());
        assert!(validate_binding(&state, &id, "fabricated-cuda-identity").is_err());
    }

    #[test]
    fn persisted_v3_policy_identity_and_backend_order_are_native_authoritative() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let artifact = json!(["digest", digest]).to_string();
        let device = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
        let config = r#"{"version":3,"context":2048,"tool":false,"grammar":false}"#;
        let request_json = format!(
            r#"{{"backend":"cuda","deviceIds":[{}],"gpuLayers":40,"contextLength":2048,"fallback":{{"policy":"explicit-order","order":["cpu"]}},"candidates":[{{"backend":"cuda","deviceIds":[{}],"gpuLayers":40,"runtimeVariantId":"b12248/cuda"}},{{"backend":"cpu","deviceIds":["clack-this-pc:cpu:0"],"gpuLayers":0,"runtimeVariantId":"b12248/cpu"}}],"memoryBudget":{{"maxDeviceBytes":8589934592,"maxHostBytes":8589934592,"reserveDeviceBytes":134217728,"reserveHostBytes":134217728}},"deviceStrategy":{{"kind":"single","primaryDeviceId":{},"splitStrategy":"none"}}}}"#,
            json!(device),
            json!(device),
            json!(device)
        );
        let request: Value = serde_json::from_str(&request_json).unwrap();
        let parsed = parse_v3_policy(&request, 2048).unwrap();
        assert_eq!(
            serde_json::to_string(&parsed).unwrap(),
            request_json,
            "Native serde order must equal canonical Fabric JSON.stringify"
        );
        assert_eq!(
            parsed
                .candidates
                .as_ref()
                .unwrap()
                .iter()
                .map(|c| c.backend.as_str())
                .collect::<Vec<_>>(),
            vec!["cuda", "cpu"]
        );
        let id = format!(
            "{},{}]",
            json!(["managed-gguf-policy-v3", digest, config])
                .to_string()
                .trim_end_matches(']'),
            request_json
        );
        let identity = format!(
            "{},{}]",
            json!([
                "clack-this-pc",
                ENGINE,
                artifact,
                format!("managed-gguf:{digest}"),
                1,
                Value::Null,
                config
            ])
            .to_string()
            .trim_end_matches(']'),
            request_json
        );
        let deployment = json!({"id":id,"hostId":"clack-this-pc","runtimeId":ENGINE,
            "artifactId":artifact,"runtimeModelName":format!("managed-gguf:{digest}"),
            "configurationRevision":1,"configurationIdentity":config,
            "requestedExecution":request});
        let state = json!({"fabric":{"version":1,
            "hosts":[{"id":"clack-this-pc","enabled":true,"location":"local","runtimeIds":[ENGINE]}],
            "runtimes":[{"id":ENGINE,"hostId":"clack-this-pc","type":ENGINE,
                "enabled":true,"configurationRevision":1,"version":ENGINE_VERSION}],
            "artifacts":[{"id":artifact,"format":"gguf","digest":digest}],
            "deployments":[deployment]}});
        let binding = validate_binding(&state, &id, &identity).unwrap();
        assert_eq!(binding.requested_backend, "cuda");
        assert!(binding.cpu_fallback_allowed);
        assert!(binding.persisted_policy.is_some());
        let mut swapped = state.clone();
        swapped["fabric"]["deployments"][0]["requestedExecution"]["candidates"][0]["backend"] =
            json!("cpu");
        assert!(validate_binding(&swapped, &id, &identity).is_err());
        let mut changed_budget = state.clone();
        changed_budget["fabric"]["deployments"][0]["requestedExecution"]["memoryBudget"]
            ["maxDeviceBytes"] = json!(1);
        assert!(
            validate_binding(&changed_budget, &id, &identity).is_err(),
            "Policy changes must produce a fresh deployment identity"
        );
        assert!(validate_binding(&state, &id, "old-cuda-policy-identity").is_err());
    }

    #[test]
    fn persisted_unknown_backends_and_same_vendor_multi_device_are_representable_not_executable() {
        let device_a = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
        let device_b = "clack-this-pc:accelerator:GPU-18c1cf52-2ec1-4a2a-a011-77ddccaa99ee";
        let request = json!({"backend":"vulkan","deviceIds":[device_a,device_b],
            "gpuLayers":20,"contextLength":2048,
            "fallback":{"policy":"explicit-order","order":["cuda","cpu"]},
            "candidates":[
                {"backend":"vulkan","deviceIds":[device_a,device_b],"gpuLayers":20},
                {"backend":"cuda","deviceIds":[device_b],"gpuLayers":20,"runtimeVariantId":"b12248/cuda"},
                {"backend":"cpu","deviceIds":["clack-this-pc:cpu:0"],"gpuLayers":0}
            ],"deviceStrategy":{"kind":"multi","primaryDeviceId":device_a,"splitStrategy":"layers"}});
        let parsed = parse_v3_policy(&request, 2048).unwrap();
        assert_eq!(
            parsed.candidates.as_ref().unwrap()[0].device_ids,
            vec![device_a, device_b]
        );
        assert_eq!(
            parsed.candidates.as_ref().unwrap()[1].device_ids,
            vec![device_b]
        );
        assert_eq!(parsed.device_strategy.as_ref().unwrap().kind, "multi");
        let mut duplicated = request.clone();
        duplicated["candidates"][0]["deviceIds"] = json!([device_a, device_a]);
        assert!(parse_v3_policy(&duplicated, 2048).is_err());
        let mut incorrect_order = request.clone();
        incorrect_order["fallback"]["order"] = json!(["cpu", "cuda"]);
        assert!(parse_v3_policy(&incorrect_order, 2048).is_err());
        let mut invented_context = request.clone();
        invented_context["contextLength"] = json!(4096);
        assert!(parse_v3_policy(&invented_context, 2048).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn policy_switch_retires_real_previous_v3_child_without_touching_artifact() {
        let policy = parse_v3_policy(
            &json!({
                "backend":"cpu","deviceIds":["clack-this-pc:cpu:0"],"gpuLayers":0,
                "contextLength":2048,"fallback":{"policy":"disabled"},
                "candidates":[{"backend":"cpu","deviceIds":["clack-this-pc:cpu:0"],"gpuLayers":0}]
            }),
            2048,
        )
        .unwrap();
        let digest = format!("sha256:{}", "b".repeat(64));
        let old_key = (
            "slice4-policy-fence-old".to_owned(),
            "old-policy-identity".to_owned(),
        );
        let old = get_or_insert_owner(old_key.clone()).unwrap();
        let child = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command"])
            .arg("Start-Sleep -Seconds 45")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("real owned child");
        let pid = child.id();
        {
            let mut owner = old.lock().unwrap();
            owner.child = Some(child);
            owner.state = "Ready";
            owner.epoch = "stale-before-policy-switch".into();
            owner.port = Some(59334);
            owner.key = Some("ephemeral".into());
            owner.deployment = Some(BoundDeployment {
                id: old_key.0.clone(),
                identity: old_key.1.clone(),
                digest: digest.clone(),
                context: 2048,
                requested_backend: "cpu".into(),
                device_id: None,
                gpu_layers: 0,
                cpu_fallback_allowed: false,
                persisted_policy: Some(policy.clone()),
            });
        }
        let next = BoundDeployment {
            id: "slice4-policy-fence-next".into(),
            identity: "new-policy-identity".into(),
            digest: digest.clone(),
            context: 2048,
            requested_backend: "cpu".into(),
            device_id: None,
            gpu_layers: 0,
            cpu_fallback_allowed: false,
            persisted_policy: Some(policy),
        };
        retire_prior_persisted_policy_owner(&next).unwrap();
        {
            let owner = old.lock().unwrap();
            assert!(owner.child.is_none());
            assert!(owner.deployment.is_none());
            assert!(owner.key.is_none());
            assert!(owner.port.is_none());
            assert_ne!(owner.epoch, "stale-before-policy-switch");
        }
        let process = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command"])
            .arg(format!(
                "if(Get-Process -Id {pid} -ErrorAction SilentlyContinue){{exit 9}}"
            ))
            .status()
            .unwrap();
        assert!(
            process.success(),
            "previous actual child must have been reaped"
        );
        registry().entries.lock().unwrap().owners.remove(&old_key);
    }

    #[test]
    fn cuda_ready_requires_native_init_selected_gpu_and_positive_offload_proof() {
        let log = b"llama_prepare_model_devices: using device CUDA0 (NVIDIA GeForce RTX 5070 Ti) (0000:01:00.0) - 15037 MiB free\nload_tensors: offloaded 25/25 layers to GPU\nload_tensors: CUDA0 model buffer size =   373.73 MiB\n";
        assert_eq!(
            observed_cuda_offload(log, "NVIDIA GeForce RTX 5070 Ti"),
            Some(25)
        );
        assert_eq!(observed_cuda_offload(log, "different GPU"), None);
        assert_eq!(
            observed_cuda_offload(b"llama_model_load: offloaded 25/25 layers to GPU", "RTX"),
            None
        );
        let zero=b"llama_prepare_model_devices: using device CUDA0 (RTX)\nload_tensors: offloaded 0/25 layers to GPU\nload_tensors: CUDA0 model buffer size = 300 MiB\n";
        assert_eq!(observed_cuda_offload(zero, "RTX"), None);
        let excess=b"llama_prepare_model_devices: using device CUDA0 (RTX)\nload_tensors: offloaded 999/25 layers to GPU\nload_tensors: CUDA0 model buffer size = 300 MiB\n";
        assert_eq!(observed_cuda_offload(excess, "RTX"), None);
        let no_gpu_bytes=b"llama_prepare_model_devices: using device CUDA0 (RTX)\nload_tensors: offloaded 25/25 layers to GPU\nload_tensors: CUDA0 model buffer size = 0.00 MiB\n";
        assert_eq!(observed_cuda_offload(no_gpu_bytes, "RTX"), None);
        let idle = snapshot(&RuntimeOwner::default(), true);
        assert!(idle.actual_execution.is_none());
    }

    #[test]
    fn cuda_memory_admission_rejects_unknown_insufficient_and_impossible_claims() {
        const MIB: u64 = 1024 * 1024;
        assert!(
            cuda_memory_admission(500 * MIB, 2048, 40, Some(25), None, Some(14000 * MIB))
                .unwrap_err()
                .contains("total VRAM is UNKNOWN")
        );
        assert!(
            cuda_memory_admission(500 * MIB, 2048, 40, Some(25), Some(16303 * MIB), None)
                .unwrap_err()
                .contains("available VRAM is UNKNOWN")
        );
        assert!(cuda_memory_admission(
            500 * MIB,
            2048,
            40,
            Some(25),
            Some(16303 * MIB),
            Some(50 * MIB)
        )
        .unwrap_err()
        .contains("Insufficient"));
        assert!(cuda_memory_admission(
            500 * MIB,
            2048,
            40,
            Some(25),
            Some(100 * MIB),
            Some(100 * MIB)
        )
        .unwrap_err()
        .contains("Insufficient"));
        assert!(cuda_memory_admission(
            500 * MIB,
            2048,
            40,
            Some(25),
            Some(16303 * MIB),
            Some(16500 * MIB)
        )
        .unwrap_err()
        .contains("exceeds total"));
        assert!(cuda_memory_admission(
            u64::MAX,
            2048,
            40,
            None,
            Some(16303 * MIB),
            Some(14000 * MIB)
        )
        .unwrap_err()
        .contains("overflow"));
        assert!(cuda_memory_admission(
            491400032,
            2048,
            40,
            Some(25),
            Some(16303 * MIB),
            Some(12000 * MIB)
        )
        .is_ok());
        let partial = cuda_memory_admission(
            800 * MIB,
            2048,
            4,
            Some(32),
            Some(16303 * MIB),
            Some(12000 * MIB),
        )
        .unwrap();
        let full = cuda_memory_admission(
            800 * MIB,
            2048,
            33,
            Some(32),
            Some(16303 * MIB),
            Some(12000 * MIB),
        )
        .unwrap();
        assert!(
            partial < full,
            "Requested layers and inspected block count must influence estimates"
        );
        assert!(cuda_memory_admission(
            100 * MIB,
            2048,
            0,
            None,
            Some(16303 * MIB),
            Some(12000 * MIB)
        )
        .is_err());
    }

    #[test]
    fn cuda_fallback_disabled_never_probes_cpu_and_allowed_requires_verified_managed_cpu() {
        let rejected =
            authorized_cuda_cpu_fallback(false, "CUDA dependency missing".into(), || {
                panic!("CPU verification must never run when fallback is disabled");
            })
            .unwrap_err();
        assert!(rejected.contains("fallback disabled"));
        assert!(rejected.contains("CUDA dependency missing"));

        let missing = authorized_cuda_cpu_fallback(true, "Insufficient CUDA VRAM".into(), || {
            Err("Pinned managed CPU executable is unavailable".into())
        })
        .unwrap_err();
        assert!(missing.contains("authorized CPU fallback is unavailable"));
        assert!(missing.contains("Insufficient CUDA VRAM"));

        let owned_binary = PathBuf::from("private-managed-cpu/llama-server.exe");
        let (selected, reason) =
            authorized_cuda_cpu_fallback(true, "CUDA device unavailable".into(), || {
                Ok(owned_binary.clone())
            })
            .expect("explicit policy and verified managed CPU permit fallback");
        assert_eq!(selected, owned_binary);
        assert_eq!(reason, "CUDA device unavailable");
    }

    #[test]
    fn postspawn_policy_denies_ready_cpu_and_route_issued_replays() {
        assert!(can_fallback_after_spawn("cuda", "Starting", false, true));
        assert!(can_fallback_after_spawn("cuda", "Loading", false, true));
        for (backend, state, issued, allowed) in [
            ("cuda", "Starting", false, false),
            ("cuda", "Ready", false, true),
            ("cuda", "Failed", false, true),
            ("cuda", "Loading", true, true),
            ("cpu", "Starting", false, true),
        ] {
            assert!(
                !can_fallback_after_spawn(backend, state, issued, allowed),
                "Never retry a dispatched/Ready request or an unauthorized backend"
            );
        }
        assert_eq!(
            classify_startup_failure(b"failed to bind address already in use", false),
            "port-collision"
        );
        assert_eq!(
            classify_startup_failure(b"LoadLibrary error: cublas64 missing", false),
            "dependency-load-failure"
        );
        assert_eq!(
            classify_startup_failure(b"Loading tensor data", true),
            "ready-timeout"
        );
        assert_eq!(
            classify_startup_failure(b"child died", false),
            "child-exited-before-ready"
        );
    }

    #[cfg(windows)]
    #[test]
    fn real_owned_child_cleanup_rotates_epoch_and_cancels_stale_recovery_ticket() {
        // A genuine OS child, not a fabricated process id or an assigned
        // fallback result. Actual CUDA→CPU inference is tested separately by
        // the isolated native Tauri acceptance application.
        let child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 15",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        let mut owner = RuntimeOwner::default();
        let old_epoch = owner.epoch.clone();
        owner.child = Some(child);
        owner.state = "Starting";
        owner.selected_backend = "cuda";
        owner.port = Some(49151);
        owner.key = Some("ephemeral-native-key".into());
        owner.alias = Some("clack-test".into());
        owner.deployment = Some(BoundDeployment {
            id: "owned-cuda".into(),
            identity: "exact-canonical-binding".into(),
            digest: format!("sha256:{}", "a".repeat(64)),
            context: 2048,
            requested_backend: "cuda".into(),
            device_id: Some("GPU-test".into()),
            gpu_layers: 40,
            cpu_fallback_allowed: true,
            persisted_policy: None,
        });
        fail_or_stage_cuda_recovery(&mut owner, "real CUDA child was reaped".into(), false);
        assert_eq!(owner.state, "Recovering");
        assert!(owner.child.is_none());
        assert!(owner.key.is_none());
        assert!(owner.port.is_none());
        assert_eq!(owner.last_port, Some(49151));
        assert_ne!(owner.epoch, old_epoch);
        assert!(owner.pending_cpu_recovery.is_some());
        let ticket = owner.pending_cpu_recovery.clone().unwrap();
        assert!(recovery_matches_owner(&owner, Some(&ticket)));
        assert!(!recovery_matches_owner(&owner, None));
        let process = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command"])
            .arg(format!(
                "if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 3 }}"
            ))
            .status()
            .unwrap();
        assert!(process.success(), "OS-reaped child must no longer exist");
        forget_process(&mut owner, "Stopped", None);
        assert!(owner.pending_cpu_recovery.is_none());
        assert_ne!(owner.epoch, ticket.invalidated_epoch);
        assert!(
            !recovery_matches_owner(&owner, Some(&ticket)),
            "Explicit stop must cancel any pending CPU recovery"
        );
    }

    #[cfg(windows)]
    #[test]
    fn cuda_payload_verification_rejects_missing_modified_and_extra_dependency() {
        let root = tempfile::tempdir().expect("private scratch runtime");
        let expected = [
            (
                "llama-server.exe",
                4u64,
                format!("{:x}", Sha256::digest(b"main")),
            ),
            (
                "ggml-cuda.dll",
                4u64,
                format!("{:x}", Sha256::digest(b"cuda")),
            ),
        ];
        let manifest: Vec<(&str, u64, &str)> = expected
            .iter()
            .map(|(name, bytes, digest)| (*name, *bytes, digest.as_str()))
            .collect();
        fs::write(root.path().join("llama-server.exe"), b"main").unwrap();
        assert!(verify_payload_dir_expected(root.path(), &manifest)
            .unwrap_err()
            .contains("incomplete"));
        fs::write(root.path().join("ggml-cuda.dll"), b"cuda").unwrap();
        assert!(verify_payload_dir_expected(root.path(), &manifest).is_ok());
        fs::write(root.path().join("ggml-cuda.dll"), b"evil").unwrap();
        assert!(verify_payload_dir_expected(root.path(), &manifest)
            .unwrap_err()
            .contains("failed pinned identity"));
        fs::write(root.path().join("ggml-cuda.dll"), b"cuda").unwrap();
        fs::write(root.path().join("unexpected.dll"), b"other").unwrap();
        assert!(verify_payload_dir_expected(root.path(), &manifest)
            .unwrap_err()
            .contains("Unexpected file"));
    }

    #[test]
    fn unapproved_executable_never_becomes_installed_by_filename() {
        if option_env!("CLACK_MANAGED_LLAMA_BUNDLE_SHA256").is_none() {
            assert!(approved_digest("archive").is_err());
        }
        assert!(!valid_hex("untrusted"));
        assert!(valid_hex(&"a".repeat(64)));
    }

    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    #[test]
    fn authenticated_webview_acceptance_root_is_exact_or_one_direct_case() {
        let fixed = Path::new(r"C:\clack\target\lm11-b01-b03-authenticated-webview-20261119");
        assert!(acceptance_is_direct_owned_webview_root(fixed, fixed));
        assert!(acceptance_is_direct_owned_webview_root(
            fixed,
            &fixed.join("cases").join("case-one")
        ));
        for outside in [
            fixed.join("cases"),
            fixed.join("cases").join("case-one").join("nested"),
            fixed.join("sibling"),
            fixed.with_file_name("lm11-b01-b03-authenticated-webview-20261119-sibling"),
            fixed.join("cases").join("..").join("escaped"),
        ] {
            assert!(!acceptance_is_direct_owned_webview_root(fixed, &outside));
        }
    }

    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    #[test]
    fn authenticated_webview_synthetic_route_requires_bearer_and_digest_alias() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let key = "b".repeat(64);
        let alias = format!("clack-{}", "a".repeat(16));
        assert!(acceptance_valid_synthetic_route(
            1420, &key, &alias, &digest
        ));
        assert!(!acceptance_valid_synthetic_route(0, &key, &alias, &digest));
        assert!(!acceptance_valid_synthetic_route(
            1420,
            "not-a-secret",
            &alias,
            &digest
        ));
        assert!(!acceptance_valid_synthetic_route(
            1420,
            &"B".repeat(64),
            &alias,
            &digest
        ));
        assert!(!acceptance_valid_synthetic_route(
            1420,
            &key,
            "clack-forged",
            &digest
        ));
        assert!(!acceptance_valid_synthetic_route(
            1420,
            &key,
            &alias,
            "sha256:wrong"
        ));
    }

    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    #[test]
    fn authenticated_webview_bind_remains_unverified_until_health() {
        let mut active = RuntimeOwner::default();
        active.state = acceptance_unverified_owner_state();
        assert_eq!(snapshot(&active, true).state, "Starting");
        assert_ne!(active.state, "Ready");
    }

    #[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
    #[test]
    fn authenticated_webview_owner_defaults_closed_and_forget_clears_authority() {
        let mut active = RuntimeOwner::default();
        assert!(!active.acceptance);
        assert!(active.acceptance_root.is_none());
        active.acceptance = true;
        active.acceptance_root = Some(PathBuf::from(r"C:\synthetic-only"));
        active.state = "Ready";
        forget_process(&mut active, "Stopped", None);
        assert!(!active.acceptance);
        assert!(active.acceptance_root.is_none());
        assert_eq!(active.state, "Stopped");
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
