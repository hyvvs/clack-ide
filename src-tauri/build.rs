fn main() {
    // Exact, GitHub-SLSA-attested llama.cpp b12248 Windows x64 CPU release.
    // Deliberately do not approve Linux, ARM, CUDA, or arbitrary binaries.
    // Archive: https://github.com/ggml-org/llama.cpp/attestations/65886416
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64")
    {
        println!("cargo:rustc-env=CLACK_MANAGED_LLAMA_BUNDLE_SHA256=bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181");
        println!("cargo:rustc-env=CLACK_MANAGED_LLAMA_BINARY_SHA256=106ad878b697cccdc601b83a483c9649489c7c7fd3043e08cf7e292039a9cd8a");
    }
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let mut attributes = tauri_build::Attributes::new();
    if windows_msvc {
        // Embed once through the linker so library tests receive the same manifest as the app.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::try_build(attributes).expect("failed to build Clack resources");
}
