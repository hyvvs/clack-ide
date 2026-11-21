#!/usr/bin/env python3
"""Future-only, root-local tracefs kprobe SESSION/target attestation.

Library, NOT a launcher. The root supervisor must call start() BEFORE
spawning bpftrace, then verify_and_close() while that exact tracer is alive.
No probe is installed on import. Never sends readiness or starts BPF code.

Linux 7.3.1 (x86_64) UAPI: union bpf_attr.link_create prog_fd@0,
attach_type@8, kprobe_multi.flags@16, kprobe_multi.cnt@20.
Also intercept ftrace_lookup_symbols(sorted_syms, cnt, addrs) inside the
same kernel attach. Fetch exactly the kernel-copied first symbol through the
indirect kernel-space pointer, then reduce it immediately to MATCH/OTHER.
No pointers, unrecognized symbols, trace_pipe lines, or commands are exported.
"""

import ctypes
import argparse
import errno
import os
import platform
import re
import signal
import threading
import time
from pathlib import Path


class AttestationError(Exception):
    """A closed-vocabulary failure; do not propagate private kernel text."""


RUN_ID = re.compile(r"muse-one-([0-9a-f]{24})\Z")
SYMBOL = "bpf_kprobe_multi_link_attach"
SESSION_ATTACH = 56
ORDINARY_MULTI_ATTACH = 42
KPROBE_PROG_TYPE = 2
KPROBE_MULTI_LINK_TYPE = 8
SYS_BPF_X86_64 = 321
SYS_PIDFD_GETFD_X86_64 = 438
BPF_OBJ_GET_INFO_BY_FD = 15
MAX_SECONDS = 20
MAX_LINES = 64
MAX_LINE_BYTES = 1024
MAX_KALLSYMS_BYTES = 64 * 1024 * 1024
TRACE_ROOT = Path("/sys/kernel/tracing")
LOOKUP_SYMBOL = "ftrace_lookup_symbols"


def _integer(value, low=0, high=0xffffffff):
    return type(value) is int and low <= value <= high


def _require(condition, reason):
    if not condition:
        raise AttestationError(reason)


def _kernel_symbol_present(symbol):
    """Verify symbol presence without reading or disclosing its address."""
    _require(symbol in (SYMBOL, LOOKUP_SYMBOL), "UNAPPROVED_SYMBOL")
    found = 0
    total = 0
    try:
        with open("/proc/kallsyms", encoding="ascii") as source:
            for count, line in enumerate(source, 1):
                total += len(line)
                _require(total <= MAX_KALLSYMS_BYTES and count <= 1000000 and
                         len(line) <= 256, "KALLSYMS_SIZE_LIMIT")
                fields = line.split()
                if len(fields) >= 3 and fields[2] == symbol:
                    _require(fields[1] in ("t", "T"), "INVALID_KERNEL_SYMBOL")
                    found += 1
                    _require(found <= 1, "AMBIGUOUS_KERNEL_SYMBOL")
    except (OSError, UnicodeError):
        raise AttestationError("KALLSYMS_UNAVAILABLE") from None
    _require(found == 1, "KERNEL_SYMBOL_UNAVAILABLE")
    return True


def trace_definitions(group):
    """Exact tracefs field fetch syntax, with pinned UAPI byte offsets."""
    _require(bool(re.fullmatch(r"clack_muse_[0-9a-f]{24}", group)),
             "INVALID_EVENT_GROUP")
    suffix = group[len("clack_muse_"):]
    return (
        f"p:{group}/enter_{suffix} {SYMBOL} "
        "progfd=+0($arg1):u32 attach=+8($arg1):u32 "
        "flags=+16($arg1):u32 cnt=+20($arg1):u32",
        f"r:{group}/leave_{suffix} {SYMBOL} result=$retval:s64",
        # sorted_syms is kernel-owned char **. The first +0 dereferences
        # the vector to a char *, the second fetches that kernel string.
        # Do NOT use +u0 / userspace dereference or $arg1:string directly.
        f"p:{group}/lookup_{suffix} {LOOKUP_SYMBOL} "
        "cnt=$arg2:u64 sym=+0(+0($arg1)):string",
        f"r:{group}/lookret_{suffix} {LOOKUP_SYMBOL} result=$retval:s64",
    )


def parse_trace_line(line, group):
    """Drop all trace_pipe text; retain only TID + enumerated numeric fields.

    TID is tracefs common_pid, not a guessed process name. Currently require
    that the attachment originates on the verified tracer's leader thread;
    attaching from another thread fails closed rather than guessing its TGID.
    """
    _require(type(line) is str and len(line.encode("utf-8")) <= MAX_LINE_BYTES,
             "TRACE_LINE_OVERSIZE")
    suffix = group[len("clack_muse_"):]
    prefix = re.fullmatch(
        r".{0,80}-(\d{1,10})\s+\[\d{1,4}\].{0,120}:\s+"
        + r"(?:" + re.escape(group) + r":)?"
        + r"(enter|leave|lookup|lookret)_" + re.escape(suffix) +
        r":\s+.{0,150}",
        line,
    )
    _require(prefix is not None, "UNRECOGNIZED_TRACE_EVENT")
    tid, kind = int(prefix.group(1)), prefix.group(2)
    _require(_integer(tid, 2, 4194304), "INVALID_TRACE_TID")
    tail = line.split(f"{kind}_{suffix}:", 1)[1]
    if kind == "enter":
        match = re.search(
            r"\bprogfd=(\d{1,10})\s+attach=(\d{1,10})\s+"
            r"flags=(\d{1,10})\s+cnt=(\d{1,10})\s*$", tail)
        _require(match is not None, "INVALID_ENTER_FIELDS")
        prog_fd, attach, flags, count = map(int, match.groups())
        _require(all(_integer(x) for x in
                     (prog_fd, attach, flags, count)), "INVALID_ENTER_NUMBER")
        return dict(kind="enter", tid=tid, prog_fd=prog_fd,
                    attach_type=attach, flags=flags, count=count)
    if kind == "lookup":
        # Accept *only* the exact, properly quoted kernel-copied symbol;
        # no arbitrary strings are copied into returned events or receipts.
        match = re.search(r"\bcnt=(\d{1,10})\s+sym=(\S+)\s*$", tail)
        _require(match is not None, "INVALID_LOOKUP_FIELDS")
        count = int(match.group(1))
        _require(_integer(count), "INVALID_LOOKUP_COUNT")
        raw_symbol = match.group(2)
        _require(len(raw_symbol) <= 64, "SYMBOL_FETCH_OVERSIZE")
        return dict(kind="lookup", tid=tid, count=count,
                    target="TCP_SENDMSG" if raw_symbol in (
                        '"tcp_sendmsg"', 'tcp_sendmsg') else "OTHER")
    match = re.search(r"\bresult=(-?\d{1,12})\s*$", tail)
    _require(match is not None, "INVALID_LEAVE_FIELDS")
    value = int(match.group(1))
    _require(-(2 ** 31) <= value <= 2 ** 31 - 1,
             "INVALID_RETURN_NUMBER")
    if kind == "lookret":
        return dict(kind="lookret", tid=tid, result=value)
    return dict(kind="leave", tid=tid, returned_fd=value)


class _KprobeInfo(ctypes.Structure):
    _fields_ = [("addrs", ctypes.c_uint64),
                ("count", ctypes.c_uint32),
                ("flags", ctypes.c_uint32),
                ("missed", ctypes.c_uint64),
                ("cookies", ctypes.c_uint64)]


class _LinkInfo(ctypes.Structure):
    _fields_ = [("type", ctypes.c_uint32),
                ("id", ctypes.c_uint32),
                ("prog_id", ctypes.c_uint32),
                ("kprobe", _KprobeInfo)]


class _ProgInfo(ctypes.Structure):
    _fields_ = [("type", ctypes.c_uint32), ("id", ctypes.c_uint32)]


class _InfoAttr(ctypes.Structure):
    _fields_ = [("fd", ctypes.c_uint32),
                ("len", ctypes.c_uint32),
                ("ptr", ctypes.c_uint64)]


class _LinkCreatePrefix(ctypes.Structure):
    """Layout transcribed from pinned Linux 7.3.1 union bpf_attr.link_create."""
    _fields_ = [("prog_fd", ctypes.c_uint32),
                ("target_fd", ctypes.c_uint32),
                ("attach_type", ctypes.c_uint32),
                ("flags", ctypes.c_uint32),
                ("kprobe_multi_flags", ctypes.c_uint32),
                ("kprobe_multi_cnt", ctypes.c_uint32)]


def assert_kernel_abi():
    """Restrict the raw syscalls to the exact reviewed 64-bit layout."""
    _require(platform.system() == "Linux" and
             platform.machine() == "x86_64", "UNSUPPORTED_ABI")
    _require(ctypes.sizeof(_LinkInfo) == 48 and
             _LinkInfo.kprobe.offset == 16 and
             _KprobeInfo.count.offset == 8 and
             ctypes.sizeof(_InfoAttr) == 16 and
             (_LinkCreatePrefix.prog_fd.offset,
              _LinkCreatePrefix.attach_type.offset,
              _LinkCreatePrefix.kprobe_multi_flags.offset,
              _LinkCreatePrefix.kprobe_multi_cnt.offset) == (0, 8, 16, 20),
             "UNEXPECTED_ABI_LAYOUT")


def verify_normalized(events, tracer_pid, expected_start, link_id, prog_id,
                      kernel):
    """All trust joins, including nested kernel-owned symbol lookup.

    kernel is a narrow root-local adapter; unit tests provide a synthetic
    adapter without making syscalls or creating tracing/BPF objects.
    """
    _require(_integer(tracer_pid, 2, 4194304) and
             _integer(expected_start, 1, 2 ** 63 - 1) and
             _integer(link_id, 1) and _integer(prog_id, 1),
             "INVALID_EXPECTED_ID")
    _require(type(events) in (list, tuple) and len(events) <= MAX_LINES,
             "INVALID_EVENT_COUNT")
    matching = [e for e in events if type(e) is dict and
                e.get("tid") == tracer_pid]
    _require(len(matching) == 4 and
             [e.get("kind") for e in matching] ==
             ["enter", "lookup", "lookret", "leave"],
             "MISSING_DUPLICATE_OR_OUT_OF_ORDER_CREATION")
    entry, lookup, lookret, leave = matching
    _require(_integer(entry.get("prog_fd"), 0, 65535) and
             entry.get("attach_type") == SESSION_ATTACH and
             type(entry.get("attach_type")) is int, "NOT_KPROBE_SESSION")
    _require(entry.get("flags") == 0 and type(entry.get("flags")) is int and
             entry.get("count") == 1 and type(entry.get("count")) is int,
             "WRONG_CREATE_FLAGS_OR_COUNT")
    _require(type(lookup.get("count")) is int and lookup["count"] == 1 and
             lookup.get("target") == "TCP_SENDMSG" and
             type(lookret.get("result")) is int and
             lookret["result"] == 0, "KERNEL_SYMBOL_LOOKUP_NOT_PROVEN")
    fd = leave.get("returned_fd")
    _require(_integer(fd, 0, 65535), "LINK_CREATE_FAILED")
    _require(fd != entry["prog_fd"], "INVALID_FD_REUSE")

    # Process starttime prevents a recycled PID from inheriting this claim.
    _require(kernel.pid_start(tracer_pid) == expected_start,
             "TRACER_IDENTITY_CHANGED")
    link_fdinfo = kernel.fdinfo(tracer_pid, fd)
    prog_fdinfo = kernel.fdinfo(tracer_pid, entry["prog_fd"])
    _require(link_fdinfo == {"link_type": "kprobe_multi",
                             "link_id": link_id, "prog_id": prog_id},
             "LINK_FD_OWNERSHIP_MISMATCH")
    _require(prog_fdinfo == {"prog_type": KPROBE_PROG_TYPE,
                             "prog_id": prog_id},
             "PROGRAM_FD_MISMATCH")
    info = kernel.link_info(tracer_pid, fd)
    program = kernel.prog_info(tracer_pid, entry["prog_fd"])
    _require(info.get("type") == KPROBE_MULTI_LINK_TYPE and
             info.get("id") == link_id and info.get("prog_id") == prog_id and
             program == {"type": KPROBE_PROG_TYPE, "id": prog_id},
             "KERNEL_OBJECT_IDENTITY_MISMATCH")
    _require(type(info.get("count")) is int and info["count"] == 1 and
             info.get("flags") == 0 and type(info.get("flags")) is int and
             type(info.get("missed")) is int and info["missed"] == 0,
             "WRONG_LINK_ATTACH_METADATA")

    # Re-read the live proc FD ownership and process identity *after* syscall
    # inspection: a closed/reused FD must never satisfy historical evidence.
    _require(kernel.pid_start(tracer_pid) == expected_start and
             kernel.fdinfo(tracer_pid, fd) == link_fdinfo and
             kernel.fdinfo(tracer_pid, entry["prog_fd"]) == prog_fdinfo,
             "STALE_OR_REUSED_DESCRIPTOR")
    return {"result": "PASS", "session": "KPROBE_SESSION",
            "pid": tracer_pid, "link_id": link_id, "program_id": prog_id,
            "target": "KERNEL_RESOLVED_TCP_SENDMSG", "owner_fd": fd}


class LinuxKernelView:
    """Read-only BPF info syscalls plus kernel-backed process FD ownership."""

    def __init__(self):
        assert_kernel_abi()
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.syscall.restype = ctypes.c_long

    def pid_start(self, pid):
        try:
            raw = Path(f"/proc/{pid}/stat").read_text()
            fields = raw[raw.rfind(")") + 2:].split()
            return int(fields[19])  # starttime, kernel stat field 22
        except (OSError, ValueError, IndexError):
            raise AttestationError("PROCESS_START_UNAVAILABLE") from None

    def fdinfo(self, pid, fd):
        _require(_integer(pid, 2, 4194304) and _integer(fd, 0, 65535),
                 "INVALID_DESCRIPTOR")
        try:
            raw = Path(f"/proc/{pid}/fdinfo/{fd}").read_text()
        except OSError:
            raise AttestationError("FDINFO_UNAVAILABLE") from None
        result = {}
        for line in raw.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            if key in ("link_type", "link_id", "prog_id", "prog_type"):
                _require(key not in result, "DUPLICATE_FDINFO_FIELD")
                value = value.strip()
                if key == "link_type":
                    _require(value == "kprobe_multi", "WRONG_FDINFO_TYPE")
                    result[key] = value
                else:
                    _require(bool(re.fullmatch(r"[0-9]{1,10}", value)),
                             "INVALID_FDINFO_FIELD")
                    result[key] = int(value)
        return result

    def _duplicate_fd(self, pid, fd):
        try:
            pidfd = os.pidfd_open(pid)
        except (AttributeError, OSError):
            raise AttestationError("PIDFD_UNAVAILABLE") from None
        try:
            value = self.libc.syscall(SYS_PIDFD_GETFD_X86_64,
                                      pidfd, fd, 0)
            _require(value >= 0, "PIDFD_GETFD_FAILED")
            return int(value)
        finally:
            os.close(pidfd)

    def _bpf_info(self, pid, target_fd, info):
        duplicate = self._duplicate_fd(pid, target_fd)
        try:
            attr = _InfoAttr(duplicate, ctypes.sizeof(info),
                             ctypes.addressof(info))
            status = self.libc.syscall(SYS_BPF_X86_64,
                                       BPF_OBJ_GET_INFO_BY_FD,
                                       ctypes.byref(attr),
                                       ctypes.sizeof(attr),
                                       0, 0)
            # Linux 7.3's bpf syscall has five parameters (common attr pair
            # at positions 4/5). Zeroing both remains safe on older kernels.
            _require(status == 0 and attr.len >= ctypes.sizeof(info),
                     "BPF_INFO_UNAVAILABLE")
        finally:
            os.close(duplicate)

    def link_info(self, pid, fd):
        header = _LinkInfo()
        self._bpf_info(pid, fd, header)
        _require(header.type == KPROBE_MULTI_LINK_TYPE and
                 header.kprobe.count == 1, "LINK_COUNT_OR_TYPE_MISMATCH")
        # Never request addresses; kernel.kptr_restrict=2 remains intact.
        return {"type": header.type, "id": header.id,
                "prog_id": header.prog_id,
                "count": header.kprobe.count,
                "flags": header.kprobe.flags,
                "missed": header.kprobe.missed}

    def prog_info(self, pid, fd):
        info = _ProgInfo()
        self._bpf_info(pid, fd, info)
        return {"type": info.type, "id": info.id}

class TracefsCreationAttestor:
    """Run-scoped tracefs lifecycle. start() MUST precede tracer creation."""

    def __init__(self, run_id, seconds=20, root=TRACE_ROOT):
        match = RUN_ID.fullmatch(run_id) if type(run_id) is str else None
        _require(match is not None and _integer(seconds, 1, MAX_SECONDS),
                 "INVALID_ATTESTOR_SCOPE")
        self.group = "clack_muse_" + match.group(1)
        self.root = Path(root)
        self.instance = self.root / "instances" / self.group
        self.seconds = seconds
        self.created = []
        self.enabled = []
        self.instance_owned = False
        self.closed = False
        self.started = False
        self.deadline = 0.0
        self.stop_reader = threading.Event()
        self.events = []
        self.failure = None
        self.reader = None
        self.read_fd = None
        self.partial = b""

    def _event_ctl(self, line):
        # This is deliberately the *only* global tracefs write target.
        path = self.root / "kprobe_events"
        try:
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CLOEXEC)
        except OSError as error:
            raise AttestationError(
                "TRACEFS_CONTROL_OPEN_" + errno.errorcode.get(
                    error.errno, "UNKNOWN")) from None
        try:
            data = (line + "\n").encode("ascii")
            try:
                _require(os.write(fd, data) == len(data),
                         "TRACEFS_SHORT_WRITE")
            except OSError as error:
                raise AttestationError(
                    "TRACEFS_PROBE_DEFINITION_" + errno.errorcode.get(
                        error.errno, "UNKNOWN")) from None
        finally:
            os.close(fd)

    @staticmethod
    def _write(path, value):
        with open(path, "w", encoding="ascii") as output:
            output.write(value)

    def _validate_event_format(self, event):
        event_dir = self.instance / "events" / self.group / event
        fmt = (event_dir / "format").read_text()
        fields = (("progfd", "attach", "flags", "cnt")
                  if event.startswith("enter_") else
                  ("cnt", "sym") if event.startswith("lookup_")
                  else ("result",))
        _require(bool(re.search(
            r"^\s*field:[^\n]*\bcommon_pid\s*;", fmt, re.M)) and
            all(re.search(r"^\s*field:[^\n]*\b" + re.escape(field) +
                          r"\s*;", fmt, re.M) for field in fields),
            "TRACEFS_EVENT_FORMAT_UNAVAILABLE")
        if event.startswith("lookup_"):
            _require(bool(re.search(
                r"^\s*field:__data_loc\s+char\[\]\s+sym\s*;",
                fmt, re.M)), "TRACEFS_KERNEL_STRING_FETCH_UNSUPPORTED")
        return event_dir

    def _mount_and_symbol_preflight(self):
        _require(os.geteuid() == 0, "ROOT_REQUIRED")
        assert_kernel_abi()
        _require(platform.release() == "7.3.1-1-cachyos",
                 "PINNED_KERNEL_CHANGED")
        _require(self.root == TRACE_ROOT and not self.root.is_symlink(),
                 "TRACEFS_PATH_MISMATCH")
        try:
            mounts = Path("/proc/self/mountinfo").read_text()
            _require(any(line.split(" - ")[-1].split()[0] == "tracefs" and
                         line.split(" ")[4] == str(self.root)
                         for line in mounts.splitlines()),
                     "TRACEFS_NOT_MOUNTED")
            _require((self.root / "kprobe_events").is_file() and
                     (self.root / "instances").is_dir(),
                     "TRACEFS_KPROBE_INTERFACE_UNAVAILABLE")
            for symbol in (SYMBOL, LOOKUP_SYMBOL):
                _kernel_symbol_present(symbol)
        except OSError:
            raise AttestationError("TRACEFS_PREFLIGHT_UNAVAILABLE") from None

    def start(self):
        _require(not self.started, "ATTESTOR_REUSED")
        self.started = True
        try:
            self._mount_and_symbol_preflight()
            os.mkdir(self.instance, 0o700)
            self.instance_owned = True
            suffix = self.group[len("clack_muse_"):]
            for spec, event in zip(
                    trace_definitions(self.group),
                    (f"enter_{suffix}", f"leave_{suffix}",
                     f"lookup_{suffix}", f"lookret_{suffix}")):
                self._event_ctl(spec)
                self.created.append(event)
            for event in self.created:
                event_dir = self._validate_event_format(event)
                self._write(event_dir / "enable", "1\n")
                self.enabled.append(event)
            self._write(self.instance / "tracing_on", "1\n")
            self.read_fd = self._open_trace_pipe()
            self.deadline = time.monotonic() + self.seconds
            self.reader = threading.Thread(target=self._read_events, daemon=True)
            self.reader.start()
        except (OSError, AttestationError) as error:
            reason = (str(error) if isinstance(error, AttestationError)
                      else "TRACEFS_SETUP_OSERROR_" +
                      errno.errorcode.get(error.errno, "UNKNOWN"))
            try:
                self.close()
            except AttestationError:
                raise AttestationError("TRACEFS_SETUP_CLEANUP_FAILED") from None
            raise AttestationError(reason) from None

    def _read_events(self):
        try:
            while not self.stop_reader.is_set():
                if time.monotonic() >= self.deadline:
                    self.failure = "TRACEFS_DEADLINE_EXCEEDED"
                    break
                try:
                    chunk = os.read(self.read_fd, 4096)
                except BlockingIOError:
                    self.stop_reader.wait(0.015)
                    continue
                if not chunk:
                    self.stop_reader.wait(0.015)
                    continue
                self.partial += chunk
                while b"\n" in self.partial:
                    line, self.partial = self.partial.split(b"\n", 1)
                    _require(len(line) <= MAX_LINE_BYTES and
                             len(self.events) < MAX_LINES,
                             "TRACEFS_BUFFER_BOUND_EXCEEDED")
                    decoded = line.decode("ascii")
                    self.events.append(parse_trace_line(decoded, self.group))
                _require(len(self.partial) <= MAX_LINE_BYTES,
                         "TRACEFS_PARTIAL_LINE_OVERSIZE")
        except (OSError, UnicodeError, AttestationError):
            self.failure = "TRACEFS_CAPTURE_FAILURE"

    def _open_trace_pipe(self):
        return os.open(self.instance / "trace_pipe",
                       os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)

    def _check_loss(self):
        try:
            cpu_dirs = list((self.instance / "per_cpu").glob("cpu[0-9]*"))
            _require(bool(cpu_dirs), "TRACEFS_LOSS_STATUS_UNAVAILABLE")
            for cpu in cpu_dirs:
                stats = (cpu / "stats").read_text()
                for field in ("overrun", "commit overrun", "dropped events"):
                    values = re.findall(r"^" + re.escape(field) +
                                        r":\s*(\d+)\s*$", stats, re.M)
                    _require(len(values) == 1 and int(values[0]) == 0,
                             "TRACEFS_EVENT_LOSS_OR_UNKNOWN")
        except OSError:
            raise AttestationError("TRACEFS_LOSS_STATUS_UNAVAILABLE") from None

    def stop(self):
        _require(self.started, "ATTESTOR_NOT_STARTED")
        _require(time.monotonic() <= self.deadline,
                 "TRACEFS_DEADLINE_EXCEEDED")
        self.stop_reader.set()
        if self.reader is not None:
            self.reader.join(timeout=1)
            _require(not self.reader.is_alive(), "TRACEFS_READER_STUCK")
        _require(self.failure is None and not self.partial,
                 "TRACEFS_INCOMPLETE_CAPTURE")
        self._check_loss()
        return tuple(self.events)

    def close(self):
        if self.closed:
            return
        self.stop_reader.set()
        if self.reader is not None:
            self.reader.join(timeout=1)
        errors = bool(self.reader is not None and self.reader.is_alive())
        if self.read_fd is not None:
            try:
                os.close(self.read_fd)
            except OSError:
                errors = True
            self.read_fd = None
        for event in reversed(self.enabled):
            try:
                self._write(self.instance / "events" / self.group /
                            event / "enable", "0\n")
            except OSError:
                errors = True
        self.enabled.clear()
        if self.instance_owned:
            try:
                _require(self.instance.is_dir(), "TRACEFS_INSTANCE_DISAPPEARED")
                self._destroy_instance()
            except (OSError, AttestationError):
                errors = True
            self.instance_owned = False
        for event in reversed(self.created):
            try:
                self._event_ctl(f"-:{self.group}/{event}")
            except (OSError, AttestationError):
                errors = True
        self.created.clear()
        _require(not errors, "TRACEFS_CLEANUP_FAILED")
        self.closed = True

    def _destroy_instance(self):
        os.rmdir(self.instance)

    def check_registration_only(self):
        """ONE bounded root-only registration test; never enable probes.

        Register all four dynamic events, inspect their formats and disabled
        state, then remove them and the private instance on every path.
        No tracing_on change, no trace_pipe read, no tracer, no BPF object.
        """
        _require(not self.started, "ATTESTOR_REUSED")
        self.started = True
        success = False
        try:
            self._mount_and_symbol_preflight()
            os.mkdir(self.instance, 0o700)
            self.instance_owned = True
            suffix = self.group[len("clack_muse_"):]
            events = (f"enter_{suffix}", f"leave_{suffix}",
                      f"lookup_{suffix}", f"lookret_{suffix}")
            for spec, event in zip(trace_definitions(self.group), events):
                self._event_ctl(spec)
                self.created.append(event)
                event_dir = self._validate_event_format(event)
                disabled = (event_dir / "enable").read_text().strip()
                _require(disabled == "0",
                         "REGISTRATION_EVENT_NOT_DISABLED")
            _require(len(self.created) == 4, "INCOMPLETE_REGISTRATION")
            success = True
        finally:
            self.close()
        _require(success, "REGISTRATION_UNVERIFIED")
        return {"result": "PASS", "registered": 4,
                "string_fetch": "KERNEL_INDIRECT_STRING",
                "bpf_objects_created": 0, "tracefs_cleanup": "PASS"}

    def verify_and_close(self, tracer_pid, expected_start, link_id, prog_id,
                         kernel=None):
        """Returns PASS only *after* all event and tracefs cleanup succeeds."""
        try:
            events = self.stop()
            result = verify_normalized(events, tracer_pid, expected_start,
                                       link_id, prog_id,
                                       kernel if kernel is not None else
                                       LinuxKernelView())
        finally:
            self.close()
        return result


if __name__ == "__main__":
    args = argparse.ArgumentParser(description="Root-local tracefs attestor")
    args.add_argument("--registration-only", action="store_true")
    args.add_argument("--scope", default="")
    config = args.parse_args()
    if not config.registration_only:
        raise SystemExit("LIBRARY_ONLY_NO_LIVE_ATTACH")
    def registration_timeout(_signum, _frame):
        raise AttestationError("REGISTRATION_DEADLINE_EXCEEDED")

    previous_alarm_handler = signal.signal(signal.SIGALRM,
                                           registration_timeout)
    signal.alarm(12)
    try:
        try:
            status = TracefsCreationAttestor(
                config.scope).check_registration_only()
        except AttestationError as error:
            print("TRACEFS_SYMBOL_ATTESTATION_UNAVAILABLE=" + str(error))
            raise SystemExit(1) from None
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_alarm_handler)
    print("TRACEFS_REGISTRATION_ONLY=" + status["result"])
    print("TRACEFS_REGISTERED_EVENTS=" + str(status["registered"]))
    print("TRACEFS_KERNEL_STRING_FETCH=" + status["string_fetch"])
    print("TRACEFS_BPF_OBJECTS_CREATED=0")
    print("TRACEFS_CLEANUP=PASS")
