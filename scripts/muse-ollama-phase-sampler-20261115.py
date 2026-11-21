"""Bounded, content-free Ollama host metrics; invoked through the existing SSH identity.

Runs from stdin without installing anything on the remote host. Its output is JSONL.
The parent owns the SSH process; a closed output pipe terminates sampling.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request


SAMPLE_INTERVAL_SECONDS = 2
MAX_SAMPLES = min(5600, max(1, int(sys.argv[1]))) if len(sys.argv) == 2 else 5600
MODEL = "muse-glimmer:30b"
HERTZ = os.sysconf("SC_CLK_TCK")


def command(args, timeout=2):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def kv_file(filename, names):
    values = {}
    try:
        with open(filename, encoding="ascii") as source:
            for line in source:
                name, separator, rest = line.partition(":")
                if separator and name in names:
                    digits = re.search(r"\d+", rest)
                    if digits:
                        values[name] = int(digits.group())
    except OSError:
        pass
    return values


def swap_counters():
    values = {}
    try:
        with open("/proc/vmstat", encoding="ascii") as source:
            for line in source:
                parts = line.split()
                if len(parts) == 2 and parts[0] in ("pswpin", "pswpout"):
                    values[parts[0]] = int(parts[1])
    except (OSError, ValueError):
        pass
    return values


def proc_ticks(filename):
    try:
        with open(filename, encoding="ascii") as source:
            text = source.read()
        fields = text.rsplit(")", 1)[1].split()
        return int(fields[11]) + int(fields[12])
    except (OSError, ValueError, IndexError):
        return None


def cpu_ticks():
    try:
        with open("/proc/stat", encoding="ascii") as source:
            fields = [int(value) for value in source.readline().split()[1:]]
        return (sum(fields), fields[3] + fields[4])
    except (OSError, ValueError, IndexError):
        return None


def processes():
    found = []
    for candidate in os.listdir("/proc"):
        if not candidate.isdecimal():
            continue
        try:
            raw = open("/proc/" + candidate + "/cmdline", "rb").read(4096)
            args = [part.decode("utf-8", "replace") for part in raw.split(b"\0") if part]
            if not args or "ollama" not in " ".join(args).lower():
                continue
            if "runner" in args or "llama-server" in args[0].lower() or "llama_server" in args[0].lower() or "--no-webui" in args:
                kind = "runner"
            elif "serve" in args:
                kind = "daemon"
            else:
                continue
            flags = {}
            for name in ("--ctx-size", "-c", "--n-gpu-layers", "-ngl", "--batch-size", "-b", "--parallel", "-np", "--threads", "-t", "--flash-attn", "-fa", "--kv-cache-type", "--cache-type-k", "--cache-type-v"):
                if name in args:
                    position = args.index(name)
                    next_value = args[position + 1] if position + 1 < len(args) else None
                    flags[name.lstrip("-")] = next_value if next_value and not next_value.startswith("-") else "present"
            pid = int(candidate)
            memory = kv_file("/proc/" + candidate + "/status", ("VmRSS", "Threads"))
            threads = {}
            if kind == "runner":
                for task in os.listdir("/proc/" + candidate + "/task")[:160]:
                    ticks = proc_ticks("/proc/" + candidate + "/task/" + task + "/stat")
                    if ticks is not None:
                        threads[task] = ticks
            found.append({"pid": pid, "kind": kind, "rssKb": memory.get("VmRSS"),
                          "threadCount": memory.get("Threads"), "cpuTicks": proc_ticks("/proc/" + candidate + "/stat"),
                          "threadTicks": threads, "flags": flags})
        except (OSError, ValueError, PermissionError):
            continue
    return found


def model_residency():
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=1.5) as response:
            models = json.load(response).get("models", [])
        return [{"contextLength": model.get("context_length"), "sizeVram": model.get("size_vram"),
                 "loaded": True, "nameMatches": model.get("name") == MODEL}
                for model in models]
    except (OSError, ValueError, KeyError):
        return None


def gpu():
    raw = command(["nvidia-smi", "--query-gpu=utilization.gpu,utilization.memory,memory.used,memory.free",
                   "--format=csv,noheader,nounits"], timeout=2)
    if raw is None:
        return None
    try:
        return [int(item.strip()) for item in raw.splitlines()[0].split(",")[:4]]
    except (ValueError, IndexError):
        return None


def percent(current, previous, seconds):
    if current is None or previous is None or seconds <= 0:
        return None
    return round(100 * (current - previous) / HERTZ / seconds, 1)


previous_time = None
previous_cpu = None
previous_processes = {}
previous_threads = {}
last_models = None

for index in range(MAX_SAMPLES):
    start = time.monotonic()
    snapshot = processes()
    total = cpu_ticks()
    seconds = start - previous_time if previous_time is not None else None
    system_cpu = None
    if total and previous_cpu and total[0] > previous_cpu[0]:
        system_cpu = round(100 * (1 - (total[1] - previous_cpu[1]) / (total[0] - previous_cpu[0])), 1)
    record_processes = []
    new_processes = {}
    new_threads = {}
    for process in snapshot:
        key = str(process["pid"])
        current = process.pop("cpuTicks")
        threads = process.pop("threadTicks")
        process["cpuPercentOneCore"] = percent(current, previous_processes.get(key), seconds or 0)
        new_processes[key] = current
        top_threads = []
        for thread_id, ticks in threads.items():
            usage = percent(ticks, previous_threads.get(key + ":" + thread_id), seconds or 0)
            if usage is not None:
                top_threads.append({"tid": int(thread_id), "cpuPercentOneCore": usage})
            new_threads[key + ":" + thread_id] = ticks
        process["topThreads"] = sorted(top_threads, key=lambda item: -item["cpuPercentOneCore"])[:5]
        record_processes.append(process)
    if index % 4 == 0:
        last_models = model_residency()
    record = {
        "utcMs": time.time_ns() // 1_000_000, "monoNs": time.monotonic_ns(), "sampleIndex": index,
        "gpu": gpu(), "systemCpuPct": system_cpu, "processes": record_processes,
        "memKb": kv_file("/proc/meminfo", ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree")),
        "swapPages": swap_counters(), "modelResidency": last_models,
        "activeRequests": None, "queuedRequests": None,
    }
    try:
        print(json.dumps(record, separators=(",", ":")), flush=True)
    except (BrokenPipeError, OSError):
        break
    previous_time, previous_cpu = start, total
    previous_processes, previous_threads = new_processes, new_threads
    time.sleep(max(0, SAMPLE_INTERVAL_SECONDS - (time.monotonic() - start)))
