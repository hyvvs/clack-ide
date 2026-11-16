// Windows-only private native runtime DACL. System and Administrators retain
// access; the *actual object owner* gets full access through OWNER RIGHTS.
// No inherited broad Users/Authenticated Users ACL is accepted.
use std::{
    ffi::c_void,
    fs,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::MetadataExt,
    },
    path::Path,
    ptr,
};

const DACL_SECURITY_INFORMATION: u32 = 0x00000004;
const PROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x80000000;
const SE_DACL_PROTECTED: u16 = 0x1000;
const SDDL_REVISION_1: u32 = 1;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x00000400;
const PRIVATE_SDDL: &str = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;OW)";

#[link(name = "Advapi32")]
extern "system" {
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        input: *const u16,
        version: u32,
        result: *mut *mut c_void,
        size: *mut u32,
    ) -> i32;
    fn SetFileSecurityW(path: *const u16, info: u32, descriptor: *const c_void) -> i32;
    fn GetFileSecurityW(
        path: *const u16,
        info: u32,
        buffer: *mut c_void,
        length: u32,
        needed: *mut u32,
    ) -> i32;
    fn GetSecurityDescriptorDacl(
        descriptor: *const c_void,
        present: *mut i32,
        dacl: *mut *const c_void,
        defaulted: *mut i32,
    ) -> i32;
    fn GetSecurityDescriptorControl(
        descriptor: *const c_void,
        control: *mut u16,
        revision: *mut u32,
    ) -> i32;
}
#[link(name = "Kernel32")]
extern "system" {
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
    fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
}

/// Read the OS-owned Windows System32 DLL directory from the kernel rather
/// than a caller-controlled PATH / SystemRoot environment variable.
pub(super) fn system_directory() -> Result<std::path::PathBuf, String> {
    let mut buffer = [0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
    if length == 0 || length as usize >= buffer.len() {
        return Err("Windows system DLL directory unavailable".into());
    }
    let dir = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]));
    regular_dir(&dir)?;
    Ok(dir)
}

pub(super) fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

struct PrivateDescriptor(*mut c_void);
impl Drop for PrivateDescriptor {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}
fn private_descriptor() -> Result<PrivateDescriptor, String> {
    let sddl: Vec<u16> = PRIVATE_SDDL.encode_utf16().chain(Some(0)).collect();
    let mut descriptor = ptr::null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if ok == 0 || descriptor.is_null() {
        return Err("Could not construct private Windows security descriptor".into());
    }
    Ok(PrivateDescriptor(descriptor))
}
fn dacl_bytes(descriptor: *const c_void) -> Result<Vec<u8>, String> {
    let mut present = 0i32;
    let mut defaulted = 0i32;
    let mut acl = ptr::null();
    if unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) } == 0
        || present == 0
        || acl.is_null()
    {
        return Err("Missing protected runtime directory DACL".into());
    }
    // Windows ACL header is eight bytes; AclSize is a little-endian u16 at +2.
    let header = unsafe { std::slice::from_raw_parts(acl.cast::<u8>(), 8) };
    let length = u16::from_le_bytes([header[2], header[3]]) as usize;
    if !(8..=64 * 1024).contains(&length) {
        return Err("Malformed runtime directory DACL".into());
    }
    Ok(unsafe { std::slice::from_raw_parts(acl.cast::<u8>(), length) }.to_vec())
}

fn protected_dacl(descriptor: *const c_void) -> Result<(), String> {
    let mut control = 0u16;
    let mut revision = 0u32;
    if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
        || control & SE_DACL_PROTECTED == 0
    {
        return Err("Runtime directory inherits untrusted Windows ACL entries".into());
    }
    Ok(())
}
fn regular_dir(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Private runtime directory missing")?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err("Private runtime directory is a reparse point or non-directory".into());
    }
    Ok(())
}

pub(super) fn apply_private_acl(path: &Path) -> Result<(), String> {
    regular_dir(path)?;
    let descriptor = private_descriptor()?;
    let name = wide(path);
    let ok = unsafe {
        SetFileSecurityW(
            name.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor.0,
        )
    };
    if ok == 0 {
        return Err(format!(
            "Could not protect runtime directory ACL: {}",
            std::io::Error::last_os_error()
        ));
    }
    check_private_acl(path)
}

pub(super) fn check_private_acl(path: &Path) -> Result<(), String> {
    regular_dir(path)?;
    let name = wide(path);
    let mut needed = 0u32;
    unsafe {
        GetFileSecurityW(
            name.as_ptr(),
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            0,
            &mut needed,
        );
    }
    if !(20..=64 * 1024).contains(&needed) {
        return Err("Runtime directory DACL is not inspectable".into());
    }
    let mut buffer = vec![0u8; needed as usize];
    if unsafe {
        GetFileSecurityW(
            name.as_ptr(),
            DACL_SECURITY_INFORMATION,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    } == 0
    {
        return Err("Cannot inspect managed runtime DACL".into());
    }
    let expected = private_descriptor()?;
    protected_dacl(buffer.as_ptr().cast())?;
    if dacl_bytes(buffer.as_ptr().cast())? != dacl_bytes(expected.0)? {
        return Err("Runtime directory ACL differs from Clack's private allowlist".into());
    }
    Ok(())
}
