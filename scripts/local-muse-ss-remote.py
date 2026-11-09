"""Read-only, bounded remote TCP socket counter sampler. Future authorization
only. Requires Python 3 and `ss -tinep`; never reads packets or AI payloads.

Output contains ONLY timestamps, numeric inode and numeric TCP counters. The
sample is an endpoint-wide TCP observation, not a request/SSH-channel join.
Example: python3 local-muse-ss-remote.py 20 0.5
"""
import re
import subprocess
import sys
import time

COUNTERS = ("bytes_sent", "bytes_acked", "bytes_received", "bytes_retrans")


def main():
    samples = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    interval = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    if not (1 <= samples <= 2000 and 0.1 <= interval <= 60):
        raise ValueError("bounded samples/interval required")
    for idx in range(samples):
        result = subprocess.run(
            ["ss", "-tinep"], stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, timeout=4, check=True,
        )
        lines = result.stdout.splitlines()
        epoch_us = time.time_ns() // 1000
        mono_us = time.monotonic_ns() // 1000
        for row in range(1, len(lines) - 1):
            header = lines[row]
            if header[0:1].isspace():
                continue
            parts = header.split()
            if len(parts) < 5:
                continue
            # `ss` state, recv-q, send-q, LOCAL, PEER; retain numeric ports
            # only. No addresses or raw socket headers are emitted.
            try:
                local_port = int(parts[3].rsplit(":", 1)[1])
                remote_port = int(parts[4].rsplit(":", 1)[1])
            except (IndexError, ValueError):
                continue
            if not (0 <= local_port <= 65535 and 0 <= remote_port <= 65535):
                continue
            if 11434 not in (local_port, remote_port) and 22 not in (local_port, remote_port):
                continue
            inode = re.search(r"\bino:(\d+)\b", header)
            details = lines[row + 1]
            if not inode or not details[0:1].isspace():
                continue
            safe = ["ino:" + inode.group(1), "local_port:" + str(local_port),
                    "remote_port:" + str(remote_port)]
            for name in COUNTERS:
                found = re.search(r"\b" + name + r":(\d+)\b", details)
                if found:
                    safe.append(name + ":" + found.group(1))
            if len(safe) > 1:
                print("SSMETA", epoch_us, mono_us, " ".join(safe), flush=True)
        if idx + 1 < samples:
            time.sleep(interval)


if __name__ == "__main__":
    main()
