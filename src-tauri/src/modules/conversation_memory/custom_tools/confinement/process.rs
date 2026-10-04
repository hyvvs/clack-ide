//! Execution-scoped Windows process ownership. No model/IPC entry point.
use super::{Children, Failure, Limits};
use std::ffi::OsStr;
use std::fs::File;
use std::io::{Read, Write};
use std::mem::{size_of, zeroed};
use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
use std::path::Path;
use std::ptr::{null, null_mut};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::Pipes::*;
use windows_sys::Win32::System::Threading::*;
#[cfg(test)]
use windows_sys::Win32::System::WindowsProgramming::PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
use windows_sys::Win32::System::WindowsProgramming::PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;

pub(super) enum Security<'a> {
    Psec(&'a super::psec::Environment),
    // Constructed only by the retained counterexample fixtures.
    #[cfg(test)]
    Lpac(&'a SECURITY_CAPABILITIES),
}
pub(super) struct Launch<'a> {
    pub executable: &'a Path,
    pub args: &'a [String],
    pub cwd: &'a Path,
    pub environment: &'a [u16],
    pub limits: &'a Limits,
    pub children: Children,
    pub security: Security<'a>,
    pub cancelled: &'a dyn Fn() -> bool,
}
type Result<T> = std::result::Result<T, Failure>;
pub(super) fn wide(s: impl AsRef<OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(Some(0)).collect()
}
#[track_caller]
pub(super) fn check(ok: i32) -> Result<()> {
    if ok == 0 {
        eprintln!(
            "native probe: Win32={} at {}",
            unsafe { GetLastError() },
            std::panic::Location::caller()
        );
        Err(Failure::Initialization)
    } else {
        Ok(())
    }
}
pub(super) struct Handle(pub(super) HANDLE);
impl Handle {
    pub(super) fn new(raw: HANDLE) -> Result<Self> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err(Failure::Initialization)
        } else {
            Ok(Self(raw))
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
pub(super) struct Attributes {
    storage: Vec<usize>,
    initialized: bool,
}
impl Attributes {
    pub(super) fn new(count: u32) -> Result<Self> {
        let mut size = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), count, 0, &mut size);
        }
        if size == 0 {
            return Err(Failure::Initialization);
        }
        let mut value = Self {
            storage: vec![0; size.div_ceil(size_of::<usize>())],
            initialized: false,
        };
        if unsafe { InitializeProcThreadAttributeList(value.ptr(), count, 0, &mut size) } == 0 {
            // DeleteProcThreadAttributeList requires successful initialization.
            return Err(Failure::Initialization);
        }
        value.initialized = true;
        Ok(value)
    }
    pub(super) fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.storage.as_mut_ptr().cast()
    }
    pub(super) fn add<T>(&mut self, kind: u32, value: &T) -> Result<()> {
        unsafe {
            check(UpdateProcThreadAttribute(
                self.ptr(),
                0,
                kind as usize,
                (value as *const T).cast(),
                size_of::<T>(),
                null_mut(),
                null(),
            ))
        }
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                DeleteProcThreadAttributeList(self.ptr());
            }
        }
    }
}

pub(super) fn run(launch: Launch<'_>) -> Result<Outcome> {
    let Launch {
        executable,
        args,
        cwd,
        environment: env,
        limits,
        children,
        security,
        cancelled,
    } = launch;
    let (out_read, out_write) = pipe()?;
    let (err_read, err_write) = pipe()?;
    let (in_read, in_write) = pipe()?;
    unsafe {
        check(SetHandleInformation(out_read.0, HANDLE_FLAG_INHERIT, 0))?;
        check(SetHandleInformation(err_read.0, HANDLE_FLAG_INHERIT, 0))?;
    }
    drop(in_write); // An explicit EOF, never the host terminal's input.
    let job = unsafe { Handle::new(CreateJobObjectW(null(), null()))? };
    let mut bounds: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    bounds.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_JOB_MEMORY
        | JOB_OBJECT_LIMIT_JOB_TIME;
    bounds.BasicLimitInformation.ActiveProcessLimit = limits.processes;
    bounds.BasicLimitInformation.PerJobUserTimeLimit = (limits.cpu_time_ms * 10_000) as i64;
    bounds.JobMemoryLimit = limits.memory_bytes;
    unsafe {
        check(SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&bounds as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of_val(&bounds) as u32,
        ))?;
    }
    let is_lpac = match security {
        Security::Psec(_) => false,
        #[cfg(test)]
        Security::Lpac(_) => true,
    };
    let mut attrs = Attributes::new(
        3 + u32::from(is_lpac) + u32::from(matches!(children, Children::Forbidden)),
    )?;
    let jobs = [job.0];
    let handles = [out_write.0, err_write.0, in_read.0];
    let no_child = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
    let security_environment = match security {
        Security::Psec(e) => Some(e.handle()),
        #[cfg(test)]
        Security::Lpac(_) => None,
    };
    match security {
        Security::Psec(_) => attrs.add(
            0x20023,
            security_environment
                .as_ref()
                .ok_or(Failure::Initialization)?,
        )?,
        #[cfg(test)]
        Security::Lpac(caps) => {
            attrs.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, caps)?;
            attrs.add(
                PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
                &PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT,
            )?;
        }
    }
    attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
    attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles)?;
    if matches!(children, Children::Forbidden) {
        attrs.add(PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY, &no_child)?;
    }
    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of_val(&startup) as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = in_read.0;
    startup.StartupInfo.hStdOutput = out_write.0;
    startup.StartupInfo.hStdError = err_write.0;
    startup.lpAttributeList = attrs.ptr();
    let mut command = wide(
        std::iter::once(executable.to_string_lossy().into_owned())
            .chain(args.iter().cloned())
            .map(|s| quote(&s))
            .collect::<Vec<_>>()
            .join(" "),
    );
    let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
    if cancelled() {
        return Err(Failure::Cancelled);
    }
    let ok = unsafe {
        CreateProcessW(
            wide(executable).as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT
                | CREATE_NO_WINDOW
                | CREATE_UNICODE_ENVIRONMENT
                | CREATE_SUSPENDED,
            env.as_ptr().cast(),
            wide(cwd).as_ptr(),
            &startup.StartupInfo,
            &mut info,
        )
    };
    if ok == 0 {
        eprintln!("native probe: CreateProcessW Win32={}", unsafe {
            GetLastError()
        });
        return Err(Failure::Spawn);
    }
    let process = Handle::new(info.hProcess)?;
    let thread = Handle::new(info.hThread)?;
    // PSEC can discard JOB_LIST: verify the actual suspended process, never
    // infer ownership from an empty job's accounting after termination.
    let mut member = 0;
    let owned = unsafe { IsProcessInJob(process.0, job.0, &mut member) } != 0 && member != 0;
    if !owned {
        eprintln!("native probe: JOB_LIST did not contain the suspended process");
        // Diagnostic-only repair. A broker crash before this assignment can
        // orphan a suspended process, so this is not production crash safety.
        let assigned = unsafe { AssignProcessToJobObject(job.0, process.0) } != 0;
        member = 0;
        if !assigned || unsafe { IsProcessInJob(process.0, job.0, &mut member) } == 0 || member == 0
        {
            unsafe {
                TerminateProcess(process.0, 1);
                WaitForSingleObject(process.0, 3000);
            }
            return Err(Failure::Initialization);
        }
    }
    if unsafe { ResumeThread(thread.0) } == u32::MAX {
        return Err(Failure::Spawn);
    }
    drop(thread);
    drop(out_write);
    drop(err_write);
    drop(in_read);
    let mut output = Vec::new();
    let started = Instant::now();
    let failure = loop {
        if cancelled() {
            break Some(Failure::Cancelled);
        }
        if started.elapsed() >= Duration::from_millis(limits.timeout_ms) {
            break Some(Failure::Timeout);
        }
        if drain(&out_read, &mut output, limits.output_bytes)?
            || drain(&err_read, &mut output, limits.output_bytes)?
        {
            break Some(Failure::OutputLimit);
        }
        if unsafe { WaitForSingleObject(process.0, 0) } == WAIT_OBJECT_0 {
            break None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let mut exit = 0;
    unsafe {
        check(GetExitCodeProcess(process.0, &mut exit))?;
    }
    // Always end the whole job, including when the parent exits first.
    let terminated = unsafe { TerminateJobObject(job.0, 1) } != 0;
    let cleanup_deadline = Instant::now() + Duration::from_secs(3);
    let cleaned = loop {
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        let ok = unsafe {
            QueryInformationJobObject(
                job.0,
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of_val(&accounting) as u32,
                null_mut(),
            )
        };
        if ok == 0 || !terminated {
            break false;
        }
        if accounting.ActiveProcesses == 0 {
            break unsafe { WaitForSingleObject(process.0, 3000) } == WAIT_OBJECT_0;
        }
        if Instant::now() >= cleanup_deadline {
            break false;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    // Drain at most the retained budget after exit. Pipe descendants cannot
    // stall a join: reads are limited by PeekNamedPipe and never wait for EOF.
    let overflow = drain_remaining(&out_read, &mut output, limits.output_bytes)?
        | drain_remaining(&err_read, &mut output, limits.output_bytes)?;
    Ok(Outcome {
        output,
        exit,
        failure: if !cleaned {
            Some(Failure::Cleanup)
        } else {
            failure
                .or(overflow.then_some(Failure::OutputLimit))
                .or((exit != 0).then_some(Failure::ForcedTermination))
        },
        cleaned,
    })
}
#[derive(Debug)]
pub(super) struct Outcome {
    pub output: Vec<u8>,
    pub exit: u32,
    pub failure: Option<Failure>,
    pub cleaned: bool,
}
fn pipe() -> Result<(Handle, Handle)> {
    let mut read = null_mut();
    let mut write = null_mut();
    let sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    unsafe {
        check(CreatePipe(&mut read, &mut write, &sa, 4096))?;
    }
    Ok((Handle::new(read)?, Handle::new(write)?))
}
fn drain_remaining(pipe: &Handle, output: &mut Vec<u8>, limit: usize) -> Result<bool> {
    loop {
        let before = output.len();
        if drain(pipe, output, limit)? {
            return Ok(true);
        }
        if output.len() == before {
            return Ok(false);
        }
    }
}
fn drain(pipe: &Handle, output: &mut Vec<u8>, limit: usize) -> Result<bool> {
    let mut available = 0;
    if unsafe {
        PeekNamedPipe(
            pipe.0,
            null_mut(),
            0,
            null_mut(),
            &mut available,
            null_mut(),
        )
    } == 0
    {
        return if unsafe { GetLastError() } == ERROR_BROKEN_PIPE {
            Ok(false)
        } else {
            Err(Failure::Cleanup)
        };
    }
    if available == 0 {
        return Ok(false);
    }
    let count = (available as usize).min(4096);
    let mut buffer = [0; 4096];
    // Borrow the handle without closing it; this is the sole reader.
    let mut file = std::mem::ManuallyDrop::new(unsafe { File::from_raw_handle(pipe.0) });
    let read = file
        .read(&mut buffer[..count])
        .map_err(|_| Failure::Cleanup)?;
    let retain = read.min(limit.saturating_sub(output.len()));
    output
        .write_all(&buffer[..retain])
        .map_err(|_| Failure::OutputLimit)?;
    Ok(retain != read)
}
pub(super) fn quote(value: &str) -> String {
    let mut output = String::from("\"");
    let mut slashes = 0;
    for c in value.chars() {
        if c == '\\' {
            slashes += 1;
            continue;
        }
        output.extend(std::iter::repeat_n(
            '\\',
            if c == '"' { slashes * 2 + 1 } else { slashes },
        ));
        output.push(c);
        slashes = 0;
    }
    output.extend(std::iter::repeat_n('\\', slashes * 2));
    output.push('"');
    output
}
