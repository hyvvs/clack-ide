use super::*;

pub(super) fn report() -> Report {
    if !cfg!(target_os = "linux") {
        return Report::new(
            Platform::Linux,
            State::UnavailableOnThisHost,
            Basis::HostUnavailable,
        );
    }
    Report::new(
        Platform::Linux,
        State::Unverified,
        Basis::NativeValidationRequired,
    )
}
