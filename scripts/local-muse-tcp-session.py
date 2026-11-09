#!/usr/bin/env python3
"""Linux-only, root-operated, bounded Ollama TCP metadata tracing supervisor.

Not an installer or an inference launcher. stdout contains ONLY validated
TCPMETA lines and one TCPSESSION status; stderr contains generic status only.
Raw kernel socket pointers exist only inside the bounded root-owned process
pipe. stdout uses fresh per-session numeric HMAC pseudonyms (rehashable by the
existing strict importer). Never redirect stdout to a plaintext file.
"""

import argparse
import ctypes
import hashlib
import hmac
import os
import platform
import re
import selectors
import signal
import secrets
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

MAX_SECONDS = 1800
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_STDERR_BYTES = 64 * 1024
LOOPBACK_HEX = "0100007F"  # 127.0.0.1 in /proc/net/tcp on little-endian Linux
LISTEN = "0A"
META = re.compile(
    r"TCPMETA (attempt|send) (\d{1,20}) (\d+) (\d+) (\d+) "
    r"(\d+) (\d+) (\d+) (-?\d+) ollama"
)
READY = re.compile(r"TCPREADY (\d+) (\d+)")
SUMMARY = re.compile(r"TCPSUMMARY (\d+) (\d+) (\d+)")
LOSS = re.compile(r"(?:lost\s+(\d+)\s+events?|(?:(\d+)\s+events?\s+lost))", re.I)


def validate_scope(pid, port, seconds):
    if not (1 < pid <= 4194304 and port == 11434 and 1 <= seconds <= MAX_SECONDS):
        raise ValueError("Invalid PID, required loopback port or maximum 1800-second duration")


def deadline_reached(started, now, duration):
    validate_scope(2, 11434, duration)
    return now - started >= duration


def graceful_shutdown_at(started, duration):
    validate_scope(2, 11434, duration)
    return started + duration - min(5.0, duration / 2)


def listener_inode(tcp_rows, owned_inodes, port):
    listening = set()
    for line in tcp_rows:
        fields = line.split()
        if len(fields) > 9 and fields[1] == f"{LOOPBACK_HEX}:{port:04X}" and fields[3] == LISTEN:
            listening.add(fields[9])
    matches = listening & set(owned_inodes)
    if len(matches) != 1:
        raise ValueError("Ollama PID does not own exactly one verified loopback listener")
    return next(iter(matches))


def read_identity(pid, port):
    """Reject PID reuse, other users, other binaries and unowned listeners."""
    import pwd  # Linux only; keep pure offline parser/deadline tests portable.
    root = Path("/proc") / str(pid)
    cmd = (root / "cmdline").read_bytes().strip(b"\0").split(b"\0")
    exe = (root / "exe").resolve(strict=True)
    if exe.name != "ollama" or len(cmd) != 2 or cmd[1] != b"serve" or \
            Path(os.fsdecode(cmd[0])).name != "ollama" or \
            exe != Path("/usr/local/bin/ollama").resolve(strict=True):
        raise ValueError("PID is not the Ollama server")
    owner = pwd.getpwnam("ollama").pw_uid
    status = (root / "status").read_text(encoding="ascii")
    uid = re.search(r"^Uid:\s+(\d+)\s+", status, re.M)
    if uid is None or int(uid.group(1)) != owner:
        raise ValueError("PID is not owned by the Ollama service account")
    stat = (root / "stat").read_text(encoding="ascii")
    start_ticks = stat[stat.rfind(")") + 2:].split()[19]  # /proc stat field 22
    owned = set()
    for fd in (root / "fd").iterdir():
        try:
            target = os.readlink(fd)
        except FileNotFoundError:
            continue  # unrelated descriptor closed during enumeration
        match = re.fullmatch(r"socket:\[(\d+)\]", target)
        if match:
            owned.add(match.group(1))
    with open("/proc/net/tcp", encoding="ascii") as handle:
        inode = listener_inode(handle, owned, port)
    return start_ticks, inode, str(exe), owner


def summarize_trace(stdout_bytes, stderr_bytes, pid, port, duration_ms,
                    stopped_by_supervisor, exit_code, identity_ok=True,
                    socket_key=None, max_duration_ms=MAX_SECONDS * 1000):
    """Parse only numeric output; loss/missing END/unpaired returns fail closed."""
    pending = {}
    accepted = []
    attempts = returns = 0
    summary = None
    ready_seen = False
    invalid = False
    socket_key = socket_key if socket_key is not None else secrets.token_bytes(32)
    for raw in stdout_bytes.decode("ascii", errors="replace").splitlines():
        if match := READY.fullmatch(raw):
            if ready_seen or accepted or summary is not None or \
                    int(match.group(1)) != pid or int(match.group(2)) != port:
                invalid = True
            ready_seen = True
        elif match := META.fullmatch(raw):
            if not ready_seen or summary is not None:
                invalid = True
            op, ns, event_pid, tid, socket, local, remote, requested, result = match.groups()
            values = [int(x) for x in (ns, event_pid, tid, socket, local, remote, requested, result)]
            if values[0] <= 0 or values[1] != pid or values[2] <= 0 or values[3] <= 0 or \
                    values[4] != port or not 0 < values[5] <= 65535 or values[6] < 0 or \
                    values[7] > values[6] or (op == "attempt" and values[7] != 0):
                invalid = True
                continue
            key = (tid, socket)
            if op == "attempt":
                attempts += 1
                if any(item[0] == tid for item in pending):
                    invalid = True
                pending[key] = (requested, local, remote)
            else:
                returns += 1
                if pending.pop(key, None) != (requested, local, remote):
                    invalid = True
            # Numeric HMAC pseudonym, never the raw kernel socket pointer.
            pseudonym = int.from_bytes(hmac.new(socket_key,
                                  f"{socket}:{local}:{remote}".encode("ascii"),
                                  hashlib.sha256).digest()[:8], "big") or 1
            accepted.append(" ".join(["TCPMETA", op, ns, event_pid, tid,
                                      str(pseudonym), local, remote, requested,
                                      result, "ollama"]))
        elif match := SUMMARY.fullmatch(raw):
            if summary is not None or not ready_seen:
                invalid = True
            summary = tuple(map(int, match.groups()))
        else:
            invalid = True
    warnings = stderr_bytes.decode("utf-8", errors="replace").strip()
    loss_counts = [int(a or b) for a, b in LOSS.findall(warnings)]
    reported_loss = sum(loss_counts)
    # Any nonempty unrecognized stderr is also incomplete; never echo it.
    warnings_without_loss = LOSS.sub("", warnings).strip()
    collisions = summary[2] if summary is not None else 0
    count_mismatch = not ready_seen or summary is None or summary[:2] != (attempts, returns)
    incomplete = (invalid or count_mismatch or collisions != 0 or bool(pending) or reported_loss != 0 or
                  bool(warnings_without_loss) or not stopped_by_supervisor or
                  exit_code != 0 or not identity_ok or duration_ms > max_duration_ms)
    # Counters may reveal missing async printf events even without a bpftrace
    # lost-event notice. Do not equate an unknown count with zero actual loss.
    if summary is not None:
        reported_loss += max(0, summary[0] - attempts) + max(0, summary[1] - returns)
        reported_loss += collisions  # unmatched concurrent entries: exact attribution unavailable
    state = "partial" if incomplete else "complete"
    status = f"TCPSESSION {state} {attempts} {returns} {len(pending)} {reported_loss} {duration_ms}"
    return accepted, status, not incomplete


def request_stop(process, how=signal.SIGINT):
    """Signal only the task-owned tracer process group, never Ollama."""
    if process.poll() is None:
        try:
            os.killpg(process.pid, how)
        except ProcessLookupError:
            pass


def child_pdeathsig(expected_parent):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != expected_parent:
        os._exit(127)


def trusted_root_file(path):
    """Reject root-executed probe files in writable or symlinked directories."""
    original = Path(path)
    if original.is_symlink():
        raise ValueError("Untrusted root-operated tracer symlink")
    resolved = original.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Root-operated tracer must be a regular file")
    for node in (resolved, *resolved.parents):
        info = node.stat()
        if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise ValueError("Root-operated tracer must not be in a writable or non-root-owned path")
    return resolved


def run_session(pid, port, duration, script):
    baseline = read_identity(pid, port)
    parent = os.getpid()
    tracer = shutil.which("bpftrace")
    if tracer is None:
        raise ValueError("Approved bpftrace binary unavailable")
    tracer = trusted_root_file(tracer)
    started = time.monotonic()  # bound includes tracer startup and attachment
    child = subprocess.Popen([str(tracer), "-q", str(script), str(pid), str(port)],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True,
                             preexec_fn=lambda: child_pdeathsig(parent))
    deadline = started + duration
    # Start graceful END early. SIGKILL is sent by the hard deadline, not
    # 5 seconds AFTER the 30-minute maximum.
    soft_deadline = graceful_shutdown_at(started, duration)
    graceful_deadline = None
    signalled = False
    kill_started = None
    identity_ok = True
    stdout = bytearray()
    stderr = bytearray()
    selector = selectors.DefaultSelector()
    for stream in (child.stdout, child.stderr):
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    stop_requested = False

    def interrupt(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    old_int = signal.signal(signal.SIGINT, interrupt)
    old_term = signal.signal(signal.SIGTERM, interrupt)
    last_check = 0
    try:
        while selector.get_map() or child.poll() is None:
            now = time.monotonic()
            if now - last_check >= 1:
                last_check = now
                try:
                    identity_ok = identity_ok and read_identity(pid, port) == baseline
                except (OSError, ValueError):
                    identity_ok = False
            if not signalled and (stop_requested or now >= soft_deadline or not identity_ok):
                signalled = True
                request_stop(child)
                graceful_deadline = min(now + 5, deadline)
            if signalled and child.poll() is None and kill_started is None and (
                    now >= graceful_deadline or deadline_reached(started, now, duration)):
                request_stop(child, signal.SIGKILL)
                kill_started = now
            # Never allow an unresponsive tracer or inherited pipe to keep
            # this root supervisor running indefinitely after SIGKILL.
            # BPF coverage must then be classified partial, not completed.
            if kill_started is not None and child.poll() is None and now >= kill_started + 2:
                identity_ok = False
                break
            # A descendant keeping pipes open cannot defeat the bounded exit.
            if signalled and child.poll() is not None and now >= graceful_deadline + 5:
                break
            for key, _ in selector.select(timeout=0.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                target, limit = (stdout, MAX_OUTPUT_BYTES) if key.fileobj is child.stdout \
                    else (stderr, MAX_STDERR_BYTES)
                if len(target) + len(chunk) > limit:
                    identity_ok = False  # bounded collector overflow = incomplete
                    stop_requested = True
                else:
                    target.extend(chunk)
            # Unexpected tracer exit is never a clean supervisor shutdown.
            if child.poll() is not None and not signalled:
                break
    finally:
        signal.signal(signal.SIGINT, old_int)
        signal.signal(signal.SIGTERM, old_term)
        if child.poll() is None:
            request_stop(child, signal.SIGKILL)
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            request_stop(child, signal.SIGKILL)
        selector.close()
        child.stdout.close()
        child.stderr.close()
    duration_ms = int((time.monotonic() - started) * 1000)
    normal_exit = 0 if signalled and child.returncode in (-signal.SIGINT, 130) \
        else child.returncode
    lines, status, complete = summarize_trace(bytes(stdout), bytes(stderr), pid, port,
                                               duration_ms, signalled, normal_exit,
                                               identity_ok, max_duration_ms=duration * 1000)
    # Last line is mandatory. A downstream importer MUST reject partial/missing
    # TCPSESSION and leave evidence unsealed. Never persist raw stdout here.
    for line in [*lines, status]:
        print(line, flush=True)
    print("local-muse-tcp-session: " + ("collector-complete-only" if complete else
          "incomplete-source; do-not-seal"), file=sys.stderr)
    return 0 if complete else 1


def main():
    parser = argparse.ArgumentParser(description="Authorized Ollama-only TCP metadata collector")
    parser.add_argument("--pid", type=int, required=True, help="Exact authorized ollama serve PID")
    parser.add_argument("--port", type=int, default=11434)
    parser.add_argument("--seconds", type=int, default=MAX_SECONDS)
    args = parser.parse_args()
    if platform.system() != "Linux" or sys.byteorder != "little" or os.geteuid() != 0:
        parser.error("Linux little-endian root-operated tracing is required")
    try:
        validate_scope(args.pid, args.port, args.seconds)
    except ValueError as error:
        parser.error(str(error))
    script = Path(__file__).with_name("local-muse-tcp.bt").resolve(strict=True)
    try:
        script = trusted_root_file(script)
        return run_session(args.pid, args.port, args.seconds, script)
    except (OSError, ValueError, subprocess.SubprocessError):
        print("TCPSESSION partial 0 0 0 0 0", flush=True)
        print("local-muse-tcp-session: setup/shutdown failed; do-not-seal", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
