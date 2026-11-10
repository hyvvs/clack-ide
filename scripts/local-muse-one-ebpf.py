#!/usr/bin/env python3
"""Future-only, root-operated Ollama TCP observation with a positive arm gate.

This program NEVER starts inference, SSH, sudo, or an Ollama service. It runs
the pinned local-muse-tcp.bt under one supervised bpftrace process and uses
three separate private channels:

  --ready-fd: a private, already-open FIFO receiving exactly one numeric
              TCPARMED (or TCPABORT) line, before any inference may start;
  --control-fd: a private FIFO receiving precisely STOP\\n after inference;
  stdout:    ONLY pseudonymized TCPMETA records and one final TCPSESSION line,
              for the existing import-kernel CLI, after tracer END and EOF.

Neither raw kernel pointers nor raw stderr are ever written to either channel.
No kernel probe is launched by importing this module or running its tests.
Actual bpftrace/host compatibility still requires separately approved testing.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import re
import select
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path


# Bind this independently reviewed wrapper to the *unchanged* hardened source.
# An intentional future source upgrade needs a separate review of these pins.
PROBE_SHA256 = "e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0"
HELPER_SHA256 = "d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf"
MAX_SECONDS = 1800
MAX_STDOUT = 8 * 1024 * 1024
MAX_STDERR = 64 * 1024
MAX_PROGRAM_LIST = 4 * 1024 * 1024
ATTACH_NOTICE = re.compile(rb"Attached 4 probes(?:\.\.\.)?")
ATTACH_PENDING_NOTICE = re.compile(rb"Attaching 4 probes(?:\.\.\.)?")
LOSS_NOTICE = re.compile(rb"(?:lost\s+\d+\s+events?|\d+\s+events?\s+lost)", re.I)
# These warnings were seen in the previously validated, isolated bpftrace 0.27
# attachment. The path is restricted to the protected root-owned probe stage.
# Unknown compiler/verifier diagnostics remain fatal to readiness and sealing.
SOURCE_CONTEXT = rb"(?:/run/local-muse-ebpf/(?:[A-Za-z0-9_-]{1,80}/)?local-muse-tcp\.bt:\d+:\d+-\d+: )?"
SAFE_WARNING = re.compile(SOURCE_CONTEXT + rb"WARNING: (?:Unnecessary cast: expression is already of type uint64|Return value discarded\.)")
SAFE_END_WARNING = re.compile(rb"/run/local-muse-ebpf/(?:[A-Za-z0-9_-]{1,80}/)?local-muse-tcp\.bt:68:\d+-\d+: WARNING: Success")
SAFE_HELPER_INFO = re.compile(rb"Additional Info - helper: map_lookup_percpu_elem, retcode: 0")
RISKY_EXCERPT = re.compile(rb"\b(?:ERROR|FAIL(?:ED|URE)?|VERIFIER|REJECTED|WARNING|LOST|PANIC|DENIED)\b", re.I)


def verified_file(path, digest=None):
    """Before importing or executing root code, reject writable parents."""
    original = Path(path)
    if original.is_symlink():
        raise ValueError("Root source symlink is not trusted")
    resolved = original.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Root source must be a file")
    for node in (resolved, *resolved.parents):
        info = node.stat()
        if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise ValueError("Root source or parent is writable/unowned")
    if digest and hashlib.sha256(resolved.read_bytes()).hexdigest() != digest:
        raise ValueError("Pinned root source digest differs")
    return resolved


def load_hardened_support(folder):
    source = verified_file(folder / "local-muse-tcp-session.py", HELPER_SHA256)
    spec = importlib.util.spec_from_file_location("local_muse_pinned_supervisor", source)
    if spec is None or spec.loader is None:
        raise ValueError("Pinned supervisor loader unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def program_inventory(bpftool, timeout):
    """Read-only program IDs; availability alone does not prove BPF attachment."""
    process = subprocess.run([str(bpftool), "-j", "prog", "show"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, check=True,
                             timeout=max(0.1, min(2.0, timeout)))
    if len(process.stdout) > MAX_PROGRAM_LIST:
        raise ValueError("Kernel program inventory overflow")
    entries = json.loads(process.stdout)
    if not isinstance(entries, list):
        raise ValueError("Invalid kernel program inventory")
    by_id = {}
    for row in entries:
        if not isinstance(row, dict) or type(row.get("id")) is not int or row["id"] < 1 \
                or not isinstance(row.get("type"), str) or \
                not isinstance(row.get("name", ""), str) or row["id"] in by_id:
            raise ValueError("Malformed kernel program inventory entry")
        by_id[row["id"]] = (row["type"], row.get("name", ""))
    return by_id


def new_kprobes(before, after):
    """Only new programs named for the actual tcp_sendmsg hooks are relevant."""
    return {number for number, (kind, name) in after.items()
            if number not in before and kind == "kprobe" and
            (name.startswith("kprobe_tcp_send") or name.startswith("kretprobe_tcp_s"))}


def classify_source_output(raw_stdout, raw_stderr):
    """Discard only confirmed benign bpftrace diagnostics, preserving errors.

    No raw tracing data is emitted; the returned bytes remain private until
    the pinned supervisor has checked their identity, counters and END marker.
    Compiler warning excerpts are recognized only immediately after the exact
    validated warning. END's zero-retcode helper message must directly follow
    the exact line-68 warning. Every other line stays in strict output.
    """
    cleaned_stdout = []
    strict_stderr = []
    completed = 0
    benign = 0
    for channel, raw in (("stdout", raw_stdout), ("stderr", raw_stderr)):
        rows = raw.splitlines()
        allowed_excerpt = False
        idx = 0
        while idx < len(rows):
            line = rows[idx]
            idx += 1
            if not line.strip():
                allowed_excerpt = False
                continue
            if ATTACH_NOTICE.fullmatch(line):
                completed += 1
                allowed_excerpt = False
                continue
            if ATTACH_PENDING_NOTICE.fullmatch(line):
                allowed_excerpt = False
                continue
            if LOSS_NOTICE.search(line):
                allowed_excerpt = False
            elif SAFE_WARNING.fullmatch(line):
                benign += 1
                allowed_excerpt = True
                continue
            elif SAFE_END_WARNING.fullmatch(line):
                if idx < len(rows) and SAFE_HELPER_INFO.fullmatch(rows[idx]):
                    benign += 2
                    idx += 1
                    allowed_excerpt = True
                    continue
            elif allowed_excerpt and line[:1] in (b" ", b"\t") and \
                    not RISKY_EXCERPT.search(line):
                benign += 1
                continue
            elif channel == "stdout" and line.startswith((
                    b"TCPREADY ", b"TCPMETA ", b"TCPSUMMARY ")):
                cleaned_stdout.append(line)
                allowed_excerpt = False
                continue
            allowed_excerpt = False
            if channel == "stdout":
                cleaned_stdout.append(line)
            else:
                strict_stderr.append(line)
    # Even exact benign warnings must not create unbounded unaccounted output.
    if benign > 128:
        strict_stderr.append(b"too-many-benign-warning-lines")
    return b"\n".join(cleaned_stdout) + (b"\n" if cleaned_stdout else b""), \
        b"\n".join(strict_stderr), completed


def source_arm_evidence(stdout_bytes, stderr_bytes, pid, port, before, after):
    """Positive pre-inference evidence: native notice + BEGIN + BPF delta."""
    source_stdout, rest_stderr, notices = classify_source_output(stdout_bytes, stderr_bytes)
    expected_ready = f"TCPREADY {pid} {port}".encode("ascii")
    rows = source_stdout.splitlines()
    has_ready = bool(rows) and rows[0] == expected_ready and \
        not any(row.startswith(b"TCPSUMMARY ") or not row.startswith((
            b"TCPMETA ", b"TCPREADY ")) for row in rows[1:])
    new_ids = new_kprobes(before, after)
    return (has_ready and not rest_stderr.strip() and
            notices == 1 and len(new_ids) >= 2), len(new_ids)


def numeric_arm_line(pid, port, programs, observed_loss=0):
    fields = [pid, port, 4, programs, observed_loss]
    if any(type(value) is not int or value < 0 for value in fields) or \
            pid <= 1 or port != 11434 or programs < 2 or observed_loss != 0:
        raise ValueError("Invalid numeric arm identity")
    return "TCPARMED " + " ".join(map(str, fields)) + "\n"


def nonblocking_write(fd, value, deadline):
    """Never let a stalled FIFO or importer defeat the root-session deadline."""
    payload = value.encode("ascii") if isinstance(value, str) else value
    os.set_blocking(fd, False)
    position = 0
    while position < len(payload):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Output delivery reached session deadline")
        try:
            count = os.write(fd, payload[position:position + 65536])
            if count <= 0:
                raise BrokenPipeError("Output channel closed")
            position += count
        except BlockingIOError:
            select.select([], [fd], [], min(0.1, remaining))


def child_exit_status(code, signalled):
    if signalled and code in (-signal.SIGINT, 128 + signal.SIGINT):
        return 0
    return code


def run_capture(pid, duration, ready_fd, control_fd, helper, probe, tracer, bpftool,
                attach_timeout=60, stdout_fd=1):
    """Own one tracer only, while retaining every byte of untrusted BPF output."""
    identity = helper.read_identity(pid, 11434)
    baseline_programs = program_inventory(bpftool, 2.0)
    started = time.monotonic()
    deadline = started + duration
    graceful_at = helper.graceful_shutdown_at(started, duration)
    parent = os.getpid()
    # Explicit line buffering is required for a readiness marker generated by
    # BEGIN to become visible while the tracer is still attached and running.
    child = subprocess.Popen([str(tracer), "-B", "line", str(probe), str(pid), "11434"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True,
                             preexec_fn=lambda: helper.child_pdeathsig(parent))
    stdout = bytearray()
    stderr = bytearray()
    selector = selectors.DefaultSelector()
    for stream in (child.stdout, child.stderr):
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    os.set_blocking(control_fd, False)
    selector.register(control_fd, selectors.EVENT_READ)
    armed = False
    arm_attempted = False
    armed_program_ids = set()
    signalled = False
    forced = False
    identity_ok = True
    invalid_source = False
    operator_stopped = False
    stop_complete = False
    control_data = bytearray()
    kill_time = None
    kill_at = deadline
    last_identity = 0
    last_inventory = 0
    current_programs = baseline_programs
    # An operator signal ends the capture but is never a claim of full coverage.
    def operator_signal(_signum, _frame):
        nonlocal operator_stopped
        operator_stopped = True
    old_int = signal.signal(signal.SIGINT, operator_signal)
    old_term = signal.signal(signal.SIGTERM, operator_signal)
    try:
        while selector.get_map() or child.poll() is None:
            now = time.monotonic()
            if now - last_identity >= 1:
                last_identity = now
                try:
                    identity_ok = identity_ok and helper.read_identity(pid, 11434) == identity
                except (OSError, ValueError, KeyError):
                    identity_ok = False
            if not armed and not signalled and now - last_inventory >= 1 and \
                    now < graceful_at and now - started < attach_timeout:
                last_inventory = now
                try:
                    current_programs = program_inventory(bpftool, deadline - now)
                    proof, count = source_arm_evidence(stdout, stderr, pid, 11434,
                                                       baseline_programs, current_programs)
                    if proof and identity_ok:
                        # The inventory call can consume two seconds; recheck
                        # service identity immediately before signaling READY.
                        identity_ok = helper.read_identity(pid, 11434) == identity
                    if proof and identity_ok and child.poll() is None:
                        # The signal and monitor are independent channels;
                        # readiness is *prior* to any authorized inference.
                        try:
                            nonblocking_write(ready_fd, numeric_arm_line(
                                pid, 11434, count, 0), min(deadline, now + 2))
                            armed = True
                            arm_attempted = True
                            armed_program_ids = new_kprobes(baseline_programs,
                                                           current_programs)
                            os.close(ready_fd)
                        except (OSError, ValueError, TimeoutError):
                            invalid_source = True
                            arm_attempted = True
                except (OSError, ValueError, KeyError, subprocess.SubprocessError,
                        json.JSONDecodeError):
                    invalid_source = True  # no unknown BPF inventory is allowed
            if armed and not signalled and now - last_inventory >= 5 and now < graceful_at:
                last_inventory = now
                try:
                    live = program_inventory(bpftool, deadline - now)
                    if not armed_program_ids.issubset(new_kprobes(baseline_programs, live)):
                        invalid_source = True
                except (OSError, ValueError, subprocess.SubprocessError,
                        json.JSONDecodeError):
                    invalid_source = True
            if armed and classify_source_output(stdout, stderr)[1].strip():
                invalid_source = True
            if not signalled and (stop_complete or operator_stopped or invalid_source or not identity_ok or
                    now >= graceful_at or not armed and now - started >= attach_timeout):
                signalled = True
                kill_at = min(deadline, now + 5)
                helper.request_stop(child)
                # A reader remaining attached to the control pipe must never
                # keep the supervisor alive after it has stopped its tracer.
                try:
                    selector.unregister(control_fd)
                except KeyError:
                    pass
            if signalled and child.poll() is None and now >= kill_at and kill_time is None:
                helper.request_stop(child, signal.SIGKILL)
                forced = True
                kill_time = now if kill_time is None else kill_time
            # The tracer or a descendant can hold pipes indefinitely. Stop
            # monitoring after bounded escalation and let the final fail closed.
            if kill_time is not None and now >= kill_time + 1.0:
                invalid_source = True
                break
            if signalled and child.poll() is not None and now >= deadline:
                invalid_source = True
                break
            for key, _ in selector.select(timeout=min(0.1, max(0.0, deadline - now))):
                if key.fileobj == control_fd:
                    command = os.read(control_fd, 32)
                    if not command:
                        invalid_source = True  # controller unexpectedly disconnected
                        selector.unregister(control_fd)
                        continue
                    control_data.extend(command)
                    if control_data == b"STOP\n":
                        stop_complete = True
                        selector.unregister(control_fd)
                    elif len(control_data) > 5 or b"\n" in control_data:
                        invalid_source = True  # never log or interpret private input
                        selector.unregister(control_fd)
                    continue
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                target, bound = (stdout, MAX_STDOUT) if key.fileobj is child.stdout \
                    else (stderr, MAX_STDERR)
                if len(target) + len(chunk) > bound:
                    invalid_source = True
                else:
                    target.extend(chunk)
            if child.poll() is not None and not signalled:
                # A normal-looking END before the appointed deadline cannot
                # certify a full session when the supervisor did not stop it.
                invalid_source = True
                break
            if not armed and child.poll() is not None:
                invalid_source = True
                break
    except Exception:
        # A malformed read, unexpected host API response or rejected native
        # event is a failed source, never a partial success claim.
        invalid_source = True
    finally:
        signal.signal(signal.SIGINT, old_int)
        signal.signal(signal.SIGTERM, old_term)
        if child.poll() is None:
            helper.request_stop(child, signal.SIGKILL)
            forced = True
        try:
            child.wait(timeout=max(0.0, min(1.0, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            helper.request_stop(child, signal.SIGKILL)
            invalid_source = True
        selector.close()
        child.stdout.close()
        child.stderr.close()

    if not armed:
        try:
            nonblocking_write(ready_fd, "TCPABORT 1 2\n",
                              min(deadline, time.monotonic() + 0.5))
        except (OSError, TimeoutError):
            pass
        finally:
            try:
                os.close(ready_fd)
            except OSError:
                pass

    now = time.monotonic()
    duration_ms = int((now - started) * 1000)
    source_stdout, source_stderr, completed_notices = classify_source_output(
        bytes(stdout), bytes(stderr))
    # A reaped tracer and an END footer still do not prove kernel resources
    # were released. These exact loaded program IDs must be absent *after*
    # tracer exit; an unreadable BPF registry leaves cleanup unverified.
    kernel_clean = child.poll() is not None
    if armed_program_ids:
        try:
            post_programs = program_inventory(bpftool, min(2.0, deadline - now))
            kernel_clean = kernel_clean and not armed_program_ids.intersection(post_programs)
        except (OSError, ValueError, subprocess.SubprocessError,
                json.JSONDecodeError):
            kernel_clean = False
    complete_source = (armed and arm_attempted and completed_notices == 1 and
                       identity_ok and not invalid_source and not operator_stopped and
                       not forced and now <= deadline and kernel_clean)
    rows, status, complete = helper.summarize_trace(
        source_stdout, source_stderr, pid, 11434, duration_ms, signalled,
        child_exit_status(child.returncode, signalled), complete_source,
        max_duration_ms=duration * 1000)
    if not complete:
        status = status.replace("TCPSESSION complete ", "TCPSESSION partial ", 1)
    # Importer must get the *last* line only after END and actual tracer EOF.
    # A broken/stalled stdout yields no completion receipt; journal fails closed.
    try:
        nonblocking_write(stdout_fd, "\n".join([*rows, status]) + "\n", deadline)
    except (OSError, TimeoutError):
        return 1
    return 0 if complete else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bounded Ollama PID-scoped eBPF session")
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--seconds", default=MAX_SECONDS, type=int)
    parser.add_argument("--ready-fd", required=True, type=int)
    parser.add_argument("--control-fd", default=0, type=int)
    args = parser.parse_args(argv)
    if platform.system() != "Linux" or sys.byteorder != "little" or os.geteuid() != 0:
        parser.error("Linux little-endian root operator required")
    if args.ready_fd < 3 or args.ready_fd > 255:
        parser.error("Bounded private ready FD must be >= 3")
    if args.control_fd < 0 or args.control_fd > 255 or args.control_fd in (1, 2, args.ready_fd):
        parser.error("Control FD must be a separate private pipe")
    if not 1 <= args.seconds <= MAX_SECONDS:
        parser.error("Maximum session is 1800 seconds")
    if not stat.S_ISFIFO(os.fstat(args.ready_fd).st_mode) or \
            not stat.S_ISFIFO(os.fstat(1).st_mode) or \
            not stat.S_ISFIFO(os.fstat(args.control_fd).st_mode):
        parser.error("Control and output channels must be anonymous pipes or FIFOs")
    try:
        folder = verified_file(__file__).parent
        helper = load_hardened_support(folder)
        helper.validate_scope(args.pid, 11434, args.seconds)
        probe = verified_file(folder / "local-muse-tcp.bt", PROBE_SHA256)
        tracer_name = shutil.which("bpftrace")
        bpftool_name = shutil.which("bpftool")
        if not tracer_name or not bpftool_name:
            raise ValueError("Approved BPF tools unavailable")
        tracer = helper.trusted_root_file(tracer_name)
        bpftool = helper.trusted_root_file(bpftool_name)
        return run_capture(args.pid, args.seconds, args.ready_fd, args.control_fd,
                           helper, probe, tracer, bpftool)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        # Setup may have failed before a child was created. Never emit READY.
        # An absent/incomplete import terminal is an unsealable source.
        try:
            nonblocking_write(args.ready_fd, "TCPABORT 1 1\n", time.monotonic() + 0.5)
        except (OSError, TimeoutError):
            pass
        try:
            nonblocking_write(1, "TCPSESSION partial 0 0 0 0 0\n",
                              time.monotonic() + 0.5)
        except (OSError, TimeoutError):
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
