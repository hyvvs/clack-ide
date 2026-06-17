use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
struct AcpProviderSpec {
    id: &'static str,
    label: &'static str,
    adapter_command: &'static str,
    cli_command: &'static str,
    setup: &'static str,
}

const ACP_PROVIDERS: &[AcpProviderSpec] = &[
    AcpProviderSpec {
        id: "codex",
        label: "Codex",
        adapter_command: "codex-acp",
        cli_command: "codex",
        setup: "Install @zed-industries/codex-acp, install the Codex CLI, and authenticate the CLI.",
    },
    AcpProviderSpec {
        id: "claude",
        label: "Claude Code",
        adapter_command: "claude-agent-acp",
        cli_command: "claude",
        setup: "Install @agentclientprotocol/claude-agent-acp, install Claude Code, and authenticate the CLI.",
    },
    AcpProviderSpec {
        id: "amp",
        label: "Amp",
        adapter_command: "amp-acp",
        cli_command: "amp",
        setup: "Install amp-acp, install Amp, and authenticate the CLI.",
    },
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpProviderStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub adapter_command: &'static str,
    pub cli_command: &'static str,
    pub adapter_found: bool,
    pub cli_found: bool,
    pub installed: bool,
    pub ready: bool,
    pub setup: &'static str,
    pub detail: String,
}

#[tauri::command]
pub async fn acp_detect_providers() -> Result<Vec<AcpProviderStatus>, String> {
    tauri::async_runtime::spawn_blocking(detect_providers)
        .await
        .map_err(|e| e.to_string())
}

fn detect_providers() -> Vec<AcpProviderStatus> {
    let paths = env_paths();
    let extensions = env_extensions();
    ACP_PROVIDERS
        .iter()
        .map(|spec| status_for_spec(spec, &paths, &extensions))
        .collect()
}

fn status_for_spec(
    spec: &AcpProviderSpec,
    paths: &[PathBuf],
    path_exts: &[String],
) -> AcpProviderStatus {
    let adapter_found = find_command_in_paths(spec.adapter_command, paths, path_exts).is_some();
    let cli_found = find_command_in_paths(spec.cli_command, paths, path_exts).is_some();
    let ready = adapter_found && cli_found;
    let detail = if ready {
        "ACP adapter and CLI were found on PATH. Authentication is validated when provider execution is enabled.".to_string()
    } else {
        let missing = match (adapter_found, cli_found) {
            (false, false) => format!(
                "Missing adapter `{}` and CLI `{}`.",
                spec.adapter_command, spec.cli_command
            ),
            (false, true) => format!("Missing adapter `{}`.", spec.adapter_command),
            (true, false) => format!("Missing CLI `{}`.", spec.cli_command),
            (true, true) => unreachable!("ready handled above"),
        };
        format!("{missing} {}", spec.setup)
    };

    AcpProviderStatus {
        id: spec.id,
        label: spec.label,
        adapter_command: spec.adapter_command,
        cli_command: spec.cli_command,
        adapter_found,
        cli_found,
        installed: ready,
        ready,
        setup: spec.setup,
        detail,
    }
}

fn env_paths() -> Vec<PathBuf> {
    env::var_os("PATH")
        .map(|paths| env::split_paths(&paths).collect())
        .unwrap_or_default()
}

#[cfg(windows)]
fn env_extensions() -> Vec<String> {
    let mut out = vec![String::new()];
    if let Some(raw) = env::var_os("PATHEXT") {
        for ext in raw.to_string_lossy().split(';') {
            let ext = ext.trim();
            if !ext.is_empty() {
                out.push(ext.to_string());
            }
        }
    }
    if out.len() == 1 {
        out.extend([".COM", ".EXE", ".BAT", ".CMD"].map(String::from));
    }
    out
}

#[cfg(not(windows))]
fn env_extensions() -> Vec<String> {
    vec![String::new()]
}

fn command_candidates(command: &str, path_exts: &[String]) -> Vec<String> {
    if command.is_empty() {
        return Vec::new();
    }
    let has_extension = Path::new(command).extension().is_some();
    if has_extension {
        return vec![command.to_string()];
    }
    path_exts
        .iter()
        .map(|ext| format!("{command}{ext}"))
        .collect()
}

fn find_command_in_paths(
    command: &str,
    paths: &[PathBuf],
    path_exts: &[String],
) -> Option<PathBuf> {
    let candidates = command_candidates(command, path_exts);
    for dir in paths {
        for candidate in &candidates {
            let path = dir.join(candidate);
            if is_executable_file(&path) {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    meta.is_file() && meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch_executable(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, b"").expect("write executable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).expect("metadata").permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms).expect("chmod");
        }
        path
    }

    #[test]
    fn finds_plain_command_on_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let exe = touch_executable(tmp.path(), "codex-acp");
        assert_eq!(
            find_command_in_paths("codex-acp", &[tmp.path().to_path_buf()], &[String::new()]),
            Some(exe)
        );
    }

    #[test]
    fn finds_windows_style_extension_from_pathext() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let exe = touch_executable(tmp.path(), "codex-acp.CMD");
        assert_eq!(
            find_command_in_paths(
                "codex-acp",
                &[tmp.path().to_path_buf()],
                &[String::new(), ".CMD".to_string()]
            ),
            Some(exe)
        );
    }

    #[test]
    fn provider_is_ready_only_when_adapter_and_cli_exist() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = [tmp.path().to_path_buf()];
        let exts = [String::new()];
        let spec = AcpProviderSpec {
            id: "codex",
            label: "Codex",
            adapter_command: "codex-acp",
            cli_command: "codex",
            setup: "setup",
        };

        let missing = status_for_spec(&spec, &paths, &exts);
        assert!(!missing.ready);
        assert!(missing.detail.contains("Missing adapter"));

        touch_executable(tmp.path(), "codex-acp");
        let partial = status_for_spec(&spec, &paths, &exts);
        assert!(partial.adapter_found);
        assert!(!partial.ready);
        assert!(partial.detail.contains("Missing CLI"));

        touch_executable(tmp.path(), "codex");
        let ready = status_for_spec(&spec, &paths, &exts);
        assert!(ready.ready);
        assert!(ready.installed);
    }
}
