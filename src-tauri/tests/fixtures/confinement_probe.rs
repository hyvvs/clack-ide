//! Standalone deterministic fixture compiled by the native tests with rustc.
//! Never registered as a Clack custom tool or shipped as an app executable.
#![windows_subsystem = "windows"]
use std::fs;
use std::io::Write;
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args[1].as_str() {
        "file-id" => file_id_read(&args[2]),
        "runtime" => runtime_modules(),
        "sbox-files" => {
            let mut report = format!("allowed={}\n", fs::read_to_string("../input.txt").unwrap_or_default());
            for (index, path) in args[2..].iter().enumerate() {
                report.push_str(&format!("read{index}={}\n", fs::read(path).is_ok()));
            }
            fs::write("result.txt", report).unwrap();
        }
        "hardlink" => {
            println!("link={}", fs::hard_link(&args[2], "created-alias.txt").is_ok());
            println!("read={}", fs::read("created-alias.txt").is_ok());
        }
        "files" => {
            println!(
                "allowed={}",
                fs::read_to_string("../input.txt").unwrap_or_default()
            );
            println!("scratch={}", fs::write("ok.txt", "scratch").is_ok());
            println!(
                "readonly={}",
                fs::write("../input.txt", "overwrite").is_ok()
            );
            for (index, path) in args[2..].iter().enumerate() {
                println!("read{index}={}", fs::read(path).is_ok());
                println!(
                    "write{index}={}",
                    fs::OpenOptions::new().write(true).open(path).is_ok()
                );
            }
        }
        "env" => {
            let mut keys: Vec<_> = std::env::vars().map(|(key, _)| key).collect();
            keys.sort();
            println!("{}", keys.join(","));
            println!("lang={}", std::env::var("LANG").unwrap_or_default());
        }
        "network" => {
            for address in &args[2..] {
                let address: SocketAddr = address.parse().unwrap();
                println!(
                    "tcp={:?}",
                    TcpStream::connect_timeout(&address, Duration::from_millis(500))
                        .err()
                        .and_then(|e| e.raw_os_error())
                );
            }
            println!(
                "udp={:?}",
                UdpSocket::bind("0.0.0.0:0")
                    .and_then(|s| s.send_to(b"clack-native-test", "192.0.2.1:9"))
                    .err()
                    .and_then(|e| e.raw_os_error())
            );
        }
        "udp" => {
            for address in &args[2..] {
                let address: SocketAddr = address.parse().unwrap();
                let bind = if address.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
                println!("udp={:?}", UdpSocket::bind(bind).and_then(|socket| socket.send_to(b"clack-staged-egress-canary", address)).err().and_then(|e| e.raw_os_error()));
            }
        }
        "flood" => loop {
            let _ = std::io::stdout().write_all(&[b'o'; 4096]);
            let _ = std::io::stderr().write_all(&[b'e'; 4096]);
        },
        "child" | "tree" | "parent-exit" | "breakaway" | "grandchild" => {
            let mode = args[1].as_str();
            let flags = if mode == "breakaway" {
                0x01000000 | 0x00000008
            } else {
                0x08000000
            };
            let mut child = Command::new(std::env::current_exe().unwrap());
            child
                .arg(if mode == "grandchild" {
                    "sleep"
                } else {
                    "grandchild"
                })
                .creation_flags(flags);
            match child.spawn() {
                Ok(mut child) => {
                    println!("spawned={mode}");
                    if mode == "parent-exit" {
                        return;
                    }
                    let _ = child.wait();
                }
                Err(error) => println!("child-denied={:?}", error.raw_os_error()),
            }
        }
        "sleep" => {
            println!("sleeping");
            loop {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        "cpu" => loop {
            std::hint::black_box(42u64.wrapping_mul(43));
        },
        "memory" => {
            let mut memory = Vec::new();
            loop {
                memory.push(vec![7u8; 1024 * 1024]);
                std::hint::black_box(&memory);
            }
        }
        "job-broker" => job_broker(),
        _ => std::process::exit(9),
    }
}

fn file_id_read(id: &str) {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    struct Descriptor { size: u32, kind: u32, id: [u64; 2] }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenFileById(volume: *mut c_void, id: *const Descriptor, access: u32, sharing: u32, attributes: *const c_void, flags: u32) -> *mut c_void;
        fn ReadFile(handle: *mut c_void, buffer: *mut u8, length: u32, read: *mut u32, overlapped: *mut c_void) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    let input = fs::File::open("../input.txt").unwrap();
    let descriptor = Descriptor { size: std::mem::size_of::<Descriptor>() as u32, kind: 0, id: [id.parse().unwrap(), 0] };
    let handle = unsafe { OpenFileById(input.as_raw_handle(), &descriptor, 0x80000000, 1, std::ptr::null(), 0) };
    let mut byte = 0;
    let mut read = 0;
    let ok = !handle.is_null() && handle as isize != -1;
    let readable = ok && unsafe { ReadFile(handle, &mut byte, 1, &mut read, std::ptr::null_mut()) } != 0;
    if ok { unsafe { CloseHandle(handle); } }
    println!("file-id-readable={readable}");
}

fn runtime_modules() {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn K32EnumProcessModules(process: *mut c_void, modules: *mut *mut c_void, size: u32, needed: *mut u32) -> i32;
        fn GetModuleFileNameW(module: *mut c_void, path: *mut u16, size: u32) -> u32;
    }
    let _socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let mut modules = [std::ptr::null_mut(); 128];
    let mut needed = 0;
    assert_ne!(unsafe { K32EnumProcessModules(GetCurrentProcess(), modules.as_mut_ptr(), std::mem::size_of_val(&modules) as u32, &mut needed) }, 0);
    assert!(needed as usize <= std::mem::size_of_val(&modules));
    for module in &modules[..needed as usize / std::mem::size_of::<*mut c_void>()] {
        let mut path = [0u16; 32768];
        let n = unsafe { GetModuleFileNameW(*module, path.as_mut_ptr(), path.len() as u32) } as usize;
        assert!(n > 0 && n < path.len());
        println!("{}", String::from_utf16_lossy(&path[..n]));
    }
}

// A trusted, test-only broker isolates job-handle death from AppContainer profile
// cleanup. The existing LPAC tree fixture separately tests inherited confinement.
fn job_broker() {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    #[derive(Default)]
    struct Limits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working: usize,
        max_working: usize,
        processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: i32,
            info: *const c_void,
            size: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    }
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    assert!(!job.is_null());
    let limits = Limits {
        flags: 0x2000,
        ..Default::default()
    };
    assert_ne!(
        unsafe {
            SetInformationJobObject(
                job,
                9,
                (&limits as *const Limits).cast(),
                std::mem::size_of::<Limits>() as u32,
            )
        },
        0
    );
    let mut child = Command::new(std::env::current_exe().unwrap())
        .arg("sleep")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .unwrap();
    if unsafe { AssignProcessToJobObject(job, child.as_raw_handle()) } == 0 {
        let _ = child.kill();
        let _ = child.wait();
        panic!("job assignment failed");
    }
    println!("{}", child.id());
    std::io::stdout().flush().unwrap();
    loop {
        std::thread::sleep(Duration::from_millis(100));
    }
}
