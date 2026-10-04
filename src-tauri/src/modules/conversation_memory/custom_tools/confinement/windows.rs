//! Native adversarial capability probe, NOT an enabled custom-tool runtime.
//! All grants are confined to newly owned temporary directories. A unique test
//! AppContainer profile is removed on drop; no firewall exclusion or user-folder
//! ACL is changed.
pub(super) use super::process::Outcome;
use super::process::{check, quote, wide, Attributes, Handle};
use super::{Children, Failure, Limits};
use std::ffi::c_void;
use std::fs::{self, File, OpenOptions};
use std::mem::zeroed;
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Authorization::*;
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile,
};
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
use windows_sys::Win32::System::Threading::*;

type Result<T> = std::result::Result<T, Failure>;
struct Sid(PSID);
impl Drop for Sid {
    fn drop(&mut self) {
        unsafe {
            FreeSid(self.0);
        }
    }
}
struct Local(*mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
struct Capability {
    groups: *mut PSID,
    group_count: u32,
    sids: *mut PSID,
    count: u32,
}
impl Capability {
    fn registry_read() -> Result<Self> {
        let mut c = Self {
            groups: null_mut(),
            group_count: 0,
            sids: null_mut(),
            count: 0,
        };
        unsafe {
            check(DeriveCapabilitySidsFromName(
                wide("registryRead").as_ptr(),
                &mut c.groups,
                &mut c.group_count,
                &mut c.sids,
                &mut c.count,
            ))?;
        }
        if c.count != 1 {
            return Err(Failure::Initialization);
        }
        Ok(c)
    }
}
impl Drop for Capability {
    fn drop(&mut self) {
        unsafe {
            for i in 0..self.group_count {
                LocalFree(*self.groups.add(i as usize));
            }
            for i in 0..self.count {
                LocalFree(*self.sids.add(i as usize));
            }
            LocalFree(self.groups.cast());
            LocalFree(self.sids.cast());
        }
    }
}
pub(super) fn acl(path: &Path, sid: &str, rights: &str) -> Result<()> {
    // Only the owner, SYSTEM and this one package receive access. No grant to
    // Everyone/ALL APPLICATION PACKAGES; low label enables scratch writes.
    let sddl = wide(format!(
        "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)(A;OICI;{rights};;;{sid})S:(ML;OICI;NW;;;LW)"
    ));
    let mut raw = null_mut();
    unsafe {
        check(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut raw,
            null_mut(),
        ))?;
        let descriptor = Local(raw);
        check(SetFileSecurityW(
            wide(path).as_ptr(),
            DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION
                | LABEL_SECURITY_INFORMATION,
            descriptor.0,
        ))
    }
}

struct Profile(Vec<u16>);
impl Drop for Profile {
    fn drop(&mut self) {
        let status = unsafe { DeleteAppContainerProfile(self.0.as_ptr()) };
        assert!(
            status >= 0,
            "native probe profile cleanup failed: {status:#x}"
        );
    }
}
pub(super) struct Capsule {
    sid: Sid,
    executable: File,
    _profile: Profile,
    // Drop the non-delete-sharing file BEFORE removing its containing directory.
    pub root: tempfile::TempDir,
}
impl Capsule {
    pub fn run_sbox(&self, args: &[String], version: &str) -> std::result::Result<Outcome, u32> {
        use windows_sys::Win32::System::LibraryLoader::{
            GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
        };
        type Create = unsafe extern "system" fn(
            *const u16,
            *mut u16,
            *const SECURITY_ATTRIBUTES,
            *const SECURITY_ATTRIBUTES,
            i32,
            u32,
            *const c_void,
            *const u16,
            *const STARTUPINFOW,
            *const u16,
            *const c_void,
            u32,
            *mut PROCESS_INFORMATION,
        ) -> i32;
        struct Library(HMODULE);
        impl Drop for Library {
            fn drop(&mut self) {
                unsafe {
                    FreeLibrary(self.0);
                }
            }
        }
        let library = Library(unsafe {
            LoadLibraryExW(
                wide("processmodel.dll").as_ptr(),
                null_mut(),
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            )
        });
        if library.0.is_null() {
            return Err(unsafe { GetLastError() });
        }
        let function = unsafe {
            GetProcAddress(
                library.0,
                c"Experimental_CreateProcessInSandbox".as_ptr().cast(),
            )
        }
        .ok_or(ERROR_NOT_SUPPORTED)?;
        let create: Create = unsafe { std::mem::transmute(function) };
        let specification = super::psec::legacy_specification(self.root.path(), version);
        let job = unsafe { Handle::new(CreateJobObjectW(null(), null())) }
            .map_err(|_| ERROR_INVALID_HANDLE)?;
        let mut bounds: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        bounds.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            check(SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&bounds as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of_val(&bounds) as u32,
            ))
        }
        .map_err(|_| ERROR_NOT_SUPPORTED)?;
        let mut attrs = Attributes::new(1).map_err(|_| ERROR_NOT_SUPPORTED)?;
        let jobs = [job.0];
        attrs
            .add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)
            .map_err(|_| ERROR_NOT_SUPPORTED)?;
        let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
        startup.StartupInfo.cb = size_of_val(&startup) as u32;
        startup.lpAttributeList = attrs.ptr();
        let executable = self.root.path().join("fixture.exe");
        let mut command = wide(
            std::iter::once(executable.to_string_lossy().into_owned())
                .chain(args.iter().cloned())
                .map(|s| quote(&s))
                .collect::<Vec<_>>()
                .join(" "),
        );
        let mut system = [0u16; 32768];
        let length =
            unsafe { GetWindowsDirectoryW(system.as_mut_ptr(), system.len() as u32) } as usize;
        if length == 0 || length >= system.len() {
            return Err(ERROR_INVALID_DATA);
        }
        let local = dirs::data_local_dir().ok_or(ERROR_INVALID_DATA)?;
        let env = wide(format!(
            "LOCALAPPDATA={}\0SystemRoot={}\0",
            local.display(),
            String::from_utf16_lossy(&system[..length])
        ));
        let identity = wide(self.root.path().file_name().unwrap());
        let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
        let ok = unsafe {
            create(
                wide(&executable).as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                0,
                EXTENDED_STARTUPINFO_PRESENT
                    | CREATE_NO_WINDOW
                    | CREATE_UNICODE_ENVIRONMENT
                    | CREATE_SUSPENDED,
                env.as_ptr().cast(),
                wide(self.root.path().join("scratch")).as_ptr(),
                &startup.StartupInfo,
                identity.as_ptr(),
                specification.as_ptr().cast(),
                specification.len() as u32,
                &mut info,
            )
        };
        if ok == 0 {
            return Err(unsafe { GetLastError() });
        }
        let process = Handle::new(info.hProcess).map_err(|_| ERROR_INVALID_HANDLE)?;
        let thread = Handle::new(info.hThread).map_err(|_| ERROR_INVALID_HANDLE)?;
        if unsafe { ResumeThread(thread.0) } == u32::MAX {
            return Err(unsafe { GetLastError() });
        }
        let waited = unsafe { WaitForSingleObject(process.0, 5000) };
        let mut exit = 0;
        unsafe {
            GetExitCodeProcess(process.0, &mut exit);
            TerminateJobObject(job.0, 1);
        }
        let cleaned = unsafe { WaitForSingleObject(process.0, 3000) } == WAIT_OBJECT_0;
        let output =
            fs::read(self.root.path().join("scratch").join("result.txt")).unwrap_or_default();
        Ok(Outcome {
            output,
            exit,
            failure: (waited != WAIT_OBJECT_0).then_some(Failure::Timeout),
            cleaned,
        })
    }
    pub fn new(executable: &[u8]) -> Result<Self> {
        let root = tempfile::Builder::new()
            .prefix("clack-confinement-")
            .tempdir()
            .map_err(|_| Failure::Initialization)?;
        let name = wide(root.path().file_name().ok_or(Failure::Initialization)?);
        let mut raw = null_mut();
        let status = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                name.as_ptr(),
                name.as_ptr(),
                null(),
                0,
                &mut raw,
            )
        };
        if status < 0 {
            eprintln!("native probe: CreateAppContainerProfile HRESULT={status:#x}");
            return Err(Failure::Initialization);
        }
        let profile = Profile(name);
        let sid = Sid(raw);
        let mut text = null_mut();
        unsafe {
            check(ConvertSidToStringSidW(sid.0, &mut text))?;
        }
        let owned = Local(text.cast());
        let mut length = 0;
        unsafe {
            while *text.add(length) != 0 {
                length += 1;
            }
        }
        let text = unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(text, length)) };
        drop(owned);
        acl(root.path(), &text, "GRGX")?;
        let target = root.path().join("fixture.exe");
        fs::write(&target, executable).map_err(|_| Failure::Initialization)?;
        acl(&target, &text, "GRGX")?;
        fs::create_dir(root.path().join("scratch")).map_err(|_| Failure::Initialization)?;
        acl(&root.path().join("scratch"), &text, "GRGW")?;
        fs::write(root.path().join("input.txt"), "allowed input")
            .map_err(|_| Failure::Initialization)?;
        acl(&root.path().join("input.txt"), &text, "GR")?;
        // Deny write/delete sharing throughout execution, not just a preflight hash.
        let executable = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&target)
            .map_err(|_| Failure::ExecutableChanged)?;
        Ok(Self {
            sid,
            executable,
            _profile: profile,
            root,
        })
    }

    pub fn run(
        &self,
        args: &[String],
        limits: &Limits,
        children: Children,
        cancel: &AtomicBool,
    ) -> Result<Outcome> {
        self.run_inner(args, limits, children, cancel, None)
    }

    pub fn run_psec(
        &self,
        args: &[String],
        limits: &Limits,
        children: Children,
        cancel: &AtomicBool,
        deny: &Path,
    ) -> Result<Outcome> {
        let environment =
            super::psec::Environment::create(self.root.path(), deny).map_err(|hr| {
                eprintln!("PSEC creation: {hr:#x}");
                Failure::Initialization
            })?;
        self.run_inner(args, limits, children, cancel, Some(&environment))
    }

    pub fn run_staged(
        &self,
        args: &[String],
        limits: &Limits,
        children: Children,
        cancel: &AtomicBool,
    ) -> Result<Outcome> {
        let environment = super::psec::Environment::create_drive_only_probe(self.root.path())
            .map_err(|hr| {
                eprintln!("Staged PSEC creation: {hr:#x}");
                Failure::Initialization
            })?;
        self.run_inner(args, limits, children, cancel, Some(&environment))
    }

    pub fn run_namespace(&self, args: &[String], roots: &[std::path::PathBuf]) -> Result<Outcome> {
        let environment = super::psec::Environment::probe_namespace(self.root.path(), roots)
            .map_err(|_| Failure::Initialization)?;
        self.run_inner(
            args,
            &super::tests::limits(),
            Children::Forbidden,
            &AtomicBool::new(false),
            Some(&environment),
        )
    }

    fn run_inner(
        &self,
        args: &[String],
        limits: &Limits,
        children: Children,
        cancel: &AtomicBool,
        environment: Option<&super::psec::Environment>,
    ) -> Result<Outcome> {
        let _pin = &self.executable;
        let registry = Capability::registry_read()?;
        let mut cap = SID_AND_ATTRIBUTES {
            Sid: unsafe { *registry.sids },
            Attributes: 4,
        };
        let security = SECURITY_CAPABILITIES {
            AppContainerSid: self.sid.0,
            Capabilities: &mut cap,
            CapabilityCount: 1,
            Reserved: 0,
        };
        let mut system = [0u16; 32768];
        let length =
            unsafe { GetWindowsDirectoryW(system.as_mut_ptr(), system.len() as u32) } as usize;
        if length == 0 || length >= system.len() {
            return Err(Failure::Initialization);
        }
        let scratch = self.root.path().join("scratch");
        let local = dirs::data_local_dir().ok_or(Failure::Initialization)?;
        let env = wide(format!(
            "LANG=C\0LOCALAPPDATA={}\0SystemRoot={}\0TEMP={}\0TMP={}\0",
            local.display(),
            String::from_utf16_lossy(&system[..length]),
            scratch.display(),
            scratch.display()
        ));
        super::process::run(super::process::Launch {
            executable: &self.root.path().join("fixture.exe"),
            args,
            cwd: &scratch,
            environment: &env,
            limits,
            children,
            security: environment.map_or(
                super::process::Security::Lpac(&security),
                super::process::Security::Psec,
            ),
            cancelled: &|| cancel.load(Ordering::Acquire),
        })
    }
}
