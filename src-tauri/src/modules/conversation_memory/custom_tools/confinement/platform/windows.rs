use super::*;

pub(super) fn report() -> Report {
    if !cfg!(windows) {
        return Report::new(
            Platform::Windows,
            State::UnavailableOnThisHost,
            Basis::HostUnavailable,
        );
    }
    #[cfg(windows)]
    if super::super::staging::supported_host() {
        return Report::new(
            Platform::Windows,
            State::VerifiedSupported,
            Basis::Wasi47Windows,
        );
    }
    Report::new(
        Platform::Windows,
        State::Unverified,
        Basis::NativeValidationRequired,
    )
}
