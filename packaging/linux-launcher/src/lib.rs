use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::Path;

pub const REAL_BINARY_PATH: &str = "/usr/lib/clack/clack-bin";
pub const EXPLICIT_SYNC_VARIABLE: &str = "__NV_DISABLE_EXPLICIT_SYNC";
pub const WORKAROUND_OPT_OUT_VARIABLE: &str = "CLACK_DISABLE_NVIDIA_WAYLAND_WORKAROUND";
pub const WORKAROUND_VALUE: &str = "1";

const NVIDIA_INDICATORS: [&str; 3] = [
    "/proc/driver/nvidia/version",
    "/sys/module/nvidia/version",
    "/sys/module/nvidia",
];

#[derive(Debug, Default, Eq, PartialEq)]
pub struct SessionEnvironment {
    pub explicit_sync: Option<OsString>,
    pub workaround_opt_out: Option<OsString>,
    pub xdg_session_type: Option<OsString>,
    pub wayland_display: Option<OsString>,
}

impl SessionEnvironment {
    pub fn from_process() -> Self {
        Self {
            explicit_sync: env::var_os(EXPLICIT_SYNC_VARIABLE),
            workaround_opt_out: env::var_os(WORKAROUND_OPT_OUT_VARIABLE),
            xdg_session_type: env::var_os("XDG_SESSION_TYPE"),
            wayland_display: env::var_os("WAYLAND_DISPLAY"),
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum WorkaroundDecision {
    Enabled,
    NotLinux,
    AlreadyConfigured,
    OptedOut,
    NotWayland,
    NvidiaNotDetected,
}

#[derive(Debug, Eq, PartialEq)]
pub struct LaunchPlan {
    pub executable: &'static str,
    pub arguments: Vec<OsString>,
    pub explicit_sync_override: Option<OsString>,
    pub decision: WorkaroundDecision,
}

pub fn is_wayland_session(environment: &SessionEnvironment) -> bool {
    let xdg_wayland = environment
        .xdg_session_type
        .as_deref()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("wayland"));
    let has_wayland_display = environment
        .wayland_display
        .as_deref()
        .is_some_and(|value| !value.is_empty());

    xdg_wayland || has_wayland_display
}

pub fn decide_workaround(
    is_linux: bool,
    environment: &SessionEnvironment,
    proprietary_nvidia_detected: bool,
) -> WorkaroundDecision {
    if !is_linux {
        return WorkaroundDecision::NotLinux;
    }
    if environment.explicit_sync.is_some() {
        return WorkaroundDecision::AlreadyConfigured;
    }
    if environment.workaround_opt_out.as_deref() == Some("1".as_ref()) {
        return WorkaroundDecision::OptedOut;
    }
    if !is_wayland_session(environment) {
        return WorkaroundDecision::NotWayland;
    }
    if !proprietary_nvidia_detected {
        return WorkaroundDecision::NvidiaNotDetected;
    }

    WorkaroundDecision::Enabled
}

pub fn build_launch_plan(
    is_linux: bool,
    environment: &SessionEnvironment,
    proprietary_nvidia_detected: bool,
    arguments: impl IntoIterator<Item = OsString>,
) -> LaunchPlan {
    let decision = decide_workaround(is_linux, environment, proprietary_nvidia_detected);
    let explicit_sync_override =
        (decision == WorkaroundDecision::Enabled).then(|| OsString::from(WORKAROUND_VALUE));

    LaunchPlan {
        executable: REAL_BINARY_PATH,
        arguments: arguments.into_iter().collect(),
        explicit_sync_override,
        decision,
    }
}

pub fn proprietary_nvidia_detected() -> bool {
    proprietary_nvidia_detected_from(NVIDIA_INDICATORS.iter().map(Path::new))
}

fn proprietary_nvidia_detected_from<'a>(indicators: impl IntoIterator<Item = &'a Path>) -> bool {
    indicators
        .into_iter()
        .any(|path| path.is_dir() || path.is_file())
}

pub fn validate_real_binary() -> Result<(), String> {
    let path = Path::new(REAL_BINARY_PATH);
    let metadata = fs::metadata(path).map_err(|error| {
        format!("Clack's packaged application binary is unavailable at {REAL_BINARY_PATH}: {error}")
    })?;

    if !metadata.is_file() {
        return Err(format!(
            "Clack's packaged application binary path is not a file: {REAL_BINARY_PATH}"
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment() -> SessionEnvironment {
        SessionEnvironment::default()
    }

    #[test]
    fn non_linux_never_enables_the_workaround() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("wayland"));

        assert_eq!(
            decide_workaround(false, &session, true),
            WorkaroundDecision::NotLinux
        );
    }

    #[test]
    fn linux_non_wayland_does_not_enable_the_workaround() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("x11"));

        assert_eq!(
            decide_workaround(true, &session, true),
            WorkaroundDecision::NotWayland
        );
    }

    #[test]
    fn wayland_without_nvidia_does_not_enable_the_workaround() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("wayland"));

        assert_eq!(
            decide_workaround(true, &session, false),
            WorkaroundDecision::NvidiaNotDetected
        );
    }

    #[test]
    fn proprietary_nvidia_and_wayland_enable_the_workaround() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("wayland"));

        assert_eq!(
            decide_workaround(true, &session, true),
            WorkaroundDecision::Enabled
        );
    }

    #[test]
    fn xdg_session_type_is_case_insensitive() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("  WaYlAnD  "));

        assert!(is_wayland_session(&session));
        assert_eq!(
            decide_workaround(true, &session, true),
            WorkaroundDecision::Enabled
        );
    }

    #[test]
    fn non_empty_wayland_display_detects_wayland() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("x11"));
        session.wayland_display = Some(OsString::from("wayland-0"));

        assert!(is_wayland_session(&session));
        assert_eq!(
            decide_workaround(true, &session, true),
            WorkaroundDecision::Enabled
        );
    }

    #[test]
    fn empty_wayland_display_does_not_detect_wayland() {
        let mut session = environment();
        session.wayland_display = Some(OsString::new());

        assert!(!is_wayland_session(&session));
    }

    #[test]
    fn existing_explicit_sync_value_is_preserved() {
        let mut session = environment();
        session.explicit_sync = Some(OsString::from("0"));
        session.xdg_session_type = Some(OsString::from("wayland"));

        let plan = build_launch_plan(true, &session, true, []);

        assert_eq!(plan.decision, WorkaroundDecision::AlreadyConfigured);
        assert_eq!(session.explicit_sync, Some(OsString::from("0")));
        assert_eq!(plan.explicit_sync_override, None);
    }

    #[test]
    fn opt_out_disables_automatic_setting() {
        let mut session = environment();
        session.workaround_opt_out = Some(OsString::from("1"));
        session.xdg_session_type = Some(OsString::from("wayland"));

        assert_eq!(
            decide_workaround(true, &session, true),
            WorkaroundDecision::OptedOut
        );
    }

    #[test]
    fn launch_plan_forwards_unicode_arguments_in_order() {
        let arguments = vec![
            OsString::from("--workspace"),
            OsString::from("/tmp/Clack workspace"),
            OsString::from("日本語"),
        ];

        let plan = build_launch_plan(false, &environment(), false, arguments.clone());

        assert_eq!(plan.arguments, arguments);
    }

    #[cfg(unix)]
    #[test]
    fn launch_plan_preserves_non_utf8_arguments() {
        use std::os::unix::ffi::OsStringExt;

        let raw = vec![0x66, 0x6f, 0x80, 0x6f];
        let argument = OsString::from_vec(raw.clone());
        let plan = build_launch_plan(false, &environment(), false, [argument]);

        assert_eq!(plan.arguments[0].clone().into_vec(), raw);
    }

    #[test]
    fn real_binary_path_is_the_packaged_application_binary() {
        assert_eq!(REAL_BINARY_PATH, "/usr/lib/clack/clack-bin");
    }

    #[test]
    fn enabled_plan_sets_only_the_process_override() {
        let mut session = environment();
        session.xdg_session_type = Some(OsString::from("wayland"));

        let plan = build_launch_plan(true, &session, true, []);

        assert_eq!(plan.decision, WorkaroundDecision::Enabled);
        assert_eq!(
            plan.explicit_sync_override,
            Some(OsString::from(WORKAROUND_VALUE))
        );
    }

    #[test]
    fn nvidia_detection_accepts_a_driver_file_or_module_directory() {
        let root =
            env::temp_dir().join(format!("clack-launcher-nvidia-test-{}", std::process::id()));
        let missing = root.join("missing");
        let version_file = root.join("version");
        let module_directory = root.join("nvidia");

        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create detector fixture root");
        assert!(!proprietary_nvidia_detected_from([missing.as_path()]));

        fs::write(&version_file, "NVRM version").expect("create detector file");
        assert!(proprietary_nvidia_detected_from([
            missing.as_path(),
            version_file.as_path(),
        ]));

        fs::remove_file(&version_file).expect("remove detector file");
        fs::create_dir(&module_directory).expect("create detector directory");
        assert!(proprietary_nvidia_detected_from([
            missing.as_path(),
            module_directory.as_path(),
        ]));

        fs::remove_dir_all(root).expect("remove detector fixtures");
    }
}
