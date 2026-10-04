use super::*;

pub(super) fn report() -> Report {
    if !cfg!(target_os = "macos") {
        return Report::new(
            Platform::Macos,
            State::UnavailableOnThisHost,
            Basis::HostUnavailable,
        );
    }
    Report::new(
        Platform::Macos,
        State::Unverified,
        Basis::NativeValidationRequired,
    )
}
