//! LM3: bounded, read-only, unprivileged host observation. A missing driver,
//! GPU inventory or memory API is UNKNOWN, never proof of absence.
//! The response is ephemeral: the existing ComputeHost is the identity owner.
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHardwareObservation {
    pub os: &'static str,
    pub architecture: &'static str,
    pub logical_processors: Option<usize>,
    pub total_ram_bytes: Option<u64>,
    pub available_ram_bytes: Option<u64>,
    pub observed_at: u64,
    pub source: &'static str,
    // No GPU/VRAM/driver field is inferred from CPU capability or a display
    // adapter name. A future trusted, nonprivileged adapter can add those.
    pub gpu_inventory_complete: bool,
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
    LocalHardwareObservation {
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        logical_processors: std::thread::available_parallelism().ok().map(|n| n.get()),
        total_ram_bytes: total,
        available_ram_bytes: available.filter(|value| total.is_some_and(|max| *value <= max)),
        observed_at: SystemTime::now().duration_since(UNIX_EPOCH)
            .unwrap_or_default().as_millis().min(u64::MAX as u128) as u64,
        source: "native-os-readonly",
        gpu_inventory_complete: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_memory_observation_never_claims_gpu_inventory() {
        let observed = local_hardware_observation();
        assert_eq!(observed.source, "native-os-readonly");
        assert!(!observed.gpu_inventory_complete);
        assert!(observed.logical_processors.is_none_or(|count| count > 0));
        if let (Some(total), Some(available)) = (observed.total_ram_bytes, observed.available_ram_bytes) {
            assert!(total > 0 && available <= total);
        }
    }
}
