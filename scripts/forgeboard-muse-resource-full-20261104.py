"""Task-only read-only resource sampling spanning the full ForgeBoard mission."""
import json
import os
import subprocess
import sys
import time

if len(sys.argv) != 2:
    raise SystemExit("Expected one task-owned directory")
directory = os.path.realpath(sys.argv[1])
if not os.path.isdir(directory) or os.stat(directory).st_uid != os.getuid():
    raise SystemExit("Expected a user-owned directory")


def command(args, timeout=2):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return result.stdout.strip()[:2000] if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def values(filename, keys):
    data = {}
    try:
        with open(filename, encoding="ascii") as handle:
            for line in handle:
                key = line.split(":", 1)[0] if ":" in line else line.split(" ", 1)[0]
                if key in keys:
                    parts = line.split()
                    if len(parts) > 1 and parts[1].isdigit():
                        data[key] = int(parts[1])
    except OSError:
        pass
    return data


path = os.path.join(directory, "resources-full.jsonl")
with open(path, "x", encoding="utf-8", buffering=1) as output:
    # Preserve the inherited 900-second sampler, adding nonintrusive coverage
    # through the bounded 7,200-second relay / 90-minute mission lifetime.
    until = time.monotonic() + 7200
    while time.monotonic() < until:
        record = {
            "mono_ns": time.monotonic_ns(), "utc_ns": time.time_ns(),
            "gpu": command(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.free", "--format=csv,noheader,nounits"]),
            "ram": values("/proc/meminfo", {"MemAvailable", "SwapFree", "SwapTotal"}),
            "swap": values("/proc/vmstat", {"pswpin", "pswpout"}),
            "processes": command(["ps", "-eo", "pid,ppid,comm,stat,rss,pcpu"]),
        }
        output.write(json.dumps(record, separators=(",", ":")) + "\n")
        time.sleep(1.4)
