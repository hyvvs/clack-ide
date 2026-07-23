use std::env;
use std::process::{self, Command};

use clack_linux_launcher::{
    build_launch_plan, proprietary_nvidia_detected, validate_real_binary, SessionEnvironment,
    EXPLICIT_SYNC_VARIABLE,
};

fn main() {
    if let Err(message) = validate_real_binary() {
        eprintln!("clack: {message}");
        process::exit(127);
    }

    let environment = SessionEnvironment::from_process();
    let plan = build_launch_plan(
        cfg!(target_os = "linux"),
        &environment,
        proprietary_nvidia_detected(),
        env::args_os().skip(1),
    );

    let mut command = Command::new(plan.executable);
    command.args(plan.arguments);
    if let Some(value) = plan.explicit_sync_override {
        command.env(EXPLICIT_SYNC_VARIABLE, value);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        let error = command.exec();
        eprintln!(
            "clack: failed to launch packaged application at {}: {error}",
            plan.executable
        );
        process::exit(126);
    }

    #[cfg(not(unix))]
    {
        match command.status() {
            Ok(status) => process::exit(status.code().unwrap_or(1)),
            Err(error) => {
                eprintln!(
                    "clack: failed to launch packaged application at {}: {error}",
                    plan.executable
                );
                process::exit(126);
            }
        }
    }
}
