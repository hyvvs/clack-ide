use serde::Serialize;
use std::collections::HashSet;
use std::io::{Cursor, Read};
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRY_COUNT: usize = 2_048;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;
const MAX_PATH_BYTES: usize = 1_024;
const MAX_TOTAL_PATH_BYTES: usize = 256 * 1024;
const MAX_NESTED_ARCHIVE_DEPTH: usize = 0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipManifestEntry {
    index: usize,
    path: String,
    entry_type: &'static str,
    compressed_size: u64,
    expanded_size: u64,
    media_type: Option<&'static str>,
    status: &'static str,
    selectable: bool,
    reason: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipManifest {
    format: &'static str,
    entry_count: usize,
    file_count: usize,
    folder_count: usize,
    total_compressed_bytes: u64,
    total_expanded_bytes: u64,
    nested_archive_depth_limit: usize,
    entries: Vec<ZipManifestEntry>,
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

fn validate_archive_input(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "ZIP input must be between 1 and {MAX_ARCHIVE_BYTES} bytes."
        ));
    }
    if !bytes.starts_with(b"PK\x03\x04")
        && !bytes.starts_with(b"PK\x05\x06")
        && !bytes.starts_with(b"PK\x07\x08")
    {
        return Err("Attachment does not have a ZIP signature.".into());
    }
    Ok(())
}

fn validate_entry_path(raw: &[u8], decoded: &str) -> Result<String, String> {
    if raw.contains(&0) || decoded.contains('\0') {
        return Err("ZIP contains an entry with a NUL path.".into());
    }
    if raw.len() > MAX_PATH_BYTES || decoded.len() > MAX_PATH_BYTES {
        return Err(format!(
            "ZIP entry path exceeds the {MAX_PATH_BYTES}-byte limit."
        ));
    }
    if decoded.starts_with('/') || decoded.starts_with('\\') {
        return Err("ZIP contains an absolute or UNC path.".into());
    }
    let bytes = decoded.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err("ZIP contains a Windows drive path.".into());
    }
    if decoded.chars().any(|character| character.is_control()) {
        return Err("ZIP contains a path with control characters.".into());
    }
    let mut components = Vec::new();
    for component in decoded.split(['/', '\\']) {
        if component == ".." {
            return Err("ZIP contains a parent-directory traversal path.".into());
        }
        if component.is_empty() || component == "." {
            continue;
        }
        if component.len() > 255 {
            return Err("ZIP contains an oversized path component.".into());
        }
        components.push(component);
    }
    if components.is_empty() {
        return Err("ZIP contains an empty entry path.".into());
    }
    Ok(components.join("/"))
}

fn validate_unix_entry_type(mode: Option<u32>, directory: bool) -> Result<(), String> {
    let Some(mode) = mode else {
        return Ok(());
    };
    let kind = mode & 0o170000;
    if kind == 0 || kind == 0o100000 || (directory && kind == 0o040000) {
        return Ok(());
    }
    if kind == 0o120000 {
        return Err("ZIP contains a symbolic-link entry.".into());
    }
    Err("ZIP contains a hard-link, device, FIFO, or special entry.".into())
}

fn validate_size_policy(compressed: u64, expanded: u64) -> Result<(), String> {
    if expanded > MAX_ENTRY_BYTES {
        return Err(format!(
            "ZIP entry exceeds the {MAX_ENTRY_BYTES}-byte expanded limit."
        ));
    }
    if expanded > 0
        && (compressed == 0 || expanded > compressed.saturating_mul(MAX_COMPRESSION_RATIO))
    {
        return Err(format!(
            "ZIP entry exceeds the {MAX_COMPRESSION_RATIO}:1 compression-ratio limit."
        ));
    }
    Ok(())
}

fn add_expanded_total(current: u64, expanded: u64) -> Result<u64, String> {
    let total = current
        .checked_add(expanded)
        .ok_or_else(|| "ZIP expanded-size metadata overflowed.".to_string())?;
    if total > MAX_TOTAL_EXPANDED_BYTES {
        return Err(format!(
            "ZIP exceeds the {MAX_TOTAL_EXPANDED_BYTES}-byte expanded safety limit."
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

fn inspect_zip(bytes: &[u8]) -> Result<ZipManifest, String> {
    validate_archive_input(bytes)?;
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

    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(safe_zip_error)?;
        let directory = entry.is_dir();
        let path = validate_entry_path(entry.name_raw(), entry.name())?;
        validate_unix_entry_type(entry.unix_mode(), directory)?;
        if !seen_paths.insert(path.clone()) {
            return Err("ZIP contains duplicate normalized entry paths.".into());
        }
        total_path_bytes = total_path_bytes
            .checked_add(path.len())
            .ok_or_else(|| "ZIP path metadata overflowed its safety limit.".to_string())?;
        if total_path_bytes > MAX_TOTAL_PATH_BYTES {
            return Err(format!(
                "ZIP paths exceed the {MAX_TOTAL_PATH_BYTES}-byte manifest limit."
            ));
        }

        let compressed_size = entry.compressed_size();
        let expanded_size = entry.size();
        if !directory {
            validate_size_policy(compressed_size, expanded_size)?;
        }
        total_compressed_bytes = total_compressed_bytes
            .checked_add(compressed_size)
            .ok_or_else(|| "ZIP compressed-size metadata overflowed.".to_string())?;
        if total_compressed_bytes > MAX_ARCHIVE_BYTES as u64 {
            return Err(format!(
                "ZIP compressed entries exceed the {MAX_ARCHIVE_BYTES}-byte input budget."
            ));
        }
        total_expanded_bytes = add_expanded_total(total_expanded_bytes, expanded_size)?;

        let nested = !directory && is_nested_archive(&path);
        let sensitive = !directory && is_sensitive_archive_path(&path);
        let (entry_type, status, selectable, reason) = if directory {
            folder_count += 1;
            ("folder", "ready", false, None)
        } else if nested {
            file_count += 1;
            (
                "file",
                "blocked",
                false,
                Some("Nested archives are not opened automatically."),
            )
        } else if sensitive {
            file_count += 1;
            (
                "file",
                "blocked",
                false,
                Some("Sensitive paths cannot be materialized from archives."),
            )
        } else {
            file_count += 1;
            ("file", "ready", true, None)
        };
        entries.push(ZipManifestEntry {
            index,
            path,
            entry_type,
            compressed_size,
            expanded_size,
            media_type: archive_media_type(entry.name()),
            status,
            selectable,
            reason,
        });
    }

    Ok(ZipManifest {
        format: "zip",
        entry_count: entries.len(),
        file_count,
        folder_count,
        total_compressed_bytes,
        total_expanded_bytes,
        nested_archive_depth_limit: MAX_NESTED_ARCHIVE_DEPTH,
        entries,
    })
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

#[tauri::command]
pub async fn attachment_zip_inspect(
    request: tauri::ipc::Request<'_>,
) -> Result<ZipManifest, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("attachment_zip_inspect expected a raw byte body.".into());
    };
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "ZIP exceeds the {MAX_ARCHIVE_BYTES}-byte input limit."
        ));
    }
    let owned = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || inspect_zip(&owned))
        .await
        .map_err(|error| format!("ZIP inspection task failed: {error}"))?
}

#[tauri::command]
pub async fn attachment_zip_read_entry(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("attachment_zip_read_entry expected a raw byte body.".into());
    };
    if bytes.len() < 5 || bytes.len() > MAX_ARCHIVE_BYTES + 4 {
        return Err(format!(
            "ZIP entry request must contain an index and at most {MAX_ARCHIVE_BYTES} archive bytes."
        ));
    }
    let entry_index = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let owned = bytes[4..].to_vec();
    let extracted =
        tauri::async_runtime::spawn_blocking(move || read_zip_entry(&owned, entry_index))
            .await
            .map_err(|error| format!("ZIP extraction task failed: {error}"))??;
    Ok(tauri::ipc::Response::new(extracted))
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn parent_directory_traversal_is_rejected() {
        assert!(validate_entry_path(b"../secret", "../secret").is_err());
        assert!(validate_entry_path(b"safe/../../secret", "safe/../../secret").is_err());
    }

    #[test]
    fn absolute_paths_are_rejected() {
        assert!(validate_entry_path(b"/etc/passwd", "/etc/passwd").is_err());
    }

    #[test]
    fn windows_drive_paths_are_rejected() {
        assert!(validate_entry_path(b"C:/secret", "C:/secret").is_err());
        assert!(validate_entry_path(b"C:\\secret", "C:\\secret").is_err());
    }

    #[test]
    fn unc_paths_are_rejected() {
        assert!(validate_entry_path(b"\\\\server\\share", "\\\\server\\share").is_err());
    }

    #[test]
    fn nul_paths_are_rejected() {
        assert!(validate_entry_path(b"bad\0name", "bad\0name").is_err());
    }

    #[test]
    fn symlinks_and_special_entries_are_rejected() {
        assert!(validate_unix_entry_type(Some(0o120777), false).is_err());
        assert!(validate_unix_entry_type(Some(0o010644), false).is_err());
        assert!(validate_unix_entry_type(Some(0o060644), false).is_err());
        assert!(validate_unix_entry_type(Some(0o100755), false).is_ok());
        assert!(inspect_zip(&zip_with_unix_type("link", b"target", 0o120777)).is_err());
        assert!(inspect_zip(&zip_with_unix_type("fifo", b"", 0o010644)).is_err());
    }

    #[test]
    fn per_entry_limit_is_enforced() {
        assert!(validate_size_policy(1, MAX_ENTRY_BYTES + 1).is_err());
    }

    #[test]
    fn compression_ratio_bombs_are_rejected() {
        assert!(validate_size_policy(1, MAX_COMPRESSION_RATIO + 1).is_err());
        assert!(validate_size_policy(100, 10_000).is_ok());
    }

    #[test]
    fn archive_input_limit_is_enforced() {
        assert!(validate_archive_input(&vec![0; MAX_ARCHIVE_BYTES + 1]).is_err());
    }

    #[test]
    fn excessive_entry_count_is_rejected() {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        for index in 0..=MAX_ENTRY_COUNT {
            writer
                .start_file(format!("{index}.txt"), SimpleFileOptions::default())
                .unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        assert!(inspect_zip(&bytes).unwrap_err().contains("entry safety"));
    }

    #[test]
    fn excessive_total_expanded_size_is_rejected_without_allocating() {
        assert!(add_expanded_total(MAX_TOTAL_EXPANDED_BYTES, 1).is_err());
        assert_eq!(add_expanded_total(1, 1).unwrap(), 2);
    }

    #[test]
    fn malformed_zip_is_rejected_without_filesystem_side_effects() {
        let scratch = tempfile::tempdir().unwrap();
        assert!(inspect_zip(b"PK\x03\x04malformed").is_err());
        assert_eq!(scratch.path().read_dir().unwrap().count(), 0);
    }

    #[test]
    fn nested_archives_are_listed_but_not_selectable() {
        let bytes = zip_with(&[("nested.zip", b"PK\x05\x06", None)]);
        let manifest = inspect_zip(&bytes).unwrap();
        assert_eq!(manifest.nested_archive_depth_limit, 0);
        assert!(!manifest.entries[0].selectable);
        assert_eq!(manifest.entries[0].status, "blocked");
        assert!(read_zip_entry(&bytes, 0).is_err());
    }

    #[test]
    fn sensitive_entries_are_listed_but_not_selectable() {
        let bytes = zip_with(&[("config/.env", b"SECRET=value", None)]);
        let manifest = inspect_zip(&bytes).unwrap();
        assert!(!manifest.entries[0].selectable);
        assert_eq!(manifest.entries[0].status, "blocked");
        assert!(read_zip_entry(&bytes, 0).is_err());
    }

    #[test]
    fn only_the_selected_entry_is_materialized() {
        let bytes = zip_with(&[
            ("first.txt", b"first", None),
            ("second.txt", b"second", None),
        ]);
        let manifest = inspect_zip(&bytes).unwrap();
        assert_eq!(manifest.file_count, 2);
        assert_eq!(read_zip_entry(&bytes, 1).unwrap(), b"second");
    }
}
