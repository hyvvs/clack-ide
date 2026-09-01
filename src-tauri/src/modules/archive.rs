use serde::Serialize;
use sevenz_rust2::{ArchiveReader, EncoderMethod, Password};
use std::collections::HashSet;
use std::io::{self, Cursor, Read};
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRY_COUNT: usize = 2_048;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;
const MAX_PATH_BYTES: usize = 1_024;
const MAX_TOTAL_PATH_BYTES: usize = 256 * 1024;
const MAX_NESTED_ARCHIVE_DEPTH: usize = 0;

const ZIP_LOCAL_SIGNATURE: &[u8] = b"PK\x03\x04";
const ZIP_EMPTY_SIGNATURE: &[u8] = b"PK\x05\x06";
const ZIP_STREAM_SIGNATURE: &[u8] = b"PK\x07\x08";
const RAR4_SIGNATURE: &[u8] = b"Rar!\x1a\x07\x00";
const RAR5_SIGNATURE: &[u8] = b"Rar!\x1a\x07\x01\x00";
const SEVEN_ZIP_SIGNATURE: &[u8] = b"7z\xbc\xaf\x27\x1c";
const WINDOWS_REPARSE_POINT: u32 = 0x400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveFormat {
    Zip,
    SevenZip,
    Rar4,
    Rar5,
}

impl ArchiveFormat {
    fn detect(bytes: &[u8]) -> Result<Self, String> {
        if bytes.starts_with(ZIP_LOCAL_SIGNATURE)
            || bytes.starts_with(ZIP_EMPTY_SIGNATURE)
            || bytes.starts_with(ZIP_STREAM_SIGNATURE)
        {
            Ok(Self::Zip)
        } else if bytes.starts_with(RAR5_SIGNATURE) {
            Ok(Self::Rar5)
        } else if bytes.starts_with(RAR4_SIGNATURE) {
            Ok(Self::Rar4)
        } else if bytes.starts_with(SEVEN_ZIP_SIGNATURE) {
            Ok(Self::SevenZip)
        } else {
            Err("Attachment does not have a supported ZIP, RAR4, RAR5, or 7z signature.".into())
        }
    }

    fn slug(self) -> &'static str {
        match self {
            Self::Zip => "zip",
            Self::SevenZip => "7z",
            Self::Rar4 => "rar4",
            Self::Rar5 => "rar5",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Zip => "ZIP",
            Self::SevenZip => "7z",
            Self::Rar4 => "RAR4",
            Self::Rar5 => "RAR5",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveManifestEntry {
    index: usize,
    path: String,
    entry_type: &'static str,
    compressed_size: u64,
    expanded_size: u64,
    media_type: Option<&'static str>,
    status: &'static str,
    selectable: bool,
    encrypted: bool,
    reason: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveManifest {
    format: &'static str,
    encrypted: bool,
    entry_count: usize,
    file_count: usize,
    folder_count: usize,
    total_compressed_bytes: u64,
    total_expanded_bytes: u64,
    nested_archive_depth_limit: usize,
    entries: Vec<ArchiveManifestEntry>,
}

fn safe_zip_error(error: impl std::fmt::Display) -> String {
    let message = error.to_string().to_ascii_lowercase();
    if message.contains("password") || message.contains("encrypt") {
        "Encrypted ZIP entries are not supported.".into()
    } else if message.contains("compression") {
        "ZIP uses an unsupported compression method.".into()
    } else {
        "ZIP is malformed or uses an unsupported structure.".into()
    }
}

fn safe_seven_zip_error(error: sevenz_rust2::Error) -> String {
    match error {
        sevenz_rust2::Error::PasswordRequired | sevenz_rust2::Error::MaybeBadPassword(_) => {
            "Encrypted 7z archives are visible but password handling is not supported.".into()
        }
        sevenz_rust2::Error::UnsupportedCompressionMethod(_)
        | sevenz_rust2::Error::ExternalUnsupported
        | sevenz_rust2::Error::Unsupported(_) => {
            "7z archive uses an unsupported compression method or structure.".into()
        }
        sevenz_rust2::Error::MaxMemLimited { .. } => {
            "7z archive exceeds the decoder memory limit.".into()
        }
        _ => "7z archive is malformed, truncated, or corrupt.".into(),
    }
}

fn validate_archive_input(bytes: &[u8]) -> Result<ArchiveFormat, String> {
    if bytes.is_empty() || bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "Archive input must be between 1 and {MAX_ARCHIVE_BYTES} bytes."
        ));
    }
    ArchiveFormat::detect(bytes)
}

fn validate_entry_path(
    format: ArchiveFormat,
    raw: Option<&[u8]>,
    decoded: &str,
) -> Result<String, String> {
    if raw.is_some_and(|value| value.contains(&0)) || decoded.contains('\0') {
        return Err(format!(
            "{} contains an entry with a NUL path.",
            format.label()
        ));
    }
    let raw_len = raw.map_or_else(|| decoded.len(), <[u8]>::len);
    if raw_len > MAX_PATH_BYTES || decoded.len() > MAX_PATH_BYTES {
        return Err(format!(
            "{} entry path exceeds the {MAX_PATH_BYTES}-byte limit.",
            format.label()
        ));
    }
    if decoded.starts_with('/') || decoded.starts_with('\\') {
        return Err(format!(
            "{} contains an absolute or UNC path.",
            format.label()
        ));
    }
    let bytes = decoded.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(format!("{} contains a Windows drive path.", format.label()));
    }
    if decoded.chars().any(char::is_control) {
        return Err(format!(
            "{} contains a path with control characters.",
            format.label()
        ));
    }
    let mut components = Vec::new();
    for component in decoded.split(['/', '\\']) {
        if component == ".." {
            return Err(format!(
                "{} contains a parent-directory traversal path.",
                format.label()
            ));
        }
        if component.is_empty() || component == "." {
            continue;
        }
        if component.len() > 255 {
            return Err(format!(
                "{} contains an oversized path component.",
                format.label()
            ));
        }
        components.push(component);
    }
    if components.is_empty() {
        return Err(format!("{} contains an empty entry path.", format.label()));
    }
    Ok(components.join("/"))
}

fn validate_unix_entry_type(
    format: ArchiveFormat,
    mode: Option<u32>,
    directory: bool,
) -> Result<(), String> {
    let Some(mode) = mode else {
        return Ok(());
    };
    let kind = mode & 0o170000;
    if kind == 0 || kind == 0o100000 || (directory && kind == 0o040000) {
        return Ok(());
    }
    if kind == 0o120000 {
        return Err(format!(
            "{} contains a symbolic-link entry.",
            format.label()
        ));
    }
    Err(format!(
        "{} contains a hard-link, device, FIFO, socket, or special entry.",
        format.label()
    ))
}

fn validate_seven_zip_entry_type(
    attributes: Option<u32>,
    directory: bool,
    anti_item: bool,
) -> Result<(), String> {
    if anti_item {
        return Err("7z contains an anti-item or represented special entry.".into());
    }
    let Some(attributes) = attributes else {
        return Ok(());
    };
    if attributes & WINDOWS_REPARSE_POINT != 0 {
        return Err("7z contains a Windows reparse-point entry.".into());
    }
    validate_unix_entry_type(ArchiveFormat::SevenZip, Some(attributes >> 16), directory)
}

fn validate_entry_size(
    format: ArchiveFormat,
    compressed: u64,
    expanded: u64,
    validate_ratio: bool,
) -> Result<(), String> {
    if expanded > MAX_ENTRY_BYTES {
        return Err(format!(
            "{} entry exceeds the {MAX_ENTRY_BYTES}-byte expanded limit.",
            format.label()
        ));
    }
    if validate_ratio {
        validate_compression_ratio(format, compressed, expanded)?;
    }
    Ok(())
}

fn validate_compression_ratio(
    format: ArchiveFormat,
    compressed: u64,
    expanded: u64,
) -> Result<(), String> {
    if expanded > 0
        && (compressed == 0 || expanded > compressed.saturating_mul(MAX_COMPRESSION_RATIO))
    {
        return Err(format!(
            "{} data exceeds the {MAX_COMPRESSION_RATIO}:1 compression-ratio limit.",
            format.label()
        ));
    }
    Ok(())
}

fn add_expanded_total(format: ArchiveFormat, current: u64, expanded: u64) -> Result<u64, String> {
    let total = current
        .checked_add(expanded)
        .ok_or_else(|| format!("{} expanded-size metadata overflowed.", format.label()))?;
    if total > MAX_TOTAL_EXPANDED_BYTES {
        return Err(format!(
            "{} exceeds the {MAX_TOTAL_EXPANDED_BYTES}-byte expanded safety limit.",
            format.label()
        ));
    }
    Ok(total)
}

fn add_path_total(format: ArchiveFormat, current: usize, path: &str) -> Result<usize, String> {
    let total = current
        .checked_add(path.len())
        .ok_or_else(|| format!("{} path metadata overflowed.", format.label()))?;
    if total > MAX_TOTAL_PATH_BYTES {
        return Err(format!(
            "{} paths exceed the {MAX_TOTAL_PATH_BYTES}-byte manifest limit.",
            format.label()
        ));
    }
    Ok(total)
}

fn add_compressed_total(
    format: ArchiveFormat,
    current: u64,
    compressed: u64,
) -> Result<u64, String> {
    let total = current
        .checked_add(compressed)
        .ok_or_else(|| format!("{} compressed-size metadata overflowed.", format.label()))?;
    if total > MAX_ARCHIVE_BYTES as u64 {
        return Err(format!(
            "{} compressed entries exceed the {MAX_ARCHIVE_BYTES}-byte input budget.",
            format.label()
        ));
    }
    Ok(total)
}

fn archive_media_type(path: &str) -> Option<&'static str> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    match extension.as_str() {
        "txt" | "log" | "ini" | "conf" | "config" => Some("text/plain"),
        "md" | "markdown" => Some("text/markdown"),
        "json" => Some("application/json"),
        "csv" => Some("text/csv"),
        "yaml" | "yml" => Some("application/yaml"),
        "toml" => Some("application/toml"),
        "js" | "jsx" => Some("text/javascript"),
        "ts" | "tsx" => Some("text/typescript"),
        "rs" => Some("text/x-rust"),
        "py" => Some("text/x-python"),
        "go" => Some("text/x-go"),
        "java" => Some("text/x-java-source"),
        "c" | "h" => Some("text/x-c"),
        "cc" | "cpp" | "hpp" => Some("text/x-c++"),
        "html" => Some("text/html"),
        "css" => Some("text/css"),
        "xml" => Some("application/xml"),
        "sql" => Some("application/sql"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "pdf" => Some("application/pdf"),
        "zip" => Some("application/zip"),
        "rar" => Some("application/vnd.rar"),
        "7z" => Some("application/x-7z-compressed"),
        _ => None,
    }
}

fn is_nested_archive(path: &str) -> bool {
    matches!(
        archive_media_type(path),
        Some("application/zip" | "application/vnd.rar" | "application/x-7z-compressed")
    )
}

fn is_sensitive_archive_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let components = lower.split('/').collect::<Vec<_>>();
    if components.iter().any(|component| {
        matches!(
            *component,
            ".ssh" | ".gnupg" | ".aws" | ".azure" | ".kube" | ".git"
        )
    }) {
        return true;
    }
    let basename = components.last().copied().unwrap_or_default();
    basename == ".env"
        || basename.starts_with(".env.")
        || basename == "credentials"
        || basename.starts_with("secret.json")
        || basename.starts_with("secrets.json")
        || basename.starts_with("secret.yaml")
        || basename.starts_with("secrets.yaml")
        || basename.starts_with("secret.yml")
        || basename.starts_with("secrets.yml")
        || basename.starts_with("secret.toml")
        || basename.starts_with("secrets.toml")
        || (basename.starts_with("service-account") && basename.ends_with(".json"))
        || (basename.starts_with("service_account") && basename.ends_with(".json"))
        || basename == "known_hosts"
        || basename == "authorized_keys"
        || basename == ".netrc"
        || basename == "_netrc"
        || basename == ".npmrc"
        || basename == ".pypirc"
        || basename.starts_with("id_rsa")
        || basename.starts_with("id_dsa")
        || basename.starts_with("id_ecdsa")
        || basename.starts_with("id_ed25519")
        || ["pem", "key", "p12", "pfx", "asc", "gpg", "keystore", "jks"]
            .iter()
            .any(|extension| basename.ends_with(&format!(".{extension}")))
}

fn entry_state(
    directory: bool,
    path: &str,
    encrypted: bool,
) -> (&'static str, &'static str, bool, Option<&'static str>) {
    if directory {
        ("folder", "ready", false, None)
    } else if encrypted {
        (
            "file",
            "blocked",
            false,
            Some("Encrypted archive entries are not supported yet."),
        )
    } else if is_nested_archive(path) {
        (
            "file",
            "blocked",
            false,
            Some("Nested archives are not opened automatically."),
        )
    } else if is_sensitive_archive_path(path) {
        (
            "file",
            "blocked",
            false,
            Some("Sensitive paths cannot be materialized from archives."),
        )
    } else {
        ("file", "ready", true, None)
    }
}

fn inspect_zip(bytes: &[u8]) -> Result<ArchiveManifest, String> {
    if validate_archive_input(bytes)? != ArchiveFormat::Zip {
        return Err("Attachment does not have a ZIP signature.".into());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(safe_zip_error)?;
    if archive.len() > MAX_ENTRY_COUNT {
        return Err(format!(
            "ZIP exceeds the {MAX_ENTRY_COUNT}-entry safety limit."
        ));
    }
    let mut entries = Vec::with_capacity(archive.len());
    let mut seen_paths = HashSet::with_capacity(archive.len());
    let mut total_path_bytes = 0_usize;
    let mut total_compressed_bytes = 0_u64;
    let mut total_expanded_bytes = 0_u64;
    let mut file_count = 0_usize;
    let mut folder_count = 0_usize;
    let mut encrypted_archive = false;

    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(safe_zip_error)?;
        let directory = entry.is_dir();
        let path = validate_entry_path(ArchiveFormat::Zip, Some(entry.name_raw()), entry.name())?;
        validate_unix_entry_type(ArchiveFormat::Zip, entry.unix_mode(), directory)?;
        if !seen_paths.insert(path.clone()) {
            return Err("ZIP contains duplicate normalized entry paths.".into());
        }
        total_path_bytes = add_path_total(ArchiveFormat::Zip, total_path_bytes, &path)?;

        let compressed_size = entry.compressed_size();
        let expanded_size = entry.size();
        if !directory {
            validate_entry_size(ArchiveFormat::Zip, compressed_size, expanded_size, true)?;
        }
        total_compressed_bytes =
            add_compressed_total(ArchiveFormat::Zip, total_compressed_bytes, compressed_size)?;
        total_expanded_bytes =
            add_expanded_total(ArchiveFormat::Zip, total_expanded_bytes, expanded_size)?;

        let encrypted = entry.encrypted();
        encrypted_archive |= encrypted;
        let (entry_type, status, selectable, reason) = entry_state(directory, &path, encrypted);
        if directory {
            folder_count += 1;
        } else {
            file_count += 1;
        }
        entries.push(ArchiveManifestEntry {
            index,
            path: path.clone(),
            entry_type,
            compressed_size,
            expanded_size,
            media_type: archive_media_type(&path),
            status,
            selectable,
            encrypted,
            reason,
        });
    }

    Ok(ArchiveManifest {
        format: ArchiveFormat::Zip.slug(),
        encrypted: encrypted_archive,
        entry_count: entries.len(),
        file_count,
        folder_count,
        total_compressed_bytes,
        total_expanded_bytes,
        nested_archive_depth_limit: MAX_NESTED_ARCHIVE_DEPTH,
        entries,
    })
}

fn seven_zip_block_is_encrypted(archive: &sevenz_rust2::Archive, block_index: usize) -> bool {
    archive.blocks.get(block_index).is_some_and(|block| {
        block
            .coders
            .iter()
            .any(|coder| coder.encoder_method_id() == EncoderMethod::ID_AES256_SHA256)
    })
}

fn validate_seven_zip_blocks(archive: &sevenz_rust2::Archive) -> Result<(), String> {
    let first_pack_indexes = archive.stream_map.block_first_pack_stream_index();
    let pack_sizes = archive.pack_sizes();
    for (block_index, block) in archive.blocks.iter().enumerate() {
        let first = *first_pack_indexes
            .get(block_index)
            .ok_or_else(|| "7z has inconsistent compression-block metadata.".to_string())?;
        let end = first_pack_indexes
            .get(block_index + 1)
            .copied()
            .unwrap_or(pack_sizes.len());
        let compressed = pack_sizes
            .get(first..end)
            .ok_or_else(|| "7z has out-of-bounds compression-block metadata.".to_string())?
            .iter()
            .try_fold(0_u64, |total, size| {
                total
                    .checked_add(*size)
                    .ok_or_else(|| "7z compressed-block metadata overflowed.".to_string())
            })?;
        validate_compression_ratio(ArchiveFormat::SevenZip, compressed, block.get_unpack_size())?;
    }
    Ok(())
}

fn inspect_seven_zip(bytes: &[u8]) -> Result<ArchiveManifest, String> {
    if validate_archive_input(bytes)? != ArchiveFormat::SevenZip {
        return Err("Attachment does not have a 7z signature.".into());
    }
    let mut reader =
        ArchiveReader::new(Cursor::new(bytes), Password::empty()).map_err(safe_seven_zip_error)?;
    reader.set_thread_count(1);
    let archive = reader.archive();
    if archive.files.len() > MAX_ENTRY_COUNT {
        return Err(format!(
            "7z exceeds the {MAX_ENTRY_COUNT}-entry safety limit."
        ));
    }
    validate_seven_zip_blocks(archive)?;

    let mut entries = Vec::with_capacity(archive.files.len());
    let mut seen_paths = HashSet::with_capacity(archive.files.len());
    let mut total_path_bytes = 0_usize;
    let mut total_compressed_bytes = 0_u64;
    let mut total_expanded_bytes = 0_u64;
    let mut file_count = 0_usize;
    let mut folder_count = 0_usize;
    let mut encrypted_archive = false;

    for (index, entry) in archive.files.iter().enumerate() {
        let directory = entry.is_directory;
        let path = validate_entry_path(ArchiveFormat::SevenZip, None, &entry.name)?;
        validate_seven_zip_entry_type(
            entry
                .has_windows_attributes
                .then_some(entry.windows_attributes),
            directory,
            entry.is_anti_item,
        )?;
        if !seen_paths.insert(path.clone()) {
            return Err("7z contains duplicate normalized entry paths.".into());
        }
        total_path_bytes = add_path_total(ArchiveFormat::SevenZip, total_path_bytes, &path)?;

        if !directory {
            validate_entry_size(
                ArchiveFormat::SevenZip,
                entry.compressed_size,
                entry.size,
                false,
            )?;
        }
        total_compressed_bytes = add_compressed_total(
            ArchiveFormat::SevenZip,
            total_compressed_bytes,
            entry.compressed_size,
        )?;
        total_expanded_bytes =
            add_expanded_total(ArchiveFormat::SevenZip, total_expanded_bytes, entry.size)?;

        let encrypted = archive
            .stream_map
            .file_block_index
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|block_index| seven_zip_block_is_encrypted(archive, block_index));
        encrypted_archive |= encrypted;
        let (entry_type, status, selectable, reason) = entry_state(directory, &path, encrypted);
        if directory {
            folder_count += 1;
        } else {
            file_count += 1;
        }
        entries.push(ArchiveManifestEntry {
            index,
            path: path.clone(),
            entry_type,
            compressed_size: entry.compressed_size,
            expanded_size: entry.size,
            media_type: archive_media_type(&path),
            status,
            selectable,
            encrypted,
            reason,
        });
    }

    Ok(ArchiveManifest {
        format: ArchiveFormat::SevenZip.slug(),
        encrypted: encrypted_archive,
        entry_count: entries.len(),
        file_count,
        folder_count,
        total_compressed_bytes,
        total_expanded_bytes,
        nested_archive_depth_limit: MAX_NESTED_ARCHIVE_DEPTH,
        entries,
    })
}

fn inspect_archive(bytes: &[u8]) -> Result<ArchiveManifest, String> {
    match validate_archive_input(bytes)? {
        ArchiveFormat::Zip => inspect_zip(bytes),
        ArchiveFormat::SevenZip => inspect_seven_zip(bytes),
        ArchiveFormat::Rar4 | ArchiveFormat::Rar5 => Err(
            "RAR4 and RAR5 are detected, but safe embedded RAR inspection is not available in this build."
                .into(),
        ),
    }
}

fn read_zip_entry(bytes: &[u8], entry_index: usize) -> Result<Vec<u8>, String> {
    let manifest = inspect_zip(bytes)?;
    let metadata = manifest
        .entries
        .get(entry_index)
        .ok_or_else(|| "ZIP entry index is out of bounds.".to_string())?;
    if metadata.index != entry_index || !metadata.selectable {
        return Err("ZIP entry is not safe to materialize.".into());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(safe_zip_error)?;
    let mut entry = archive.by_index(entry_index).map_err(safe_zip_error)?;
    let mut extracted = Vec::with_capacity(entry.size() as usize);
    entry
        .by_ref()
        .take(MAX_ENTRY_BYTES + 1)
        .read_to_end(&mut extracted)
        .map_err(safe_zip_error)?;
    if extracted.len() as u64 != entry.size() || extracted.len() as u64 > MAX_ENTRY_BYTES {
        return Err("ZIP entry expanded beyond its declared safe size.".into());
    }
    Ok(extracted)
}

fn read_seven_zip_entry(bytes: &[u8], entry_index: usize) -> Result<Vec<u8>, String> {
    let manifest = inspect_seven_zip(bytes)?;
    let metadata = manifest
        .entries
        .get(entry_index)
        .ok_or_else(|| "7z entry index is out of bounds.".to_string())?;
    if metadata.index != entry_index || !metadata.selectable {
        return Err("7z entry is not safe to materialize.".into());
    }

    let mut reader =
        ArchiveReader::new(Cursor::new(bytes), Password::empty()).map_err(safe_seven_zip_error)?;
    reader.set_thread_count(1);
    let target_name = reader
        .archive()
        .files
        .get(entry_index)
        .ok_or_else(|| "7z entry index changed during materialization.".to_string())?
        .name
        .clone();
    let expected_size = metadata.expanded_size;
    let mut extracted = None;
    reader
        .for_each_entries(|entry, source| {
            let is_target = entry.name == target_name;
            let mut limited = source.take(MAX_ENTRY_BYTES + 1);
            if is_target {
                let mut bytes = Vec::with_capacity(expected_size as usize);
                limited.read_to_end(&mut bytes)?;
                if bytes.len() as u64 != expected_size || bytes.len() as u64 > MAX_ENTRY_BYTES {
                    return Err(io::Error::other(
                        "7z entry expanded beyond its declared safe size",
                    )
                    .into());
                }
                extracted = Some(bytes);
            } else {
                let consumed = io::copy(&mut limited, &mut io::sink())?;
                if consumed != entry.size || consumed > MAX_ENTRY_BYTES {
                    return Err(io::Error::other(
                        "7z entry expanded beyond its declared safe size",
                    )
                    .into());
                }
            }
            Ok(!is_target)
        })
        .map_err(safe_seven_zip_error)?;
    extracted.ok_or_else(|| "7z selected entry was not found during materialization.".into())
}

fn read_archive_entry(bytes: &[u8], entry_index: usize) -> Result<Vec<u8>, String> {
    match validate_archive_input(bytes)? {
        ArchiveFormat::Zip => read_zip_entry(bytes, entry_index),
        ArchiveFormat::SevenZip => read_seven_zip_entry(bytes, entry_index),
        ArchiveFormat::Rar4 | ArchiveFormat::Rar5 => {
            Err("RAR entry materialization is not supported.".into())
        }
    }
}

#[tauri::command]
pub async fn attachment_archive_inspect(
    request: tauri::ipc::Request<'_>,
) -> Result<ArchiveManifest, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("attachment_archive_inspect expected a raw byte body.".into());
    };
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "Archive exceeds the {MAX_ARCHIVE_BYTES}-byte input limit."
        ));
    }
    let owned = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || inspect_archive(&owned))
        .await
        .map_err(|error| format!("Archive inspection task failed: {error}"))?
}

#[tauri::command]
pub async fn attachment_archive_read_entry(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("attachment_archive_read_entry expected a raw byte body.".into());
    };
    if bytes.len() < 5 || bytes.len() > MAX_ARCHIVE_BYTES + 4 {
        return Err(format!(
            "Archive entry request must contain an index and at most {MAX_ARCHIVE_BYTES} archive bytes."
        ));
    }
    let entry_index = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let owned = bytes[4..].to_vec();
    let extracted =
        tauri::async_runtime::spawn_blocking(move || read_archive_entry(&owned, entry_index))
            .await
            .map_err(|error| format!("Archive materialization task failed: {error}"))??;
    Ok(tauri::ipc::Response::new(extracted))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sevenz_rust2::encoder_options::AesEncoderOptions;
    use sevenz_rust2::{ArchiveEntry, ArchiveWriter};
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn zip_with(entries: &[(&str, &[u8], Option<u32>)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        for (path, content, mode) in entries {
            let mut options = SimpleFileOptions::default();
            if let Some(mode) = mode {
                options = options.unix_permissions(*mode);
            }
            writer.start_file(*path, options).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn zip_with_unix_type(path: &str, content: &[u8], mode: u32) -> Vec<u8> {
        let mut bytes = zip_with(&[(path, content, None)]);
        let central = bytes
            .windows(4)
            .position(|window| window == b"PK\x01\x02")
            .unwrap();
        bytes[central + 4..central + 6].copy_from_slice(&0x0314_u16.to_le_bytes());
        bytes[central + 38..central + 42].copy_from_slice(&(mode << 16).to_le_bytes());
        bytes
    }

    fn seven_zip_with(entries: Vec<(ArchiveEntry, Option<Vec<u8>>)>) -> Vec<u8> {
        let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
        writer.set_encrypt_header(false);
        for (entry, content) in entries {
            writer
                .push_archive_entry(entry, content.as_deref())
                .unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn seven_zip_file(path: &str, content: &[u8]) -> Vec<u8> {
        seven_zip_with(vec![(ArchiveEntry::new_file(path), Some(content.to_vec()))])
    }

    #[test]
    fn archive_signatures_distinguish_zip_rar4_rar5_and_seven_zip() {
        assert_eq!(
            ArchiveFormat::detect(b"PK\x03\x04data").unwrap(),
            ArchiveFormat::Zip
        );
        assert_eq!(
            ArchiveFormat::detect(b"Rar!\x1a\x07\x00data").unwrap(),
            ArchiveFormat::Rar4
        );
        assert_eq!(
            ArchiveFormat::detect(b"Rar!\x1a\x07\x01\x00data").unwrap(),
            ArchiveFormat::Rar5
        );
        assert_eq!(
            ArchiveFormat::detect(b"7z\xbc\xaf\x27\x1cdata").unwrap(),
            ArchiveFormat::SevenZip
        );
    }

    #[test]
    fn rar_versions_fail_closed_without_external_tools() {
        for bytes in [
            b"Rar!\x1a\x07\x00not-a-rar".as_slice(),
            b"Rar!\x1a\x07\x01\x00not-a-rar".as_slice(),
        ] {
            let error = inspect_archive(bytes).unwrap_err();
            assert!(error.contains("safe embedded RAR inspection"));
        }
    }

    #[test]
    fn parent_directory_traversal_is_rejected() {
        assert!(validate_entry_path(ArchiveFormat::Zip, Some(b"../secret"), "../secret").is_err());
        assert!(validate_entry_path(ArchiveFormat::SevenZip, None, "safe/../../secret").is_err());
    }

    #[test]
    fn absolute_drive_unc_and_nul_paths_are_rejected() {
        for path in [
            "/etc/passwd",
            "C:/secret",
            "C:\\secret",
            "\\\\server\\share",
        ] {
            assert!(validate_entry_path(ArchiveFormat::SevenZip, None, path).is_err());
            assert!(inspect_seven_zip(&seven_zip_file(path, b"secret")).is_err());
        }
        assert!(validate_entry_path(ArchiveFormat::SevenZip, None, "bad\0name").is_err());
    }

    #[test]
    fn zip_symlinks_and_special_entries_are_rejected() {
        assert!(validate_unix_entry_type(ArchiveFormat::Zip, Some(0o120777), false).is_err());
        assert!(validate_unix_entry_type(ArchiveFormat::Zip, Some(0o010644), false).is_err());
        assert!(validate_unix_entry_type(ArchiveFormat::Zip, Some(0o060644), false).is_err());
        assert!(validate_unix_entry_type(ArchiveFormat::Zip, Some(0o100755), false).is_ok());
        assert!(inspect_zip(&zip_with_unix_type("link", b"target", 0o120777)).is_err());
        assert!(inspect_zip(&zip_with_unix_type("fifo", b"", 0o010644)).is_err());
    }

    #[test]
    fn seven_zip_symlinks_reparse_points_and_special_entries_are_rejected() {
        for attributes in [
            (0o120777_u32) << 16,
            (0o010644_u32) << 16,
            (0o060644_u32) << 16,
            WINDOWS_REPARSE_POINT,
        ] {
            let mut entry = ArchiveEntry::new_file("unsafe");
            entry.has_windows_attributes = true;
            entry.windows_attributes = attributes;
            assert!(inspect_seven_zip(&seven_zip_with(vec![(entry, Some(Vec::new()))])).is_err());
        }
    }

    #[test]
    fn per_entry_and_aggregate_limits_are_shared() {
        assert!(
            validate_entry_size(ArchiveFormat::SevenZip, 1, MAX_ENTRY_BYTES + 1, false).is_err()
        );
        assert!(add_expanded_total(ArchiveFormat::SevenZip, MAX_TOTAL_EXPANDED_BYTES, 1).is_err());
        assert_eq!(
            add_expanded_total(ArchiveFormat::SevenZip, 1, 1).unwrap(),
            2
        );
    }

    #[test]
    fn compression_ratio_bombs_are_rejected_for_zip_and_seven_zip() {
        assert!(
            validate_compression_ratio(ArchiveFormat::Zip, 1, MAX_COMPRESSION_RATIO + 1).is_err()
        );
        let bomb = seven_zip_file("zeros.bin", &vec![0; 1024 * 1024]);
        assert!(inspect_seven_zip(&bomb)
            .unwrap_err()
            .contains("compression-ratio"));
    }

    #[test]
    fn archive_input_limit_is_enforced() {
        assert!(validate_archive_input(&vec![0; MAX_ARCHIVE_BYTES + 1]).is_err());
    }

    #[test]
    fn excessive_seven_zip_entry_count_is_rejected() {
        let entries = (0..=MAX_ENTRY_COUNT)
            .map(|index| {
                (
                    ArchiveEntry::new_file(&format!("{index}.txt")),
                    Some(Vec::new()),
                )
            })
            .collect();
        let bytes = seven_zip_with(entries);
        assert!(inspect_seven_zip(&bytes)
            .unwrap_err()
            .contains("entry safety"));
    }

    #[test]
    fn malformed_archives_fail_without_filesystem_side_effects() {
        let scratch = tempfile::tempdir().unwrap();
        assert!(inspect_zip(b"PK\x03\x04malformed").is_err());
        assert!(inspect_seven_zip(b"7z\xbc\xaf\x27\x1cmalformed").is_err());
        assert_eq!(scratch.path().read_dir().unwrap().count(), 0);
    }

    #[test]
    fn seven_zip_nested_archives_are_listed_but_not_selectable() {
        let bytes = seven_zip_file("nested.rar", RAR5_SIGNATURE);
        let manifest = inspect_seven_zip(&bytes).unwrap();
        assert_eq!(manifest.nested_archive_depth_limit, 0);
        assert!(!manifest.entries[0].selectable);
        assert_eq!(manifest.entries[0].status, "blocked");
        assert!(read_seven_zip_entry(&bytes, 0).is_err());
    }

    #[test]
    fn seven_zip_sensitive_entries_are_visible_but_not_selectable() {
        let bytes = seven_zip_file("config/.env", b"SECRET=value");
        let manifest = inspect_seven_zip(&bytes).unwrap();
        assert!(!manifest.entries[0].selectable);
        assert_eq!(manifest.entries[0].status, "blocked");
        assert!(read_seven_zip_entry(&bytes, 0).is_err());
    }

    #[test]
    fn seven_zip_duplicate_normalized_paths_are_rejected() {
        let bytes = seven_zip_with(vec![
            (ArchiveEntry::new_file("src/main.ts"), Some(b"one".to_vec())),
            (
                ArchiveEntry::new_file("src\\main.ts"),
                Some(b"two".to_vec()),
            ),
        ]);
        assert!(inspect_seven_zip(&bytes).unwrap_err().contains("duplicate"));
    }

    #[test]
    fn seven_zip_manifest_and_selective_materialization_share_the_contract() {
        let bytes = seven_zip_with(vec![
            (ArchiveEntry::new_directory("src"), None),
            (
                ArchiveEntry::new_file("src/first.txt"),
                Some(b"first".to_vec()),
            ),
            (
                ArchiveEntry::new_file("src/unicode-\u{96ea}.txt"),
                Some(b"second".to_vec()),
            ),
        ]);
        let manifest = inspect_archive(&bytes).unwrap();
        assert_eq!(manifest.format, "7z");
        assert_eq!(manifest.file_count, 2);
        assert_eq!(manifest.folder_count, 1);
        assert_eq!(read_archive_entry(&bytes, 2).unwrap(), b"second");
    }

    #[test]
    fn encrypted_seven_zip_entries_are_locked_without_password_handling() {
        let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
        writer.set_encrypt_header(false);
        writer.set_content_methods(vec![AesEncoderOptions::new(Password::from("pw")).into()]);
        writer
            .push_archive_entry(
                ArchiveEntry::new_file("locked.txt"),
                Some(b"secret".as_slice()),
            )
            .unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let manifest = inspect_seven_zip(&bytes).unwrap();
        assert!(manifest.encrypted);
        assert!(manifest.entries[0].encrypted);
        assert!(!manifest.entries[0].selectable);
        assert!(read_seven_zip_entry(&bytes, 0).is_err());
    }

    #[test]
    fn zip_regression_keeps_selective_materialization() {
        let bytes = zip_with(&[
            ("first.txt", b"first", None),
            ("second.txt", b"second", None),
        ]);
        let manifest = inspect_archive(&bytes).unwrap();
        assert_eq!(manifest.format, "zip");
        assert_eq!(manifest.file_count, 2);
        assert_eq!(read_archive_entry(&bytes, 1).unwrap(), b"second");
    }
}
