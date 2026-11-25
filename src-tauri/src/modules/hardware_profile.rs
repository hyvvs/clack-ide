//! LM3: bounded, read-only, unprivileged host observation. A missing driver,
//! GPU inventory or memory API is UNKNOWN, never proof of absence.
//! The response is ephemeral: the existing ComputeHost is the identity owner.
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Observed<T> {
    pub value: T,
    pub source: &'static str,
    pub observed_at: u64,
}

#[cfg(windows)]
impl<T> Observed<T> {
    fn new(value: T, source: &'static str, observed_at: u64) -> Self {
        Self {
            value,
            source,
            observed_at,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeGpuObservation {
    pub device_id: Option<Observed<String>>,
    pub vendor: Option<Observed<String>>,
    pub model: Option<Observed<String>>,
    pub total_vram_bytes: Option<Observed<u64>>,
    pub available_vram_bytes: Option<Observed<u64>>,
    pub driver_version: Option<Observed<String>>,
    pub compute_architecture: Option<Observed<String>>,
    /// True only for an explicit vendor-reported CUDA compute capability,
    /// NOT permission or proof of installed llama.cpp CUDA execution.
    pub cuda_hardware_capable: Option<Observed<bool>>,
}

#[cfg(windows)]
impl NativeGpuObservation {
    fn empty() -> Self {
        Self {
            device_id: None,
            vendor: None,
            model: None,
            total_vram_bytes: None,
            available_vram_bytes: None,
            driver_version: None,
            compute_architecture: None,
            cuda_hardware_capable: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHardwareObservation {
    pub os: &'static str,
    pub architecture: &'static str,
    pub logical_processors: Option<usize>,
    pub logical_processors_source: &'static str,
    pub cpu_manufacturer: Option<Observed<String>>,
    pub cpu_model: Option<Observed<String>>,
    pub physical_cores: Option<Observed<usize>>,
    pub total_ram_bytes: Option<u64>,
    pub available_ram_bytes: Option<u64>,
    pub observed_at: u64,
    pub source: &'static str,
    pub gpus: Vec<NativeGpuObservation>,
    // True only when the OS display-adapter inventory completed; vendor
    // compute devices are supplemental and never imply full GPU enumeration.
    pub gpu_inventory_complete: bool,
}

#[cfg(windows)]
mod windows_telemetry {
    use super::{millis, NativeGpuObservation, Observed};
    use std::{
        io::Read,
        os::windows::process::CommandExt,
        path::PathBuf,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::System::{
        Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
        SystemInformation::{
            GetLogicalProcessorInformationEx, GetSystemDirectoryW, RelationProcessorCore,
            SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
        },
        Threading::{GetActiveProcessorCount, ALL_PROCESSOR_GROUPS},
    };
    const CPU_REGISTRY: &str = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0";
    const WINDOWS_CPU: &str = "windows-registry-cpu-identity";
    const WINDOWS_TOPOLOGY: &str = "windows-kernel-processor-topology";
    const WINDOWS_DISPLAY: &str = "windows-cim-win32-videocontroller";
    const NVIDIA_SMI: &str = "system32-nvidia-smi-readonly-vendor-telemetry";
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn cpu_registry(key: &str) -> Option<String> {
        let path = wide(CPU_REGISTRY);
        let name = wide(key);
        let mut size = 0u32;
        if unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                path.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        } != 0
            || !(2..=2048).contains(&size)
            || !size.is_multiple_of(2)
        {
            return None;
        }
        let mut buffer = vec![0u16; size as usize / 2];
        if unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                path.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        } != 0
            || size < 2
            || size as usize > buffer.len() * 2
        {
            return None;
        }
        let end = buffer.iter().position(|c| *c == 0)?;
        let value = String::from_utf16(&buffer[..end]).ok()?;
        let value = value.trim();
        (!value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control))
            .then(|| value.to_owned())
    }

    /// Every RelationProcessorCore entry represents one physical core.
    /// Never derive cores by dividing logical processors by a guessed SMT factor.
    fn physical_cores() -> Option<usize> {
        let mut bytes = 0u32;
        unsafe {
            GetLogicalProcessorInformationEx(
                RelationProcessorCore,
                std::ptr::null_mut(),
                &mut bytes,
            );
        }
        if !(8..=4 * 1024 * 1024).contains(&bytes) {
            return None;
        }
        // Aligned storage: Windows requires native structure alignment.
        let mut storage = vec![0u64; (bytes as usize).div_ceil(8)];
        if unsafe {
            GetLogicalProcessorInformationEx(
                RelationProcessorCore,
                storage
                    .as_mut_ptr()
                    .cast::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(),
                &mut bytes,
            )
        } == 0
        {
            return None;
        }
        let mut offset = 0usize;
        let mut count = 0usize;
        let raw =
            unsafe { std::slice::from_raw_parts(storage.as_ptr().cast::<u8>(), bytes as usize) };
        while offset < bytes as usize {
            if bytes as usize - offset < 8 {
                return None;
            }
            // Variable-sized records are not guaranteed to have each field
            // at a naturally aligned address. Decode the fixed 8-byte header.
            let relationship = i32::from_le_bytes(raw[offset..offset + 4].try_into().ok()?);
            let size = u32::from_le_bytes(raw[offset + 4..offset + 8].try_into().ok()?) as usize;
            if size < 8 || size > bytes as usize - offset || relationship != RelationProcessorCore {
                return None;
            }
            count += 1;
            offset += size;
        }
        (count > 0 && count <= 65_536).then_some(count)
    }

    type CpuObservation = (
        Option<Observed<String>>,
        Option<Observed<String>>,
        Option<Observed<usize>>,
        Option<usize>,
        &'static str,
    );

    pub(super) fn cpu() -> CpuObservation {
        let now = millis();
        let logical = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) } as usize;
        let logical = (logical > 0 && logical <= 65_536).then_some(logical);
        let physical =
            physical_cores().filter(|count| logical.is_none_or(|logical| *count <= logical));
        (
            cpu_registry("VendorIdentifier").map(|v| Observed::new(v, WINDOWS_CPU, now)),
            cpu_registry("ProcessorNameString").map(|v| Observed::new(v, WINDOWS_CPU, now)),
            physical.map(|v| Observed::new(v, WINDOWS_TOPOLOGY, now)),
            logical,
            WINDOWS_TOPOLOGY,
        )
    }

    fn system_directory() -> Option<PathBuf> {
        let mut buffer = [0u16; 520];
        let n = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
        (n > 0 && n < buffer.len()).then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..n])))
    }

    /// Fixed system-owned executable, fixed read-only arguments, no shell,
    /// no PATH lookup, bounded time/output. Failure is Missing, not zero VRAM.
    fn bounded_system_command(exe: PathBuf, args: &[&str]) -> Option<String> {
        if !exe.is_file() {
            return None;
        }
        let mut child = Command::new(exe)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .ok()?;
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return None;
                    }
                    let mut bytes = Vec::new();
                    child
                        .stdout
                        .take()?
                        .take(64 * 1024 + 1)
                        .read_to_end(&mut bytes)
                        .ok()?;
                    if bytes.len() > 64 * 1024 {
                        return None;
                    }
                    return String::from_utf8(bytes).ok();
                }
                Ok(None) if start.elapsed() < Duration::from_secs(8) => {
                    thread::sleep(Duration::from_millis(30))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
    }

    #[derive(Debug)]
    struct VendorGpu {
        uuid: String,
        model: String,
        total: Option<u64>,
        free: Option<u64>,
        driver: Option<String>,
        compute: Option<String>,
    }

    /// nvidia-smi reports MiB, not trustworthy bytes from Win32 AdapterRAM.
    /// Each independent vendor field is evidence only if validated; a missing
    /// free reading must not erase a reliable total (or CUDA capability).
    fn parse_nvidia_csv(csv: &str) -> Vec<VendorGpu> {
        let mut rows = Vec::new();
        for line in csv.lines().take(17) {
            let fields = line.split(',').map(str::trim).collect::<Vec<_>>();
            if fields.len() != 7 {
                continue;
            }
            let [index, uuid, model, total, free, driver, compute] = [
                fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6],
            ];
            if index.parse::<usize>().ok().filter(|n| *n < 16).is_none()
                || !uuid.starts_with("GPU-")
                || uuid.len() > 96
                || model.is_empty()
                || model.len() > 256
                || driver.len() > 64
                || compute.len() > 32
            {
                continue;
            }
            let total_mib = total
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0 && *n <= 4 * 1024 * 1024);
            let total = total_mib.and_then(|n| n.checked_mul(1024 * 1024));
            // Without a verified total, current free cannot be bounded safely.
            let free = total_mib.and_then(|max| {
                free.parse::<u64>()
                    .ok()
                    .filter(|n| *n <= max)
                    .and_then(|n| n.checked_mul(1024 * 1024))
            });
            let compute = compute.split_once('.').and_then(|(major, minor)| {
                (major.parse::<u16>().ok().is_some_and(|n| n > 0)
                    && minor.parse::<u16>().is_ok()
                    && minor.len() <= 3)
                    .then(|| compute.to_owned())
            });
            rows.push(VendorGpu {
                uuid: uuid.to_owned(),
                model: model.to_owned(),
                total,
                free,
                driver: (!driver.is_empty() && !driver.eq_ignore_ascii_case("N/A"))
                    .then(|| driver.to_owned()),
                compute,
            });
        }
        rows
    }

    fn vendor_gpus() -> Vec<VendorGpu> {
        let Some(system) = system_directory() else {
            return vec![];
        };
        let args = [
            "--query-gpu=index,uuid,name,memory.total,memory.free,driver_version,compute_cap",
            "--format=csv,noheader,nounits",
        ];
        bounded_system_command(system.join("nvidia-smi.exe"), &args)
            .map(|raw| parse_nvidia_csv(&raw))
            .unwrap_or_default()
    }

    pub(super) fn process_vram_bytes(pid: u32) -> Option<u64> {
        let system = system_directory()?;
        let response = bounded_system_command(system.join("nvidia-smi.exe"), &[
            "--query-compute-apps=pid,used_gpu_memory", "--format=csv,noheader,nounits",
        ])?;
        let mut exact = response.lines().filter_map(|line| {
            let (process, mib) = line.split_once(',')?;
            (process.trim().parse::<u32>().ok()? == pid).then(|| {
                mib.trim().parse::<u64>().ok()
                    .filter(|bytes| *bytes <= 4 * 1024 * 1024)
                    .and_then(|mib| mib.checked_mul(1024 * 1024))
            }).flatten()
        });
        let first = exact.next()?;
        (exact.next().is_none()).then_some(first)
    }

    fn vendor_name(pnp: &str) -> Option<&'static str> {
        let pnp = pnp.to_ascii_uppercase();
        if pnp.contains("VEN_10DE") {
            Some("NVIDIA")
        } else if pnp.contains("VEN_1002") {
            Some("AMD")
        } else if pnp.contains("VEN_8086") {
            Some("Intel")
        } else {
            None
        }
    }

    fn display_gpu(raw: &serde_json::Value, at: u64) -> Option<NativeGpuObservation> {
        let object = raw.as_object()?;
        let text = |field: &str| {
            object
                .get(field)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
                .map(str::to_owned)
        };
        let id = text("PNPDeviceID");
        let model = text("Name");
        if id.is_none() && model.is_none() {
            return None;
        }
        Some(NativeGpuObservation {
            device_id: id
                .as_ref()
                .map(|v| Observed::new(v.clone(), WINDOWS_DISPLAY, at)),
            vendor: id
                .as_deref()
                .and_then(vendor_name)
                .map(|v| Observed::new(v.to_owned(), WINDOWS_DISPLAY, at)),
            model: model.map(|v| Observed::new(v, WINDOWS_DISPLAY, at)),
            driver_version: text("DriverVersion").map(|v| Observed::new(v, WINDOWS_DISPLAY, at)),
            ..NativeGpuObservation::empty()
        })
    }

    fn parse_display_json(json: &str, at: u64) -> Option<Vec<NativeGpuObservation>> {
        let raw: serde_json::Value =
            serde_json::from_str(json.trim_start_matches('\u{feff}')).ok()?;
        let rows = raw.as_array()?;
        if rows.len() > 32 {
            return None;
        }
        Some(rows.iter().filter_map(|v| display_gpu(v, at)).collect())
    }

    fn os_display_gpus() -> Option<Vec<NativeGpuObservation>> {
        let sys = system_directory()?;
        let script = r#"ConvertTo-Json -InputObject @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | Select-Object PNPDeviceID,Name,DriverVersion) -Compress -Depth 3"#;
        let content = bounded_system_command(
            sys.join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
        )?;
        parse_display_json(&content, millis())
    }

    /// Vendor UUID/VRAM can be associated with a display adapter only when
    /// its model is unique across both inventories. Duplicate models remain
    /// separate/unknown rather than guessing bus or adapter identity.
    fn merge_vendor(
        mut gpus: Vec<NativeGpuObservation>,
        vendors: Vec<VendorGpu>,
        at: u64,
    ) -> Vec<NativeGpuObservation> {
        // Multiple vendor devices with an identical model cannot be mapped to
        // individual display adapters by model name alone.
        let vendor_models = vendors.iter().map(|v| v.model.clone()).collect::<Vec<_>>();
        for vendor in vendors {
            let matching: Vec<usize> = gpus
                .iter()
                .enumerate()
                .filter_map(|(i, gpu)| {
                    (gpu.vendor.as_ref().is_some_and(|v| v.value == "NVIDIA")
                        && gpu.model.as_ref().is_some_and(|m| m.value == vendor.model))
                    .then_some(i)
                })
                .collect();
            let duplicates = gpus
                .iter()
                .filter(|gpu| gpu.model.as_ref().is_some_and(|m| m.value == vendor.model))
                .count();
            let idx = if matching.len() == 1
                && duplicates == 1
                && vendor_models
                    .iter()
                    .filter(|name| name.as_str() == vendor.model)
                    .count()
                    == 1
                && gpus[matching[0]].total_vram_bytes.is_none()
            {
                matching[0]
            } else {
                gpus.push(NativeGpuObservation::empty());
                gpus.len() - 1
            };
            let gpu = &mut gpus[idx];
            gpu.device_id = Some(Observed::new(vendor.uuid, NVIDIA_SMI, at));
            gpu.vendor = Some(Observed::new("NVIDIA".into(), NVIDIA_SMI, at));
            gpu.model = Some(Observed::new(vendor.model, NVIDIA_SMI, at));
            gpu.total_vram_bytes = vendor.total.map(|n| Observed::new(n, NVIDIA_SMI, at));
            gpu.available_vram_bytes = vendor.free.map(|n| Observed::new(n, NVIDIA_SMI, at));
            if let Some(driver) = vendor.driver {
                gpu.driver_version = Some(Observed::new(driver, NVIDIA_SMI, at));
            }
            if let Some(compute) = vendor.compute {
                gpu.compute_architecture = Some(Observed::new(
                    format!("CUDA compute capability {compute}"),
                    NVIDIA_SMI,
                    at,
                ));
                gpu.cuda_hardware_capable = Some(Observed::new(true, NVIDIA_SMI, at));
            }
        }
        gpus.truncate(32);
        gpus
    }

    pub(super) fn gpu() -> (Vec<NativeGpuObservation>, bool) {
        let display = os_display_gpus();
        let complete = display.is_some();
        let vendor = vendor_gpus();
        (
            merge_vendor(display.unwrap_or_default(), vendor, millis()),
            complete,
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn os_cpu_model_and_physical_core_count_are_independent() {
            let (vendor, model, physical, logical, source) = cpu();
            assert_eq!(source, WINDOWS_TOPOLOGY);
            assert!(vendor.is_none_or(|v| !v.value.is_empty()));
            assert!(model.is_none_or(|v| !v.value.is_empty()));
            assert!(physical.as_ref().is_none_or(|p| p.value > 0));
            if let (Some(p), Some(l)) = (physical, logical) {
                assert!(p.value <= l);
            }
        }

        #[test]
        fn measured_nvidia_vram_has_valid_units_and_refuses_bogus_free_memory() {
            let parsed = parse_nvidia_csv("0, GPU-123456, NVIDIA GPU, 16303, 13000, 616.92, 12.0");
            assert_eq!(parsed.len(), 1);
            assert_eq!(parsed[0].total, Some(16303 * 1024 * 1024));
            assert_eq!(parsed[0].free, Some(13000 * 1024 * 1024));

            for free in ["N/A", "9000", "not-a-number"] {
                let input = format!("0, GPU-123456, NVIDIA GPU, 8192, {free}, 616.92, 12.0");
                let rows = parse_nvidia_csv(&input);
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].total, Some(8192 * 1024 * 1024));
                assert_eq!(rows[0].free, None);
                assert_eq!(rows[0].compute.as_deref(), Some("12.0"));
                let merged = merge_vendor(vec![], rows, 100);
                assert_eq!(
                    merged[0].total_vram_bytes.as_ref().unwrap().value,
                    8192 * 1024 * 1024
                );
                assert!(merged[0].available_vram_bytes.is_none());
                assert_eq!(
                    merged[0].total_vram_bytes.as_ref().unwrap().source,
                    NVIDIA_SMI
                );
                assert!(merged[0].cuda_hardware_capable.as_ref().unwrap().value);
            }
            let missing_total =
                parse_nvidia_csv("0, GPU-123456, NVIDIA GPU, N/A, 5000, 616.92, 12.0");
            assert_eq!(missing_total.len(), 1);
            assert_eq!(missing_total[0].total, None);
            assert_eq!(missing_total[0].free, None);
            let vendor_without_driver_or_compute =
                parse_nvidia_csv("0, GPU-123456, NVIDIA GPU, 8192, N/A, N/A, N/A");
            let merged = merge_vendor(vec![], vendor_without_driver_or_compute, 100);
            assert_eq!(
                merged[0].total_vram_bytes.as_ref().unwrap().value,
                8192 * 1024 * 1024
            );
            assert!(merged[0].driver_version.is_none());
            assert!(merged[0].compute_architecture.is_none());
            assert!(merged[0].cuda_hardware_capable.is_none());
        }

        #[test]
        fn display_inventory_includes_multiple_devices_without_inventing_adapter_vram() {
            let json = r#"[{"PNPDeviceID":"PCI\\VEN_10DE&DEV_1234","Name":"NVIDIA GPU","DriverVersion":"1.2"},{"PNPDeviceID":"PCI\\VEN_1002&DEV_4321","Name":"AMD GPU","DriverVersion":"2.3"},{"PNPDeviceID":"ROOT\\DISPLAY","Name":"Virtual Display","DriverVersion":"3.4"}]"#;
            let rows = parse_display_json(json, 100).unwrap();
            assert_eq!(rows.len(), 3);
            assert!(rows
                .iter()
                .all(|v| v.total_vram_bytes.is_none() && v.available_vram_bytes.is_none()));
            assert_eq!(rows[1].vendor.as_ref().unwrap().value, "AMD");
            assert!(rows[2].vendor.is_none());
        }

        #[test]
        fn vendor_failure_and_ambiguous_duplicate_models_do_not_fabricate_memory() {
            let json = r#"[{"PNPDeviceID":"PCI\\VEN_10DE","Name":"NVIDIA GPU"},{"PNPDeviceID":"PCI\\VEN_10DE","Name":"NVIDIA GPU"}]"#;
            let rows = parse_display_json(json, 100).unwrap();
            let missing = merge_vendor(rows.clone(), vec![], 100);
            assert!(missing.iter().all(|v| v.total_vram_bytes.is_none()));
            let found = merge_vendor(
                rows,
                parse_nvidia_csv("0, GPU-123456, NVIDIA GPU, 16000, 12000, 616.92, 12.0"),
                100,
            );
            assert_eq!(found.len(), 3);
            assert!(found[0].total_vram_bytes.is_none() && found[1].total_vram_bytes.is_none());
            assert_eq!(
                found[2].total_vram_bytes.as_ref().unwrap().value,
                16000 * 1024 * 1024
            );

            // A single display record cannot be paired to either of two
            // identical vendor model names without additional bus identity.
            let one_display = parse_display_json(
                r#"[{"PNPDeviceID":"PCI\\VEN_10DE","Name":"NVIDIA GPU"}]"#,
                100,
            )
            .unwrap();
            let two_vendors = parse_nvidia_csv("0, GPU-a, NVIDIA GPU, 16000, 12000, 616.92, 12.0\n1, GPU-b, NVIDIA GPU, 12000, 10000, 616.92, 12.0");
            let merged = merge_vendor(one_display, two_vendors, 100);
            assert_eq!(merged.len(), 3);
            assert!(merged[0].total_vram_bytes.is_none());
            assert_eq!(
                merged[1].total_vram_bytes.as_ref().unwrap().value,
                16000 * 1024 * 1024
            );
            assert_eq!(
                merged[2].total_vram_bytes.as_ref().unwrap().value,
                12000 * 1024 * 1024
            );
        }
    }
}

#[cfg(windows)]
fn physical_memory() -> (Option<u64>, Option<u64>) {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return (None, None);
    }
    (Some(status.ullTotalPhys), Some(status.ullAvailPhys))
}

#[cfg(target_os = "linux")]
fn physical_memory() -> (Option<u64>, Option<u64>) {
    let Ok(contents) = std::fs::read_to_string("/proc/meminfo") else {
        return (None, None);
    };
    let field = |key: &str| {
        contents.lines().find_map(|line| {
            let rest = line.strip_prefix(key)?.trim();
            let kb = rest.strip_suffix("kB")?.trim().parse::<u64>().ok()?;
            kb.checked_mul(1024)
        })
    };
    (field("MemTotal:"), field("MemAvailable:"))
}

#[cfg(not(any(windows, target_os = "linux")))]
fn physical_memory() -> (Option<u64>, Option<u64>) {
    (None, None)
}

#[tauri::command]
pub fn local_hardware_observation() -> LocalHardwareObservation {
    let (total, available) = physical_memory();
    #[cfg(windows)]
    let (
        cpu_manufacturer,
        cpu_model,
        physical_cores,
        logical_processors,
        logical_processors_source,
    ) = windows_telemetry::cpu();
    #[cfg(not(windows))]
    let (
        cpu_manufacturer,
        cpu_model,
        physical_cores,
        logical_processors,
        logical_processors_source,
    ) = (None, None, None, None, "No verified native core topology");
    #[cfg(windows)]
    let (gpus, gpu_inventory_complete) = windows_telemetry::gpu();
    #[cfg(not(windows))]
    let (gpus, gpu_inventory_complete) = (Vec::new(), false);
    LocalHardwareObservation {
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        logical_processors,
        logical_processors_source,
        cpu_manufacturer,
        cpu_model,
        physical_cores,
        total_ram_bytes: total,
        available_ram_bytes: available.filter(|value| total.is_some_and(|max| *value <= max)),
        observed_at: millis(),
        source: "native-os-readonly",
        gpus,
        gpu_inventory_complete,
    }
}

/// Admission uses the SAME LM3–LM5 native host observation as the UI. An OS
/// display adapter alone is never CUDA execution support. The source UUID is
/// stable across enumeration order and is the only selectable GPU identity.
pub fn cuda_device_for_request(device_id: &str) -> Result<NativeGpuObservation, String> {
    let uuid = device_id.strip_prefix("clack-this-pc:accelerator:")
        .ok_or("CUDA request must name a canonical host-scoped GPU device")?;
    if !uuid.starts_with("GPU-") || uuid.len() > 96 {
        return Err("CUDA GPU UUID is invalid".into());
    }
    let found: Vec<_> = local_hardware_observation().gpus.into_iter().filter(|gpu| {
        gpu.device_id.as_ref().is_some_and(|id| id.value == uuid)
    }).collect();
    if found.len() != 1 {
        return Err("Requested NVIDIA CUDA device is absent or ambiguous".into());
    }
    let gpu = found.into_iter().next().unwrap();
    if gpu.vendor.as_ref().is_none_or(|vendor| vendor.value != "NVIDIA") ||
       gpu.cuda_hardware_capable.as_ref().is_none_or(|cap| !cap.value) ||
       gpu.compute_architecture.is_none() {
        return Err("Requested NVIDIA device has no verified CUDA compute capability".into());
    }
    Ok(gpu)
}

/// Supplemental WDDM-safe process telemetry: failure/"N/A" is UNKNOWN, never
/// synthesized from whole-GPU memory. Shares bounded System32 vendor probe.
#[cfg(windows)]
pub fn cuda_process_vram_bytes(pid: u32) -> Option<u64> {
    windows_telemetry::process_vram_bytes(pid)
}
#[cfg(not(windows))]
pub fn cuda_process_vram_bytes(_pid: u32) -> Option<u64> { None }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_memory_observation_never_claims_gpu_inventory() {
        let observed = local_hardware_observation();
        assert_eq!(observed.source, "native-os-readonly");
        assert!(observed.gpus.len() <= 32);
        assert!(observed.logical_processors.is_none_or(|count| count > 0));
        if let (Some(total), Some(available)) =
            (observed.total_ram_bytes, observed.available_ram_bytes)
        {
            assert!(total > 0 && available <= total);
        }
    }

    #[cfg(windows)]
    #[test]
    fn native_profile_can_be_observed_without_runtime_launch_or_configuration() {
        let snapshot = local_hardware_observation();
        let json = serde_json::to_string(&snapshot).expect("serializable native evidence");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["source"], "native-os-readonly");
        assert!(
            parsed["physicalCores"].is_null()
                || parsed["physicalCores"]["source"] == "windows-kernel-processor-topology"
        );
        assert!(parsed["gpus"].as_array().is_some());
        println!("LM3_NATIVE_HARDWARE_READONLY={json}");
    }
}
