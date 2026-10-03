use super::*;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};

fn protected(path: &Path) -> bool {
    crate::modules::archive::is_sensitive_archive_path(&path.to_string_lossy().replace('\\', "/"))
}

#[cfg(windows)]
fn opened_path(file: &fs::File) -> Result<PathBuf> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut buffer = vec![0u16; 32768];
    let size = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    };
    if size == 0 || size as usize >= buffer.len() {
        return Err("workspace-violation".into());
    }
    Ok(PathBuf::from(
        String::from_utf16(&buffer[..size as usize]).map_err(|_| "workspace-violation")?,
    ))
}
#[cfg(target_os = "linux")]
fn opened_path(file: &fs::File) -> Result<PathBuf> {
    use std::os::fd::AsRawFd;
    fs::canonicalize(format!("/proc/self/fd/{}", file.as_raw_fd()))
        .map_err(|_| "workspace-violation".into())
}
#[cfg(not(any(windows, target_os = "linux")))]
fn opened_path(_file: &fs::File) -> Result<PathBuf> {
    Err("unsupported-platform".into())
}

pub(super) fn read_file(
    root: &Path,
    raw: &str,
    limit: usize,
    cancelled: &AtomicBool,
) -> Result<Value> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
        use windows_sys::Win32::System::WindowsProgramming::{
            DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOVABLE,
        };
        let canonical = crate::modules::fs::to_canon(root);
        let bytes = canonical.as_bytes();
        if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || &bytes[1..3] != b":/" {
            return Err("workspace-violation".into());
        }
        let drive: Vec<u16> = format!("{}:\\\0", bytes[0] as char)
            .encode_utf16()
            .collect();
        if !matches!(
            unsafe { GetDriveTypeW(drive.as_ptr()) },
            DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_RAMDISK | DRIVE_CDROM
        ) {
            return Err("workspace-violation".into());
        }
    }
    let canonical_root = fs::canonicalize(root).map_err(|_| "workspace-violation")?;
    if crate::modules::fs::to_canon(&canonical_root) != crate::modules::fs::to_canon(root) {
        return Err("workspace-violation".into());
    }
    let root = canonical_root;
    if !root.is_dir() {
        return Err("workspace-violation".into());
    }
    let raw = raw.replace('\\', "/");
    if raw.split('/').any(|part| part == "..") || raw.contains('\0') {
        return Err("workspace-violation".into());
    }
    let raw_path = Path::new(&raw);
    if raw_path.is_absolute() {
        return Err("workspace-violation".into());
    }
    let requested = root.join(raw_path);
    if protected(&requested) {
        return Err("protected-path".into());
    }
    // Reject lexical escapes before any filesystem lookup (including UNC probes).
    let relative = requested
        .strip_prefix(&root)
        .map_err(|_| "workspace-violation")?;
    let mut component = root.clone();
    for part in relative.components() {
        component.push(part);
        let metadata = fs::symlink_metadata(&component).map_err(|_| "native-failed")?;
        if metadata.file_type().is_symlink() {
            return Err("workspace-violation".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("workspace-violation".into());
            }
        }
    }
    let target = fs::canonicalize(&requested).map_err(|_| "native-failed")?;
    if !target.starts_with(&root) || protected(&target) {
        return Err("workspace-violation".into());
    }
    let file = fs::File::open(&target).map_err(|_| "native-failed")?;
    let opened = opened_path(&file)?;
    if !opened.starts_with(&root) || protected(&opened) {
        return Err("workspace-violation".into());
    }
    let metadata = file.metadata().map_err(|_| "native-failed")?;
    if !metadata.is_file() {
        return Err("invalid-arguments".into());
    }
    if metadata.len() > limit as u64 {
        return Err("output-limit".into());
    }
    let mut bytes = Vec::new();
    let mut reader = file.take(limit as u64 + 1);
    let mut buffer = [0; 4096];
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("cancelled".into());
        }
        let count = reader.read(&mut buffer).map_err(|_| "native-failed")?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > limit {
            return Err("output-limit".into());
        }
    }
    if bytes.contains(&0) {
        return Err("invalid-output".into());
    }
    let value = Value::String(String::from_utf8(bytes).map_err(|_| "invalid-output")?);
    schema::bounded_json(&value, limit)?;
    Ok(value)
}

pub(super) fn credential_account(tool: &str, reference: &str) -> Result<String> {
    let account = format!("custom-tool:{tool}");
    if reference != format!("keyring:{account}") {
        return Err("credential-denied".into());
    }
    Ok(account)
}

pub(super) fn request(
    client: &reqwest::Client,
    url: reqwest::Url,
    method: &str,
    arguments: &Value,
    secret: Option<&str>,
) -> Result<reqwest::RequestBuilder> {
    let method = match method {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("network-denied".into()),
    };
    let mut request = client
        .request(method.clone(), url)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(secret) = secret {
        request = request.bearer_auth(secret);
    }
    if method == reqwest::Method::POST {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(schema::bounded_json(&arguments["body"], MAX_INPUT)?);
    }
    Ok(request)
}

pub(super) fn redact(value: &mut Value, secret: Option<&str>) {
    match value {
        Value::String(text) => {
            if let Some(secret) = secret.filter(|s| !s.is_empty()) {
                *text = text.replace(secret, "[redacted]");
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| redact(v, secret)),
        Value::Object(object) => {
            for (mut key, mut value) in std::mem::take(object) {
                if let Some(secret) = secret.filter(|s| !s.is_empty()) {
                    key = key.replace(secret, "[redacted]");
                }
                if [
                    "authorization",
                    "password",
                    "token",
                    "api_key",
                    "secret",
                    "cookie",
                    "set-cookie",
                ]
                .contains(&key.to_lowercase().as_str())
                {
                    value = Value::String("[redacted]".into());
                } else {
                    redact(&mut value, secret);
                }
                object.insert(key, value);
            }
        }
        _ => {}
    }
}

pub(super) async fn response(
    mut response: reqwest::Response,
    limit: usize,
    secret: Option<&str>,
) -> Result<Value> {
    if response.status().is_redirection() {
        return Err("redirect-denied".into());
    }
    if !response.status().is_success() {
        return Err(if matches!(response.status().as_u16(), 401 | 403) {
            "auth-failed"
        } else {
            "http-failed"
        }
        .into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("");
    if content_type != "application/json" && !content_type.ends_with("+json") {
        return Err("invalid-output".into());
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("output-limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network-failed")? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("output-limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid-output")?;
    redact(&mut value, secret);
    schema::bounded_json(&value, limit)?;
    Ok(value)
}
