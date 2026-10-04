//! PSEC wire/API ownership. Direct-root and legacy launch probes are test-only.
//! Wire contract: Microsoft's MIT-licensed ProcessSecurityEnvironment.fbs at
//! https://github.com/microsoft/mxc/blob/main/external/windows-sdk/ProcessSecurityEnvironment.fbs
use flatbuffers::{FlatBufferBuilder, Push, PushAlignment};
use std::{ffi::c_void, path::Path, ptr::null_mut};
use windows_sys::Win32::Foundation::{FreeLibrary, HANDLE, HMODULE};
use windows_sys::Win32::System::LibraryLoader::{
    GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
};

type Create = unsafe extern "system" fn(*const c_void, u32, u32, *mut HANDLE) -> i32;
type Close = unsafe extern "system" fn(HANDLE);
type Query = unsafe extern "system" fn(*mut u64) -> i32;
type QueryVersion = unsafe extern "system" fn(u32, *mut u8, *mut u32) -> i32;

pub(super) struct Environment {
    handle: HANDLE,
    close: Close,
    library: HMODULE,
}
impl Environment {
    #[cfg(test)]
    pub fn create(root: &Path, deny: &Path) -> Result<Self, i32> {
        Self::from_specification(specification(root, deny, false, None)?)
    }
    pub fn create_staged(root: &Path) -> Result<Self, i32> {
        Self::from_specification(specification(root, &root.join("denied"), true, None)?)
    }
    #[cfg(test)]
    pub fn create_drive_only_probe(root: &Path) -> Result<Self, i32> {
        // Deliberately incomplete namespace evidence. Never a production fallback.
        Self::probe_namespace(root, &drive_roots()?)
    }
    #[cfg(test)]
    pub fn probe_namespace(root: &Path, roots: &[std::path::PathBuf]) -> Result<Self, i32> {
        Self::from_specification(specification(
            root,
            &root.join("denied"),
            true,
            Some(roots),
        )?)
    }
    fn from_specification(bytes: Vec<u8>) -> Result<Self, i32> {
        let (mut value, create) = Self::load_api()?;
        let status = unsafe {
            create(
                bytes.as_ptr().cast(),
                bytes.len() as u32,
                0,
                &mut value.handle,
            )
        };
        if status < 0 {
            return Err(status);
        }
        if value.handle.is_null() {
            return Err(0x8000ffffu32 as i32);
        }
        Ok(value)
    }
    pub fn supported() -> bool {
        Self::load_api().is_ok()
    }
    fn load_api() -> Result<(Self, Create), i32> {
        let name: Vec<_> = "processmodel.dll".encode_utf16().chain(Some(0)).collect();
        let library =
            unsafe { LoadLibraryExW(name.as_ptr(), null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32) };
        if library.is_null() {
            return Err(0x80004001u32 as i32);
        }
        let mut value = Self {
            handle: null_mut(),
            close: noop,
            library,
        };
        let (create, close, query) = unsafe {
            (
                GetProcAddress(library, c"CreateProcessSecurityEnvironment".as_ptr().cast()),
                GetProcAddress(library, c"CloseProcessSecurityEnvironment".as_ptr().cast()),
                GetProcAddress(
                    library,
                    c"QueryProcessSecurityEnvironmentSupport".as_ptr().cast(),
                ),
            )
        };
        let (Some(create), Some(close), Some(query)) = (create, close, query) else {
            return Err(0x80004001u32 as i32);
        };
        // Signatures follow the published PSEC V2 declarations, not legacy CPIS.
        let create: Create = unsafe { std::mem::transmute(create) };
        value.close =
            unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, Close>(close) };
        let query: Query = unsafe { std::mem::transmute(query) };
        let version = unsafe {
            GetProcAddress(
                library,
                c"IsProcessSecurityEnvironmentVersionSupported"
                    .as_ptr()
                    .cast(),
            )
        }
        .ok_or(0x80004001u32 as i32)?;
        let version: QueryVersion = unsafe { std::mem::transmute(version) };
        let mut available = 0;
        let mut minor = 0;
        let status = unsafe { version(1, &mut available, &mut minor) };
        if status < 0 || available == 0 {
            return Err(0x80004001u32 as i32);
        }
        let mut supported = 0;
        let status = unsafe { query(&mut supported) };
        if status < 0 {
            return Err(status);
        }
        if supported & 1 == 0 {
            return Err(0x80004001u32 as i32);
        }
        Ok((value, create))
    }
    pub fn handle(&self) -> HANDLE {
        self.handle
    }
}

// Legacy wire slots include the deprecated integrity_level slot. This is a
// separate contract from PSEC, not a different identifier on the same buffer.
#[cfg(test)]
pub(super) fn legacy_specification(root: &Path, version: &str) -> Vec<u8> {
    let mut b = FlatBufferBuilder::new();
    let version = b.create_string(version);
    let capability = b.create_string("registryRead");
    let read = b.create_string(&root.to_string_lossy());
    let write = b.create_string(&root.join("scratch").to_string_lossy());
    let read = b.create_vector(&[read]);
    let write = b.create_vector(&[write]);
    let t = b.start_table();
    b.push_slot_always(4, version);
    b.push_slot(6, true, false);
    b.push_slot_always(16, capability);
    b.push_slot_always(18, write);
    b.push_slot_always(20, read);
    let root = b.end_table(t);
    b.finish(root, Some("SBOX"));
    b.finished_data().to_vec()
}
unsafe extern "system" fn noop(_: HANDLE) {}
impl Drop for Environment {
    fn drop(&mut self) {
        unsafe {
            if !self.handle.is_null() {
                (self.close)(self.handle);
            }
            FreeLibrary(self.library);
        }
    }
}

#[repr(C)]
struct Version {
    major: u16,
    minor: u16,
}
impl Push for Version {
    type Output = Version;
    fn alignment() -> PushAlignment {
        PushAlignment::new(2)
    }
    unsafe fn push(&self, bytes: &mut [u8], _: usize) {
        bytes[..2].copy_from_slice(&self.major.to_le_bytes());
        bytes[2..4].copy_from_slice(&self.minor.to_le_bytes());
    }
}
fn specification(
    root: &Path,
    deny: &Path,
    isolated: bool,
    test_roots: Option<&[std::path::PathBuf]>,
) -> Result<Vec<u8>, i32> {
    use windows_sys::Win32::System::SystemInformation::{
        GetSystemDirectoryW, GetWindowsDirectoryW,
    };
    let mut b = FlatBufferBuilder::new();
    let read = b.create_string(&root.to_string_lossy());
    let mut system = [0u16; 32768];
    let length = unsafe {
        if isolated {
            GetSystemDirectoryW(system.as_mut_ptr(), system.len() as u32)
        } else {
            GetWindowsDirectoryW(system.as_mut_ptr(), system.len() as u32)
        }
    } as usize;
    if length == 0 || length >= system.len() {
        return Err(0x80004005u32 as i32);
    }
    let system = std::path::PathBuf::from(String::from_utf16_lossy(&system[..length]));
    let mut reads = vec![read];
    if isolated {
        for path in runtime_paths()? {
            reads.push(b.create_string(&path.to_string_lossy()));
        }
    } else {
        reads.push(b.create_string(&system.to_string_lossy()));
    }
    let write = b.create_string(&root.join("scratch").to_string_lossy());
    let denied = b.create_string(&deny.to_string_lossy());
    let mut denies = vec![denied];
    let roots = if let Some(roots) = test_roots {
        roots.to_vec()
    } else if isolated {
        volume_roots()?
    } else {
        drive_roots()?
    };
    for drive in roots {
        denies.push(b.create_string(&drive.to_string_lossy()));
    }
    let read = b.create_vector(&reads);
    let write = b.create_vector(&[write]);
    let denied = b.create_vector(&denies);
    let capability = b.create_string("registryRead");
    let t = b.start_table();
    let deny_egress = b.end_table(t); // EndpointPolicy defaults to deny.
    let t = b.start_table();
    b.push_slot_always(6, deny_egress); // NetworkPolicy.egress
    let network = b.end_table(t);
    let t = b.start_table();
    b.push_slot_always(18, network);
    b.push_slot_always(16, denied);
    b.push_slot_always(14, read);
    b.push_slot_always(12, write);
    b.push_slot_always(6, capability);
    b.push_slot_always(4, Version { major: 1, minor: 0 });
    let root = b.end_table(t);
    b.finish(root, Some("PSEC"));
    Ok(b.finished_data().to_vec())
}

pub(super) fn runtime_paths() -> Result<Vec<std::path::PathBuf>, i32> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut system = [0u16; 32768];
    let n = unsafe { GetSystemDirectoryW(system.as_mut_ptr(), system.len() as u32) } as usize;
    if n == 0 || n >= system.len() {
        return Err(0x80004005u32 as i32);
    }
    let root = std::path::PathBuf::from(String::from_utf16_lossy(&system[..n]));
    Ok([
        "ntdll.dll",
        "kernel32.dll",
        "KernelBase.dll",
        "ucrtbase.dll",
        "bcryptPrimitives.dll",
        "ws2_32.dll",
        "mswsock.dll",
        "nsi.dll",
        "rpcrt4.dll",
        "sechost.dll",
        "advapi32.dll",
        "userenv.dll",
        "profapi.dll",
        "msvcrt.dll",
        "apphelp.dll",
        "vcruntime140.dll",
    ]
    .iter()
    .map(|name| root.join(name))
    .collect())
}

pub(super) fn volume_roots() -> Result<Vec<std::path::PathBuf>, i32> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        Storage::FileSystem::*,
    };
    let mut roots = drive_roots()?;
    struct Volumes(HANDLE);
    impl Drop for Volumes {
        fn drop(&mut self) {
            unsafe {
                FindVolumeClose(self.0);
            }
        }
    }
    let mut path = [0u16; 1024];
    let handle = unsafe { FindFirstVolumeW(path.as_mut_ptr(), path.len() as u32) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(0x80004005u32 as i32);
    }
    let handle = Volumes(handle);
    loop {
        let n = path
            .iter()
            .position(|v| *v == 0)
            .ok_or(0x80004005u32 as i32)?;
        roots.push(String::from_utf16_lossy(&path[..n]).into());
        if roots.len() > 64 {
            return Err(0x80004005u32 as i32);
        }
        if unsafe { FindNextVolumeW(handle.0, path.as_mut_ptr(), path.len() as u32) } == 0 {
            if unsafe { GetLastError() } != ERROR_NO_MORE_FILES {
                return Err(0x80004005u32 as i32);
            }
            break;
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn drive_roots() -> Result<Vec<std::path::PathBuf>, i32> {
    use windows_sys::Win32::Storage::FileSystem::GetLogicalDriveStringsW;
    let mut roots = Vec::new();
    let mut drives = [0u16; 1024];
    let n = unsafe { GetLogicalDriveStringsW(drives.len() as u32, drives.as_mut_ptr()) } as usize;
    if n == 0 || n >= drives.len() {
        return Err(0x80004005u32 as i32);
    }
    for drive in drives[..n].split(|v| *v == 0).filter(|v| !v.is_empty()) {
        roots.push(String::from_utf16_lossy(drive).into());
    }
    Ok(roots)
}

#[test]
fn native_namespace_contract_probe() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("scratch")).unwrap();
    for path in [
        "\\",
        "\\Device\\",
        "\\\\?\\GLOBALROOT\\",
        "\\\\?\\GLOBALROOT\\Device\\",
        "\\??\\",
        "*",
    ] {
        let roots = [std::path::PathBuf::from(path)];
        let result = Environment::probe_namespace(root.path(), &roots);
        eprintln!(
            "Namespace {path:?}: {:?}",
            result.as_ref().map(|_| "created")
        );
    }
    for path in volume_roots().unwrap() {
        let result = Environment::probe_namespace(root.path(), std::slice::from_ref(&path));
        eprintln!("Volume {path:?}: {:?}", result.as_ref().map(|_| "created"));
    }
}

#[test]
fn inspect_native_psec_creation() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("scratch")).unwrap();
    std::fs::write(root.path().join(".env"), "SECRET_CANARY").unwrap();
    let result = Environment::create(root.path(), &root.path().join(".env"));
    match result {
        Ok(env) => {
            assert!(!env.handle().is_null());
            eprintln!("Native PSEC 1.0 environment created and closed");
        }
        Err(code) => panic!("Native PSEC creation HRESULT={:#010x}", code as u32),
    }
}
