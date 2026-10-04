//! Native backend decisions. Evidence is not permission to execute. Staging is
//! necessary on every host and never stands in for filesystem confinement.
use super::Failure;
use serde::{Deserialize, Serialize};

mod linux;
mod macos;
mod windows;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Windows,
    Linux,
    Macos,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    VerifiedSupported,
    Unsupported,
    UnavailableOnThisHost,
    Unverified,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Basis {
    HostUnavailable,
    NativeValidationRequired,
    WindowsFixture26200,
    SharedStagingTests,
    MissingKernelCapability,
    NoQualifyingBoundary,
    NoPublicPerExecutionBoundary,
    NoReplayLedgerTests,
    Wasi47Windows,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub state: State,
    pub basis: Basis,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub schema_version: u32,
    pub platform: Platform,
    pub staging_isolation: Evidence,
    pub filesystem_confinement: Evidence,
    pub secret_isolation: Evidence,
    pub environment_isolation: Evidence,
    pub executable_identity: Evidence,
    pub process_tree_ownership: Evidence,
    pub cancellation_cleanup: Evidence,
    pub timeout_cleanup: Evidence,
    pub network_denial: Evidence,
    pub output_bounds: Evidence,
    pub restart_safety: Evidence,
}
impl Report {
    fn new(platform: Platform, state: State, basis: Basis) -> Self {
        let e = Evidence { state, basis };
        Self {
            schema_version: 1,
            platform,
            staging_isolation: e,
            filesystem_confinement: e,
            secret_isolation: e,
            environment_isolation: e,
            executable_identity: e,
            process_tree_ownership: e,
            cancellation_cleanup: e,
            timeout_cleanup: e,
            network_denial: e,
            output_bounds: e,
            restart_safety: e,
        }
    }
    fn entries(&self) -> [Evidence; 11] {
        [
            self.staging_isolation,
            self.filesystem_confinement,
            self.secret_isolation,
            self.environment_isolation,
            self.executable_identity,
            self.process_tree_ownership,
            self.cancellation_cleanup,
            self.timeout_cleanup,
            self.network_denial,
            self.output_bounds,
            self.restart_safety,
        ]
    }
    pub fn validate(&self) -> Result<(), Failure> {
        if self.schema_version != 1
            || self.entries().iter().any(|e| {
                (match e.state {
                    State::VerifiedSupported => !matches!(
                        e.basis,
                        Basis::WindowsFixture26200
                            | Basis::Wasi47Windows
                            | Basis::SharedStagingTests
                            | Basis::NoReplayLedgerTests
                    ),
                    State::UnavailableOnThisHost => e.basis != Basis::HostUnavailable,
                    State::Unverified => e.basis != Basis::NativeValidationRequired,
                    State::Unsupported => !matches!(
                        e.basis,
                        Basis::MissingKernelCapability
                            | Basis::NoQualifyingBoundary
                            | Basis::NoPublicPerExecutionBoundary
                    ),
                }) || (matches!(e.basis, Basis::WindowsFixture26200 | Basis::Wasi47Windows)
                    && self.platform != Platform::Windows)
            })
        {
            return Err(Failure::InvalidPolicy);
        }
        Ok(())
    }
}

pub fn matrix() -> [Report; 3] {
    [windows::report(), linux::report(), macos::report()]
}

pub fn current() -> Report {
    #[cfg(windows)]
    {
        windows::report()
    }
    #[cfg(target_os = "linux")]
    {
        linux::report()
    }
    #[cfg(target_os = "macos")]
    {
        macos::report()
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        Report::new(
            Platform::Other,
            State::Unsupported,
            Basis::NoQualifyingBoundary,
        )
    }
}

pub(super) fn check_host() -> Result<(), Failure> {
    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    {
        super::wasi::engine().map(|_| ())
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        Err(Failure::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_are_bounded_individual_and_never_execution_authority() {
        for report in matrix() {
            report.validate().unwrap();
            let bytes = serde_json::to_vec(&report).unwrap();
            assert!(bytes.len() < 2048);
            assert_eq!(serde_json::from_slice::<Report>(&bytes).unwrap(), report);
        }
        assert!(check_host().is_ok());
        let mut report = current();
        report.network_denial = Evidence {
            state: State::VerifiedSupported,
            basis: Basis::HostUnavailable,
        };
        assert!(report.validate().is_err());
        report = current();
        report.schema_version += 1;
        assert!(report.validate().is_err());
    }
    #[test]
    fn other_platform_evidence_is_not_inferred_from_this_host() {
        for report in matrix() {
            if report.platform != current().platform {
                assert!(report
                    .entries()
                    .iter()
                    .all(|e| e.state == State::UnavailableOnThisHost));
            }
        }
    }
}
