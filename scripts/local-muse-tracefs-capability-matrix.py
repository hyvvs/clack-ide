#!/usr/bin/env python3
"""One read-only-except-disabled-tracefs-registration capability campaign.

Only bpf_kprobe_multi_link_attach and ftrace_lookup_symbols may be probed.
All probes are never enabled, immediately unregistered, and uniquely named.
No tracer, BPF creation, address disclosure, memory fetch or trace capture.
Only fixed-category error diagnostics and validated tracefs FORMAT metadata
leave the root process. Linux 7.3.1-1-cachyos, x86_64 only.
"""
import argparse
import ctypes
import errno
import hashlib
import json
import os
import platform
import re
import signal
import time
from pathlib import Path

TRACE = Path("/sys/kernel/tracing")
OUTER = "bpf_kprobe_multi_link_attach"
LOOKUP = "ftrace_lookup_symbols"
RUN_RE = re.compile(r"muse-one-[0-9a-f]{24}\Z")
MAX_ATTEMPTS = 48
MAX_SECS = 60
MAX_INVENTORY = 4096
MAX_KPROBE_FILE = 1024 * 1024
MAX_ERROR_LOG = 128 * 1024
MAX_FORMAT = 8192
BPF_PROG_NEXT_ID = 11
BPF_LINK_NEXT_ID = 31
SYS_BPF = 321


class MatrixError(Exception):
    pass


def require(test, reason):
    if not test:
        raise MatrixError(reason)


def cases():
    """Immutable lattice; tests progress through symbol, field, join classes."""
    caseset = [
        ("A_O_E", OUTER, "entry", "symbol", ""),
        ("A_O_R", OUTER, "return", "symbol", ""),
        ("A_L_E", LOOKUP, "entry", "symbol", ""),
        ("A_L_R", LOOKUP, "return", "symbol", ""),
        ("B_ARG1", OUTER, "entry", "arg1", "a=$arg1"),
        ("B_ARG2", OUTER, "entry", "arg2", "a=$arg2"),
        ("B_ARG1_U64", OUTER, "entry", "arg1_u64", "a=$arg1:u64"),
        ("B_ARG1_X64", OUTER, "entry", "arg1_x64", "a=$arg1:x64"),
        ("B_FD0", OUTER, "entry", "prog_fd_0", "progfd=+0($arg1):u32"),
        ("B_ATTACH8", OUTER, "entry", "attach_type_8", "attach=+8($arg1):u32"),
        ("B_FLAGS16", OUTER, "entry", "flags_16", "flags=+16($arg1):u32"),
        ("B_CNT20", OUTER, "entry", "count_20", "cnt=+20($arg1):u32"),
        ("B_FD0_U64", OUTER, "entry", "prog_fd_0_u64", "progfd=+0($arg1):u64"),
        ("B_ATTACH8_U64", OUTER, "entry", "attach_type_8_u64", "attach=+8($arg1):u64"),
        ("B_FLAGS16_U64", OUTER, "entry", "flags_16_u64", "flags=+16($arg1):u64"),
        ("B_CNT20_U64", OUTER, "entry", "count_20_u64", "cnt=+20($arg1):u64"),
        ("B_FULL32", OUTER, "entry", "outer_full_u32",
         "progfd=+0($arg1):u32 attach=+8($arg1):u32 "
         "flags=+16($arg1):u32 cnt=+20($arg1):u32"),
        ("B_FULL64", OUTER, "entry", "outer_full_u64",
         "progfd=+0($arg1):u64 attach=+8($arg1):u64 "
         "flags=+16($arg1):u64 cnt=+20($arg1):u64"),
        ("C_RET", OUTER, "return", "retval_default", "result=$retval"),
        ("C_S32", OUTER, "return", "retval_s32", "result=$retval:s32"),
        ("C_U32", OUTER, "return", "retval_u32", "result=$retval:u32"),
        ("C_S64", OUTER, "return", "retval_s64", "result=$retval:s64"),
        ("D_ARG2", LOOKUP, "entry", "lookup_count_raw", "cnt=$arg2"),
        ("D_COUNT32", LOOKUP, "entry", "lookup_count_u32", "cnt=$arg2:u32"),
        ("D_COUNT64", LOOKUP, "entry", "lookup_count_u64", "cnt=$arg2:u64"),
        ("D_COUNTX64", LOOKUP, "entry", "lookup_count_x64", "cnt=$arg2:x64"),
        ("D_ARG1", LOOKUP, "entry", "lookup_arg1", "a=$arg1"),
        ("D_PTR", LOOKUP, "entry", "kernel_pointer_only", "first=+0($arg1):x64"),
        ("D_DEREF", LOOKUP, "entry", "kernel_nested_numeric", "first=+0(+0($arg1)):x8"),
        ("D_STRING_NEST", LOOKUP, "entry", "kernel_nested_string",
         "sym=+0(+0($arg1)):string"),
        ("D_STRING_ARRAY", LOOKUP, "entry", "kernel_string_array",
         "sym=+0($arg1):string[1]"),
        ("D_STRING_REGISTER", LOOKUP, "entry", "kernel_x86_64_register_string",
         "sym=+0(+0(%di)):string"),
        ("D_FULL_NEST64", LOOKUP, "entry", "lookup_full_nested_u64",
         "cnt=$arg2:u64 sym=+0(+0($arg1)):string"),
        ("D_FULL_NEST32", LOOKUP, "entry", "lookup_full_nested_u32",
         "cnt=$arg2:u32 sym=+0(+0($arg1)):string"),
        ("D_FULL_ARRAY64", LOOKUP, "entry", "lookup_full_array_u64",
         "cnt=$arg2:u64 sym=+0($arg1):string[1]"),
        ("D_FULL_ARRAY32", LOOKUP, "entry", "lookup_full_array_u32",
         "cnt=$arg2:u32 sym=+0($arg1):string[1]"),
        ("E_RET", LOOKUP, "return", "lookup_retval_default", "result=$retval"),
        ("E_S32", LOOKUP, "return", "lookup_retval_s32", "result=$retval:s32"),
        ("E_U32", LOOKUP, "return", "lookup_retval_u32", "result=$retval:u32"),
        ("E_S64", LOOKUP, "return", "lookup_retval_s64", "result=$retval:s64"),
    ]
    require(len(caseset) <= MAX_ATTEMPTS and len(set(x[0] for x in caseset))
            == len(caseset), "INVALID_CAPABILITY_LATTICE")
    return caseset


class _NextID(ctypes.Structure):
    _fields_ = [("start_id", ctypes.c_uint32),
                ("next_id", ctypes.c_uint32),
                ("open_flags", ctypes.c_uint32)]


def bpf_ids():
    """Only BPF_GET_NEXT_ID commands; no BPF creation or FD acquisition."""
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    result = {}
    for label, command in (("prog", BPF_PROG_NEXT_ID),
                           ("link", BPF_LINK_NEXT_ID)):
        ids, prev = [], 0
        for _ in range(MAX_INVENTORY + 1):
            attr = _NextID(prev, 0, 0)
            rc = libc.syscall(SYS_BPF, command, ctypes.byref(attr),
                              ctypes.sizeof(attr), 0, 0)
            if rc != 0:
                require(ctypes.get_errno() == errno.ENOENT,
                        "BPF_ID_SNAPSHOT_UNAVAILABLE")
                break
            require(attr.next_id > prev and len(ids) < MAX_INVENTORY,
                    "BPF_ID_SNAPSHOT_BOUND")
            ids.append(int(attr.next_id))
            prev = int(attr.next_id)
        else:
            raise MatrixError("BPF_ID_SNAPSHOT_BOUND")
        result[label] = tuple(ids)
    return result


def tracefs_snapshot(root, group):
    """Digest unrelated kprobe definitions and main tracefs controls."""
    result = {}
    try:
        for name in ("kprobe_events", "tracing_on", "current_tracer",
                     "events/enable", "set_event"):
            path = root / name
            contents = path.read_bytes()
            require(len(contents) <= MAX_KPROBE_FILE,
                    "TRACEFS_SNAPSHOT_BOUND")
            if name == "kprobe_events":
                lines = contents.splitlines(keepends=True)
                require(not any(group.encode() in line for line in lines),
                        "RUN_SCOPED_PROBE_ALREADY_PRESENT")
            result[name] = hashlib.sha256(contents).hexdigest()
        return result
    except (OSError, UnicodeError):
        raise MatrixError("TRACEFS_SNAPSHOT_UNAVAILABLE") from None


def normalized_parser_detail(log, event, expression):
    """No raw error_log content crosses process boundary."""
    if not isinstance(log, str):
        return ("UNAVAILABLE", -1, -1)
    # Attribute only the newest block naming this unique test event; never
    # interpret unrelated, previously logged parser text as this failure.
    log = log[-MAX_ERROR_LOG:]
    position = log.rfind(event)
    if position < 0:
        return ("UNAVAILABLE", -1, -1)
    section = log[max(0, position - 160):min(len(log), position + 320)]
    families = (
        ("BAD_PROBE_ADDRESS", r"BAD_PROBE_ADDR|bad probe|unknown symbol|not traceable"),
        ("BAD_FETCH_ARGUMENT", r"BAD_FETCH_ARG|BAD_INSN_BNDRY|FETCH|dereference|fetch argument"),
        ("BAD_TYPE", r"BAD_TYPE|invalid type|unsupported type"),
        ("BAD_STRING", r"BAD_STRING|string(?: array)?|SYMBOL|symbol"),
        ("ARGUMENT_OFFSET", r"BAD_OFFSET|offset|^\s*\^"),
        ("NAME_REJECTED", r"BAD_EVENT_NAME|BAD_GROUP_NAME|invalid event"),
        ("INVALID_ARGUMENT", r"invalid argument|EINVAL"),
    )
    category = next((category for category, regex in families
                     if re.search(regex, section, re.I | re.M)), "PARSER_OTHER")
    # Can only attribute an offset if the parser points within a copy of the
    # *same* controlled expression. No guess based on unrelated error lines.
    offset = -1
    index = -1
    for line in section.splitlines()[-10:]:
        if "^" in line and re.fullmatch(r"\s*\^\s*", line):
            # Tab/indent convention of error_log is not guaranteed; export
            # no false offsets unless the parser provides explicit numeric.
            break
    n = re.search(r"\b(?:arg(?:ument)?|index)\s*[=:]\s*(\d{1,3})\b", section, re.I)
    if n:
        index = int(n.group(1))
    n = re.search(r"\boffset\s*[=:]\s*(\d{1,5})\b", section, re.I)
    if n:
        offset = int(n.group(1))
    return category, index, offset


def _event_format_status(data, fetch_class):
    """Classify field structure without storing arbitrary kernel format text."""
    names = tuple(re.findall(r"\bfield:[^\n;]*\b([a-zA-Z_][a-zA-Z_0-9]*)\s*;",
                             data))
    dynamic = bool(re.search(r"field:__data_loc\s+char\[\]\s+sym\s*;",
                             data))
    def shape(name):
        m = re.search(r"^\s*field:[^\n;]*\b" + re.escape(name) +
                      r"\s*;\s*offset:\s*\d+;\s*size:\s*(\d+);"
                      r"\s*signed:\s*(\d+);", data, re.M)
        return (int(m.group(1)), int(m.group(2))) if m else None
    if shape("common_pid") != (4, 1):
        return False, dynamic
    if fetch_class.startswith("lookup_full"):
        expected = 8 if fetch_class.endswith("u64") else 4
        valid = (shape("cnt") == (expected, 0) and
                 "sym" in names and dynamic)
    elif fetch_class.startswith("outer_full"):
        expected = 4 if fetch_class.endswith("u32") else 8
        valid = all(shape(f) == (expected, 0)
                    for f in ("progfd", "attach", "flags", "cnt"))
    elif fetch_class.startswith("retval") or fetch_class.startswith("lookup_retval"):
        if fetch_class.endswith("s32"):
            valid = shape("result") == (4, 1)
        elif fetch_class.endswith("s64"):
            valid = shape("result") == (8, 1)
        elif fetch_class.endswith("u32"):
            valid = shape("result") == (4, 0)
        else:
            valid = "result" in names
    elif "string" in fetch_class:
        valid = "sym" in names and dynamic
    else:
        valid = True
    return valid, dynamic


def pick_accepted(rows):
    good = {r["id"]: r for r in rows if r["status"] == "PASS"}
    for group, ids in (
        ("OUTER_ENTRY_SYMBOL", ["A_O_E"]),
        ("OUTER_RETURN_SYMBOL", ["A_O_R"]),
        ("LOOKUP_ENTRY_SYMBOL", ["A_L_E"]),
        ("LOOKUP_RETURN_SYMBOL", ["A_L_R"]),
        # Every BPF_LINK_CREATE prefix field here is *u32*. A successful
        # u64 fetch crosses into adjacent fields and is NOT equivalent proof.
        ("OUTER_ARGS", ["B_FULL32"]),
        ("OUTER_RETURN_FD", ["C_S32", "C_S64"]),
        ("KERNEL_COPIED_TARGET", ["D_FULL_NEST64", "D_FULL_NEST32",
                                  "D_FULL_ARRAY64", "D_FULL_ARRAY32"]),
        ("LOOKUP_RETURN_STATUS", ["E_S32", "E_S64"]),
    ):
        matching = [x for x in ids if x in good]
        if not matching:
            return None, group
    selected = ("B_FULL32",
                "C_S32" if "C_S32" in good else "C_S64",
                next(x for x in ("D_FULL_NEST64", "D_FULL_NEST32",
                                 "D_FULL_ARRAY64", "D_FULL_ARRAY32") if x in good),
                "E_S32" if "E_S32" in good else "E_S64")
    byid = {c[0]: c for c in cases()}
    definitions = []
    for n, cid in enumerate(selected):
        case = byid[cid]
        prefix = "p" if case[2] == "entry" else "r"
        definitions.append(prefix + ":<run-group>/<run-event-" + str(n + 1) +
                           "> " + case[1] + (" " + case[4] if case[4] else ""))
    return {"ids": list(selected), "definitions": definitions}, None


class Matrix:
    def __init__(self, scope, root=TRACE):
        require(type(scope) is str and RUN_RE.fullmatch(scope) is not None,
                "INVALID_RUN_SCOPE")
        self.group = "clack_cap_" + scope[len("muse-one-"):]
        self.root = Path(root)
        self.rows = []
        self.attempts = 0
        self.deadline = 0.
        self.baseline = None
        self.bpf_baseline = None
        self.registered = set()
        self.cleanup_error = None

    def preflight(self):
        require(os.geteuid() == 0, "ROOT_REQUIRED")
        require(platform.system() == "Linux" and platform.machine() == "x86_64"
                and platform.release() == "7.3.1-1-cachyos",
                "PINNED_HOST_KERNEL_OR_ARCH_CHANGED")
        require(self.root == TRACE and not self.root.is_symlink(),
                "UNTRUSTED_TRACEFS_PATH")
        mount_lines = Path("/proc/self/mountinfo").read_text()
        require(any(line.split(" - ")[-1].split()[0] == "tracefs" and
                    line.split()[4] == str(self.root)
                    for line in mount_lines.splitlines()),
                "TRACEFS_NOT_MOUNTED")
        require((self.root / "kprobe_events").is_file() and
                (self.root / "events").is_dir(),
                "KPROBE_EVENTS_UNAVAILABLE")
        self.baseline = tracefs_snapshot(self.root, self.group)
        self.bpf_baseline = bpf_ids()
        self.deadline = time.monotonic() + 55

    def time_left(self):
        require(time.monotonic() < self.deadline, "MATRIX_DEADLINE_EXCEEDED")

    def _write_definition(self, line):
        raw = (line + "\n").encode("ascii")
        fd = os.open(self.root / "kprobe_events",
                     os.O_WRONLY | os.O_APPEND | os.O_CLOEXEC)
        try:
            require(os.write(fd, raw) == len(raw), "TRACEFS_SHORT_WRITE")
        finally:
            os.close(fd)

    def _raw_parser_log(self):
        try:
            raw = (self.root / "error_log").read_bytes()
            if len(raw) > MAX_ERROR_LOG:
                return ""
            return raw.decode("utf-8", errors="replace")
        except OSError:
            return ""

    def _remove_event(self, event):
        ctl = self.root / "kprobe_events"
        # Never remove another group: every event is unique and run-scoped.
        require(re.fullmatch(r"cap[0-9]{2}_[0-9a-f]{24}", event) is not None,
                "INVALID_CLEANUP_EVENT")
        eventdir = self.root / "events" / self.group / event
        raw_before = ctl.read_bytes()
        require(len(raw_before) <= MAX_KPROBE_FILE, "EVENT_DEFINITION_BOUND")
        appears = (self.group + "/" + event).encode() in raw_before
        if not appears and not eventdir.exists():
            self.registered.discard(event)
            return
        # A registration-only event must be disabled. If it is unexpectedly
        # enabled, disable *only this owned event* before deleting it and
        # report a permanent safety failure; never leave it attached.
        enable_path = eventdir / "enable"
        was_enabled = (enable_path.exists() and
                       enable_path.read_text().strip() != "0")
        if was_enabled:
            with enable_path.open("w", encoding="ascii") as enable_file:
                enable_file.write("0\n")
        try:
            self._write_definition("-:" + self.group + "/" + event)
        except OSError as error:
            require(error.errno == errno.ENOENT, "EVENT_CLEANUP_ERROR")
        # Independent per-test verification; absence cannot be inferred from
        # success status of the command itself.
        require(not (self.root / "events" / self.group / event).exists(),
                "EVENT_DIRECTORY_REMAINS")
        raw = ctl.read_bytes()
        require(len(raw) <= MAX_KPROBE_FILE and
                (self.group + "/" + event).encode() not in raw,
                "EVENT_DEFINITION_REMAINS")
        self.registered.discard(event)
        require(not was_enabled, "EVENT_UNEXPECTEDLY_ENABLED")

    def attempt(self, idx, case):
        self.time_left()
        require(self.attempts < MAX_ATTEMPTS, "ATTEMPT_LIMIT")
        cid, symbol, kind, category, fetch = case
        event = f"cap{idx:02d}_{self.group[len('clack_cap_'):]}"
        prefix = "p" if kind == "entry" else "r"
        definition = prefix + ":" + self.group + "/" + event + " " + symbol
        if fetch:
            definition += " " + fetch
        row = {"id": cid, "symbol": symbol, "kind": kind,
               "fetch_class": category, "errno": "NONE",
               "parser_category": "NONE", "parser_arg_index": -1,
               "parser_offset": -1, "status": "FAIL",
               "string_format": False}
        self.attempts += 1
        self.registered.add(event)  # include failed-but-partial writes
        log_before = self._raw_parser_log()
        try:
            try:
                self._write_definition(definition)
            except OSError as error:
                row["errno"] = errno.errorcode.get(error.errno, "UNKNOWN")
                log_after = self._raw_parser_log()
                # Tracefs error_log is global; require new content to avoid
                # erroneously attributing prior unrelated error messages.
                log_delta = (log_after[len(log_before):]
                             if log_after.startswith(log_before) else
                             log_after if log_after != log_before else "")
                category, index, offset = normalized_parser_detail(
                    log_delta, event, fetch)
                row["parser_category"] = category
                row["parser_arg_index"] = index
                row["parser_offset"] = offset
            else:
                directory = self.root / "events" / self.group / event
                enable = (directory / "enable").read_text().strip()
                require(enable == "0", "UNEXPECTED_TRACEFS_EVENT_ENABLED")
                fmt = (directory / "format").read_text()
                require(len(fmt) <= MAX_FORMAT, "EVENT_FORMAT_BOUND")
                valid, dynamic = _event_format_status(fmt, category)
                row["string_format"] = dynamic
                if valid:
                    row["status"] = "PASS"
                else:
                    row["parser_category"] = "FORMAT_NOT_EQUIVALENT"
        except (OSError, UnicodeError) as error:
            row["errno"] = errno.errorcode.get(getattr(error, "errno", 0), "UNKNOWN")
            row["parser_category"] = "FORMAT_OR_READ_ERROR"
        finally:
            self._remove_event(event)
        self.rows.append(row)
        self.time_left()

    def independent_cleanup(self):
        # Attempts no cleanup of unrelated events, tracing state, or BPF.
        require(not self.registered, "UNCLEAN_REGISTRATION_SET")
        require(not (self.root / "events" / self.group).exists(),
                "RUN_SCOPED_EVENTS_REMAIN")
        require(not (self.root / "instances" / self.group).exists(),
                "RUN_SCOPED_INSTANCE_REMAINS")
        require(tracefs_snapshot(self.root, self.group) == self.baseline,
                "UNRELATED_TRACEFS_STATE_CHANGED")
        require(bpf_ids() == self.bpf_baseline,
                "BPF_ID_SET_CHANGED")
        return True

    def run(self):
        self.preflight()
        selected, gap, failure = None, None, None
        try:
            for idx, case in enumerate(cases(), 1):
                self.attempt(idx, case)
            selected, gap = pick_accepted(self.rows)
        except (MatrixError, OSError) as error:
            failure = (str(error) if isinstance(error, MatrixError)
                       else "MATRIX_IO_FAILURE")
        finally:
            # Cleanup verification must run even on deadline or parser error.
            for event in tuple(sorted(self.registered)):
                try:
                    self._remove_event(event)
                except (OSError, MatrixError):
                    self.cleanup_error = "TRACEFS_CLEANUP_FAILED"
            try:
                self.independent_cleanup()
            except (OSError, MatrixError):
                self.cleanup_error = "INDEPENDENT_CLEANUP_VERIFICATION_FAILED"
        require(self.cleanup_error is None, self.cleanup_error or "CLEANUP_FAILURE")
        return {"version": 1, "attempts": self.attempts,
                "max_attempts": MAX_ATTEMPTS,
                "max_seconds": MAX_SECS,
                "tests": self.rows,
                "selected": selected,
                "gap": failure or gap, "cleanup": "PASS", "bpf_objects": "UNCHANGED",
                "unrelated_tracing": "UNCHANGED"}


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--campaign", required=True)
    args = cli.parse_args()
    def alarm_handler(_sig, _frame):
        raise MatrixError("MATRIX_WATCHDOG_EXPIRED")
    previous = signal.signal(signal.SIGALRM, alarm_handler)
    signal.alarm(58)
    result = None
    failure = None
    try:
        runner = Matrix(args.campaign)
        result = runner.run()
    except (MatrixError, OSError) as error:
        failure = str(error) if isinstance(error, MatrixError) else (
            "MATRIX_OSERROR_" + errno.errorcode.get(error.errno, "UNKNOWN"))
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)
    if result is None:
        print("TRACEFS_CAPABILITY_MATRIX=FAIL")
        print("TRACEFS_EXACT_GAP=" + (failure or "UNKNOWN"))
        print("TRACEFS_CLEANUP=UNVERIFIED")
        return 1
    print("TRACEFS_COMPATIBILITY_JSON=" + json.dumps(
        result, sort_keys=True, separators=(",", ":")))
    print("TRACEFS_CLEANUP=PASS")
    if result["gap"] is not None:
        print("TRACEFS_CAPABILITY_MATRIX=FAIL")
        print("TRACEFS_EXACT_GAP=" + result["gap"])
        return 1
    print("TRACEFS_CAPABILITY_MATRIX=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
