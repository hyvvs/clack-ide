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
try:
    import resource  # POSIX only; production is Linux root.
except ImportError:
    resource = None


# Bind this independently reviewed wrapper to the *unchanged* hardened source.
# An intentional future source upgrade needs a separate review of these pins.
PROBE_SHA256 = "e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0"
HELPER_SHA256 = "d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf"
MAX_SECONDS = 1800
MAX_STDOUT = 8 * 1024 * 1024
MAX_STDERR = 64 * 1024
MAX_PROGRAM_LIST = 4 * 1024 * 1024
MAX_INVENTORY_AUDIT = 2 * 1024 * 1024
# Only short, pinned-bpftool diagnostics retain normalized matcher evidence.
# No raw bpftool row, process comm, kernel symbol, address or pointer escapes.
MAX_PREDICATE_SAMPLES = 20
MAX_PREDICATE_CANDIDATES = 16
MAX_PREDICATE_RECORD = 32768
FIXED_DIAGNOSTIC_BPFT_PATH = Path("/opt/clack/diagnostic-tools/bpftool-678d538")
# The exact executable observed on the dedicated lab, not an arbitrary PATH
# match or bpftrace's self-reported version. This source-reviewed version
# compiles a matched kprobe/kretprobe pair as one KPROBE_SESSION attachment
# when the kernel supports it; the exact owned link is proved below.
PINNED_TRACER_PATH = Path("/usr/bin/bpftrace")
PINNED_TRACER_SHA256 = "a2208280ef0f694e8f4d3f81fe100bc2d3e4668d745a3b8c6510bf0d5f0a240c"
PINNED_TRACER_VERSION = b"bpftrace v0.27.0-872e7a56a\n"
PINNED_LAB_KERNEL = "7.3.1-1-cachyos"
PINNED_TRACER_ENV = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent",
                     "LANG": "C", "LC_ALL": "C"}
FIXED_DIAGNOSTIC_BPFT_PIN = Path("/opt/clack/diagnostic-tools/bpftool-678d538.pin.json")
FIXED_DIAGNOSTIC_BPFT_SHA256 = "0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0"
FIXED_DIAGNOSTIC_BPFT_BUILD_ID = "7f530859f49ede16767f9f4eb8551a6ac85aa25d"
FIXED_DIAGNOSTIC_CRASH_WRAPPER_PATH = Path(
    "/opt/clack/diagnostic-tools/clack-bpftool-abort-capture.py")
FIXED_DIAGNOSTIC_CRASH_WRAPPER_SHA256 = (
    "2eee8f2fff323e9c3c8edb615d7927a8c63222430f9fb964e783f23dacd1ae49")
FIXED_DIAGNOSTIC_SOURCE_COMMIT = "678d538a85e6960f84e443695eebb13f66f89981"
FIXED_DIAGNOSTIC_LIBBPF_COMMIT = "872299d94e27d2fa9f119667c7e52268698dc760"
FIXED_DIAGNOSTIC_LINK_BLOB = "5cffa2d283b47327b8611b4d85b1d70821f40964"
FIXED_DIAGNOSTIC_PATCH_SHA256 = "3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d"
FIXED_DIAGNOSTIC_PATCHED_LINK_BLOB = "4a8747204f8e98e24ca7aa29690582b4f3eece52"
FIXED_DIAGNOSTIC_PATCHED_LINK_SHA256 = "b94fcf719e96993501d9dd1ef4be812ed250b34d92949137139944f6ec64c271"
FIXED_DIAGNOSTIC_SOURCE_ARCHIVE_SHA256 = "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362"
FIXED_DIAGNOSTIC_LIBBPF_ARCHIVE_SHA256 = "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74"
# Only enumerated, static bpftool errors can cross the root audit boundary
# verbatim. A generic "Error: <printable text>" rule can disclose private
# data even after banning paths/keywords (e.g. IPs and decimal pointers).
SAFE_BPFT_DIAGNOSTIC = re.compile(
    r"(?:(?:Error: )?can't get next (?:link|program): "
    r"(?:Invalid argument|No such file or directory|Operation not permitted|"
    r"Operation not supported|Permission denied|Bad file descriptor|"
    r"Cannot allocate memory|Resource temporarily unavailable|"
    r"Interrupted system call)|"
    r"Usage: bpftool (?:link|prog) show|Error: timed out)\Z")
# glibc allocator's short, *static* messages contain no caller-controlled
# paths, pointers, file contents or assertions. Nothing else is copied.
SAFE_LIBC_ABORT_MESSAGES = frozenset((
    "free(): invalid pointer",
    "free(): invalid next size (fast)",
    "free(): invalid next size (normal)",
    "free(): double free detected in tcache 2",
    "malloc(): corrupted top size",
    "malloc(): invalid size (unsorted)",
    "malloc(): unaligned fastbin chunk detected",
    "malloc_consolidate(): invalid chunk size",
    "munmap_chunk(): invalid pointer",
    "double free or corruption (fasttop)",
    "double free or corruption (out)",
    "corrupted size vs. prev_size",
    "*** stack smashing detected ***: terminated",
    "*** buffer overflow detected ***: terminated",
))
# Assertion expressions and source paths are never exported verbatim. We can
# preserve a closed-vocabulary classification only for a bounded bpftool C
# assertion envelope. Unknown error text still gets length+SHA256 only.
SAFE_BPFT_ASSERTION_ENVELOPE = re.compile(
    r"(?:bpftool|/usr/bin/bpftool): "
    r"(?:[A-Za-z0-9_.-]+/){0,5}(?:link|prog|main|common)\.c:"
    r"[1-9][0-9]{0,5}: [A-Za-z_][A-Za-z0-9_]{0,63}: "
    r"Assertion .{1,90} failed\.\Z")
# Linux BPF_OBJ_NAME_LEN=16, including NUL. This is the observed/truncated
# name of bpftrace's single tcp_sendmsg kprobe-session program. Do not use
# a prefix: a similarly named unrelated program is not attachment evidence.
SESSION_PROG_NAME = "kprobe_tcp_send"
SEPARATE_RETURN_PROG_NAME = "kretprobe_tcp_s"
# Diagnostic classification ONLY: pinned bpftool may resolve a 15-byte
# kernel name into the full BTF function name (src/common.c). Never admit it
# without independent proof that this is the actual session representation.
SESSION_PROG_BTF_NAME = "kprobe_tcp_sendmsg"
ATTACH_NOTICE = re.compile(rb"Attached 4 probes(?:\.\.\.)?")
ATTACH_PENDING_NOTICE = re.compile(rb"Attaching 4 probes(?:\.\.\.)?")
LOSS_NOTICE = re.compile(rb"(?:lost\s+\d+\s+events?|\d+\s+events?\s+lost)", re.I)
PREARM_META = re.compile(
    rb"TCPMETA (attempt|send) (\d{1,20}) (\d+) (\d+) (\d+) "
    rb"(\d+) (\d+) (\d+) (-?\d+) ollama"
)
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


def pinned_diagnostic_file(path, digest=None):
    """Require root-owned immutable path components, executable and exact bytes.

    Refuse symlinked parent directories as well as symlinked leaves; the
    existing generic verified_file only refuses a symlink on the leaf.
    No fallback to PATH, the system bpftool, or user-owned build stages.
    """
    path = Path(path)
    for node in (path, *path.parents):
        info = node.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or \
                info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise ValueError("Diagnostic bpftool path is not root-controlled")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Diagnostic bpftool must be a regular file")
    if digest is not None:
        if type(digest) is not str or \
                not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid diagnostic binary pin")
        if info.st_size <= 0 or info.st_size > 32 * 1024 * 1024:
            raise ValueError("Diagnostic bpftool binary size outside bound")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Diagnostic bpftool digest mismatch")
    return path


def qualified_tracer():
    """Fail closed on executable provenance before any kernel attachment."""
    if platform.uname().release != PINNED_LAB_KERNEL:
        raise ValueError("Unreviewed kernel release")
    tracer = pinned_diagnostic_file(PINNED_TRACER_PATH, PINNED_TRACER_SHA256)
    if not (tracer.stat().st_mode & stat.S_IXUSR):
        raise ValueError("Pinned bpftrace is not executable")
    result = subprocess.run(
        [str(tracer), "--version"], stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        timeout=2.0, env=PINNED_TRACER_ENV)
    if result.returncode or result.stdout != PINNED_TRACER_VERSION or result.stderr:
        raise ValueError("Pinned bpftrace version differs")
    # In bpftrace 0.27 a paired kprobe+kretprobe is converted to
    # BPF_TRACE_KPROBE_SESSION *only if* Feature.has_kprobe_session() is true.
    # Ordinary kprobe_multi with retprobe=false does NOT certify this branch.
    # --info queries that same feature detector in the same pinned binary,
    # under the same root privileges, kernel and sanitized environment.
    feature = subprocess.run(
        [str(tracer), "--info"], stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        timeout=5.0, env=PINNED_TRACER_ENV)
    if feature.returncode or feature.stderr or not (0 < len(feature.stdout) <= 16384):
        raise ValueError("Pinned bpftrace feature check unavailable")
    for key in (b"kprobe_multi", b"kprobe_session"):
        states = re.findall(rb"(?<![A-Za-z0-9_])" + key +
                            rb":\s*(yes|no)(?![A-Za-z0-9_])", feature.stdout)
        if states != [b"yes"]:
            raise ValueError("Required kprobe session kernel feature unavailable")
    # A version banner alone is never the identity check.
    return pinned_diagnostic_file(PINNED_TRACER_PATH, PINNED_TRACER_SHA256)


def tracer_process_identity(tracer_pid, tracer_path, probe_path, target_pid,
                            verify_bytes=False):
    """Verify the exact launched executable, argv, root UID and PID start time.

    The /proc/PID/exe inode and *bytes* are independently checked against the
    pinned on-disk binary. Command lines are compared privately, never logged.
    All returned fields are content-free identity tokens for in-memory reuse.
    """
    if type(tracer_pid) is not int or tracer_pid <= 1 or \
            type(target_pid) is not int or target_pid <= 1 or \
            Path(tracer_path) != PINNED_TRACER_PATH:
        raise ValueError("Tracer launch identity invalid")
    proc = Path("/proc") / str(tracer_pid)
    status = (proc / "status").read_text(encoding="ascii")
    uids = re.search(r"^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$",
                     status, re.M)
    if uids is None or any(value != "0" for value in uids.groups()):
        raise ValueError("Tracer must retain root identity")
    stat_line = (proc / "stat").read_text(encoding="ascii")
    tail = stat_line[stat_line.rfind(")") + 2:].split()
    if len(tail) < 20 or not tail[19].isdigit() or int(tail[19]) <= 0:
        raise ValueError("Invalid tracer PID birth identity")
    argv = (proc / "cmdline").read_bytes().split(b"\0")
    expected = [os.fsencode(str(tracer_path)), b"-B", b"line",
                os.fsencode(str(probe_path)), str(target_pid).encode("ascii"),
                b"11434", b""]
    if argv != expected:
        raise ValueError("Tracer command differs from controlled launch")
    on_disk = PINNED_TRACER_PATH.stat()
    exe = proc / "exe"
    if os.readlink(exe) != str(PINNED_TRACER_PATH):
        raise ValueError("Tracer executable path changed")
    executable = exe.stat()
    if (executable.st_dev, executable.st_ino) != (on_disk.st_dev, on_disk.st_ino):
        raise ValueError("Tracer executable inode changed")
    if executable.st_size <= 0 or executable.st_size > 32 * 1024 * 1024 or \
            (verify_bytes and
             hashlib.sha256(exe.read_bytes()).hexdigest() != PINNED_TRACER_SHA256):
        raise ValueError("Tracer executable bytes differ")
    verified_file(probe_path, PROBE_SHA256)
    return (int(tail[19]), executable.st_dev, executable.st_ino)


def owned_bpf_link_fds(tracer_pid, identity, tracer_path, probe_path, target_pid):
    """Read kernel-backed BPF link fdinfo from the *verified* tracer PID.

    Never infer ownership from process names, timing, or optional bpftool
    pids[] rendering. Any malformed/disappearing BPF FD fails closed.
    """
    if identity is None or tracer_process_identity(
            tracer_pid, tracer_path, probe_path, target_pid,
            verify_bytes=True) != identity:
        raise ValueError("Tracer identity changed before FD inspection")
    proc = Path("/proc") / str(tracer_pid)
    links = []
    fds = sorted((proc / "fd").iterdir(), key=lambda f: f.name)
    if len(fds) > 4096:
        raise ValueError("Tracer FD inventory exceeds bound")
    for fd in fds:
        if not fd.name.isascii() or not fd.name.isdecimal():
            raise ValueError("Unexpected tracer FD")
        try:
            target = os.readlink(fd)
        except FileNotFoundError:
            raise ValueError("Tracer FD changed during inspection")
        # Kernel BPF link creation has TWO distinct anon-inode names:
        # bpf_link_prime() uses anon_inode_getfile("bpf_link") while
        # bpf_link_new_fd() uses anon_inode_getfd("bpf-link"). The actual
        # kprobe_multi BPF_LINK_CREATE path uses the former. Missing the
        # underscore spelling silently hid a valid owned link in the first
        # live qualification (fresh program/link present; no owned FD join).
        # Both accepted spellings STILL require exact kernel fdinfo IDs.
        if target not in ("anon_inode:bpf_link", "anon_inode:[bpf_link]",
                          "anon_inode:bpf-link", "anon_inode:[bpf-link]"):
            continue
        body = (proc / "fdinfo" / fd.name).read_bytes()
        if len(body) > 8192:
            raise ValueError("BPF link fdinfo exceeds bound")
        fields = {}
        # Linux's kprobe_multi show_fdinfo appends a non-keyed "cookie func"
        # column header and per-address rows. Those are not stable,
        # trustworthy attachment identity fields and MUST NOT be retained.
        # Parse only exact kernel numeric identity/shape keys, independently
        # of optional human-readable table rows.
        required_keys = {"link_type", "link_id", "prog_id"}
        numeric_shape_keys = {"kprobe_cnt", "missed"}
        for line in body.decode("ascii").splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            if key not in required_keys | numeric_shape_keys:
                continue
            if key in fields:
                raise ValueError("Duplicate BPF link identity or shape key")
            fields[key] = value.strip()
        if not re.fullmatch(r"[1-9][0-9]*", fields.get("link_id", "")) or \
                not re.fullmatch(r"[1-9][0-9]*", fields.get("prog_id", "")) or \
                not re.fullmatch(r"[a-z_]+", fields.get("link_type", "")):
            raise ValueError("Missing BPF link fdinfo kernel identity")
        if fields["link_type"] == "kprobe_multi" and (
                fields.get("kprobe_cnt") != "1" or fields.get("missed") != "0"):
            raise ValueError("Invalid BPF kprobe_multi kernel count or missed events")
        links.append((int(fields["link_id"]), int(fields["prog_id"]),
                      fields["link_type"]))
    if tracer_process_identity(tracer_pid, tracer_path, probe_path, target_pid) != identity:
        raise ValueError("Tracer PID changed during FD inspection")
    if len(links) != len(set(links)):
        raise ValueError("Duplicate tracer BPF link FD")
    return links


def controlled_session_objects(before, live, before_links, live_links,
                               tracer_pid, identity, tracer, probe, target_pid):
    """Exact controlled-launch + kernel FD + fresh object admission proof.

    The sole pinned probe asks for tcp_sendmsg entry+return, and pinned
    bpftrace's supported kprobe_session lowering supplies that *subtype*.
    Session subtype and target are NOT inferred from kprobe_multi/flags/count.
    All kernel properties still come from the actual FD-joined link.
    """
    if identity is None or type(tracer_pid) is not int or tracer_pid <= 1 or \
            type(target_pid) is not int or target_pid <= 1:
        return set(), set()
    fresh_progs = fresh_kprobe_ids(before, live)
    # A separate return probe, another kprobe, or missing program is ambiguous.
    if len(fresh_progs) != 1:
        return set(), set()
    program_id = next(iter(fresh_progs))
    fresh_multi_links = {
        link_id for link_id, row in live_links.items()
        if link_id not in before_links and row.get("type") == "kprobe_multi"}
    if len(fresh_multi_links) != 1:
        return set(), set()
    link_id = next(iter(fresh_multi_links))
    row = live_links[link_id]
    if row.get("prog_id") != program_id or row.get("retprobe") is not False or \
            type(row.get("func_cnt")) is not int or row["func_cnt"] != 1 or \
            type(row.get("missed")) is not int or row["missed"] != 0:
        return set(), set()
    # Explicitly conflicting symbolization is never ignored; empty/missing
    # symbolization is allowed only because exact controlled input proves it.
    funcs = row.get("funcs")
    if funcs is not None and funcs != [] and funcs != [{"func": "tcp_sendmsg"}]:
        return set(), set()
    owners = row.get("pids")
    if owners is not None and (not isinstance(owners, list) or
            (owners and not any(isinstance(owner, dict) and
                                owner.get("pid") == tracer_pid for owner in owners))):
        return set(), set()
    owned = owned_bpf_link_fds(tracer_pid, identity, tracer, probe, target_pid)
    owned_multi = [(lid, prog) for lid, prog, kind in owned
                   if kind == "kprobe_multi"]
    if owned_multi != [(link_id, program_id)]:
        return set(), set()
    return fresh_progs, {link_id}


def qualified_diagnostic_bpftool(pin_path=FIXED_DIAGNOSTIC_BPFT_PIN,
                                binary_path=FIXED_DIAGNOSTIC_BPFT_PATH):
    """Select the one reviewed, locally installed diagnostic binary.

    The SHA-256 is independently pinned in a root-owned manifest installed
    after its build validation, not supplied by a live command argument.
    An unconfigured/incorrect pin is fatal before tracer startup.
    """
    if Path(pin_path) != FIXED_DIAGNOSTIC_BPFT_PIN or \
            Path(binary_path) != FIXED_DIAGNOSTIC_BPFT_PATH or \
            Path(binary_path) == Path("/usr/bin/bpftool"):
        raise ValueError("Only the fixed Clack diagnostic bpftool is supported")
    pin = pinned_diagnostic_file(pin_path)
    raw = pin.read_bytes()
    if not raw or len(raw) > 2048:
        raise ValueError("Diagnostic bpftool manifest invalid")
    config = json.loads(raw)
    expected_keys = {
        "schemaVersion", "binaryPath", "binarySha256", "version",
        "libbpfVersion", "sourceCommit", "libbpfCommit", "linkBlob",
        "sourceArchiveSha256", "libbpfArchiveSha256", "patchSha256",
        "patchedLinkBlob", "patchedLinkSha256", "binaryBuildId",
    }
    if not isinstance(config, dict) or set(config) != expected_keys or \
            type(config["schemaVersion"]) is not int or \
            config["schemaVersion"] != 2 or \
            config["binaryPath"] != str(binary_path) or \
            config["sourceCommit"] != FIXED_DIAGNOSTIC_SOURCE_COMMIT or \
            config["libbpfCommit"] != FIXED_DIAGNOSTIC_LIBBPF_COMMIT or \
            config["linkBlob"] != FIXED_DIAGNOSTIC_LINK_BLOB or \
            config["patchSha256"] != FIXED_DIAGNOSTIC_PATCH_SHA256 or \
            config["patchedLinkBlob"] != FIXED_DIAGNOSTIC_PATCHED_LINK_BLOB or \
            config["patchedLinkSha256"] != FIXED_DIAGNOSTIC_PATCHED_LINK_SHA256 or \
            config["binaryBuildId"] != FIXED_DIAGNOSTIC_BPFT_BUILD_ID or \
            config["sourceArchiveSha256"] != FIXED_DIAGNOSTIC_SOURCE_ARCHIVE_SHA256 or \
            config["libbpfArchiveSha256"] != FIXED_DIAGNOSTIC_LIBBPF_ARCHIVE_SHA256 or \
            config["binarySha256"] != FIXED_DIAGNOSTIC_BPFT_SHA256 or \
            config["version"] != "7.8.1" or \
            config["libbpfVersion"] != "1.9":
        raise ValueError("Diagnostic source/version provenance mismatch")
    bpftool = pinned_diagnostic_file(binary_path, config["binarySha256"])
    if not bpftool.stat().st_mode & stat.S_IXUSR:
        raise ValueError("Diagnostic bpftool is not executable")
    process = subprocess.run(
        [str(bpftool), "-j", "version"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False, timeout=2.0)
    if process.returncode != 0 or process.stderr or \
            not 0 < len(process.stdout) <= 2048:
        raise ValueError("Diagnostic bpftool version command failed")
    details = json.loads(process.stdout)
    if not isinstance(details, dict) or \
            details.get("version") != config["version"] or \
            details.get("libbpf_version") != config["libbpfVersion"] or \
            not isinstance(details.get("features"), dict) or \
            details["features"].get("skeletons") is not True:
        raise ValueError("Diagnostic bpftool binary version/provenance mismatch")
    # Check again after executing, never trust version text as a binary pin.
    pinned_diagnostic_file(binary_path, config["binarySha256"])
    return bpftool, {
        "binaryPath": str(bpftool),
        "binarySha256": config["binarySha256"],
        "binaryVersion": config["version"],
        "libbpfVersion": config["libbpfVersion"],
        "sourceCommit": config["sourceCommit"],
        "linkBlob": config["linkBlob"],
        "patchSha256": config["patchSha256"],
        "patchedLinkBlob": config["patchedLinkBlob"],
    }


def qualified_diagnostic_crash_wrapper():
    """Additional optional pre-attachment pin, never a bpftool fallback."""
    path = pinned_diagnostic_file(
        FIXED_DIAGNOSTIC_CRASH_WRAPPER_PATH,
        FIXED_DIAGNOSTIC_CRASH_WRAPPER_SHA256)
    if not (path.stat().st_mode & stat.S_IRUSR):
        raise ValueError("Root diagnostic capture wrapper cannot be read")
    return path


def load_hardened_support(folder):
    source = verified_file(folder / "local-muse-tcp-session.py", HELPER_SHA256)
    spec = importlib.util.spec_from_file_location("local_muse_pinned_supervisor", source)
    if spec is None or spec.loader is None:
        raise ValueError("Pinned supervisor loader unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_bpft_diagnostic(raw):
    """Return static tool errors or redacted crash CATEGORY, never raw asserts."""
    if not isinstance(raw, bytes) or len(raw) > 180:
        return None
    if b"\r" in raw or b"\x00" in raw or b"\t" in raw:
        return None
    if raw == b"":
        return ""
    if raw.endswith(b"\n"):
        raw = raw[:-1]
    if b"\n" in raw or not raw:
        return None
    try:
        value = raw.decode("ascii")
    except UnicodeDecodeError:
        return None
    if SAFE_BPFT_DIAGNOSTIC.fullmatch(value):
        return value
    if value in SAFE_LIBC_ABORT_MESSAGES:
        return value
    if SAFE_BPFT_ASSERTION_ENVELOPE.fullmatch(value):
        return "bpftool: C assertion failure (details redacted)"
    return None


class InventoryAudit:
    """Bounded root-owned JSONL of invocations and sanitized matcher samples."""

    def __init__(self, fd, binary_identity=None):
        self.fd = fd
        self.bytes_written = 0
        self.invocations = 0
        self.matcher_samples = 0
        self.binary_identity = binary_identity or {}

    def record(self, row, inventory=True):
        if inventory:
            self.invocations += 1
        row = {"schemaVersion": 1, "invocation": self.invocations,
               **self.binary_identity, **row}
        payload = (json.dumps(row, sort_keys=True, separators=(",", ":")) +
                   "\n").encode("ascii")
        if not inventory and len(payload) > MAX_PREDICATE_RECORD:
            raise ValueError("Normalized matcher record exceeds bound")
        if self.bytes_written + len(payload) > MAX_INVENTORY_AUDIT:
            raise ValueError("Bounded inventory audit capacity exceeded")
        while payload:
            count = os.write(self.fd, payload)
            if count <= 0:
                raise OSError("Inventory audit output unavailable")
            self.bytes_written += count
            payload = payload[count:]

    def record_matcher(self, row):
        """Append at most 20 post-inventory normalized reports, not tool calls."""
        if self.matcher_samples >= MAX_PREDICATE_SAMPLES:
            return
        self.matcher_samples += 1
        self.record({"phase": "live", "kind": "matcher", "result": "normalized",
                     "sample": self.matcher_samples, **row}, inventory=False)


def bounded_crash_capture_record(value):
    """Revalidate even root-owned observer output before exporting a row."""
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or \
            value["schemaVersion"] != 1 or \
            value.get("commandClass") != "private_fixed_link_show" or \
            value.get("capture") not in ("PASS", "FAIL", "TIMEOUT"):
        return {"capture": "FAIL", "failureClass": "observer_schema_invalid"}
    record = {"capture": value["capture"]}
    for key, matcher in (
            ("executableSha256", r"[a-f0-9]{64}"),
            ("buildId", r"[a-f0-9]{40}"),
            ("debuggerVersion", r"GNU gdb \(GDB\) 18\.1")):
        field = value.get(key)
        if type(field) is str and re.fullmatch(matcher, field):
            record[key] = field
    if "executableSha256" in record and \
            record["executableSha256"] != FIXED_DIAGNOSTIC_BPFT_SHA256:
        return {"capture": "FAIL", "failureClass": "observer_binary_mismatch"}
    if record["capture"] == "PASS" and (
            record.get("executableSha256") != FIXED_DIAGNOSTIC_BPFT_SHA256 or
            record.get("buildId") !=
            FIXED_DIAGNOSTIC_BPFT_BUILD_ID or
            record.get("debuggerVersion") != "GNU gdb (GDB) 18.1"):
        return {"capture": "FAIL", "failureClass": "observer_provenance_invalid"}
    for key in ("inferiorExitCode", "inferiorSignal", "debuggerExitCode",
                "inferiorOutputBytes", "debuggerOutputBytes"):
        item = value.get(key)
        if type(item) is int and -255 <= item <= 65536:
            record[key] = item
    for key in ("inferiorOutputSha256", "debuggerOutputSha256"):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r"[a-f0-9]{64}", item):
            record[key] = item
    if value.get("observedSignal") == "SIGABRT":
        record["observedSignal"] = "SIGABRT"
    if value.get("signalEvidence") == "gdb_sigabrt_forwarded_inferior_exited" and \
            value.get("inferiorSignal") == 6 and \
            value.get("inferiorExited") is True:
        record["signalEvidence"] = "gdb_sigabrt_forwarded_inferior_exited"
    if value.get("inferiorExited") is True:
        record["inferiorExited"] = True
    if value.get("timedOut") is True:
        record["timedOut"] = True
    if value.get("cleanup") == "PASS":
        record["cleanup"] = "PASS"
    if record.get("cleanup") != "PASS":
        record["capture"] = "FAIL"
    assertion = value.get("assertionClass")
    if isinstance(assertion, str) and (
            assertion in SAFE_LIBC_ABORT_MESSAGES or
            assertion == "bpftool: C assertion failure (details redacted)"):
        record["assertionClass"] = assertion
    location = value.get("assertionLocation")
    if record.get("assertionClass") == "bpftool: C assertion failure (details redacted)" and \
            isinstance(location, dict) and set(location) == {
                "module", "sourceFile", "sourceLine", "function"} and \
            location.get("module") == "bpftool-678d538" and \
            type(location.get("sourceFile")) is str and \
            re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.+-]{0,87}\.[ch]",
                         location["sourceFile"]) and \
            type(location.get("sourceLine")) is int and \
            1 <= location["sourceLine"] <= 1_000_000 and \
            type(location.get("function")) is str and \
            re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}",
                         location["function"]):
        record["assertionLocation"] = location
    site = value.get("assertionSite")
    if isinstance(site, dict) and site.get("module") == "bpftool-678d538" and \
            site.get("moduleBuildId") == FIXED_DIAGNOSTIC_BPFT_BUILD_ID and \
            set(site).issubset({"module", "moduleBuildId", "moduleOffset",
                                "symbol", "functionOffset", "sourceFile",
                                "sourceLine", "inlineChain"}) and \
            type(site.get("symbol")) is str and \
            re.fullmatch(r"[A-Za-z_~][A-Za-z0-9_~.$:+<>-]{0,95}",
                         site["symbol"]) and \
            type(site.get("inlineChain")) is list and \
            len(site["inlineChain"]) <= 4:
        acceptable = True
        for key in ("moduleOffset", "functionOffset"):
            n = site.get(key)
            if n is not None and (type(n) is not int or not 0 <= n < 33554432):
                acceptable = False
        if ("sourceFile" in site or "sourceLine" in site) and not (
                type(site.get("sourceFile")) is str and
                re.fullmatch(r"[A-Za-z0-9_.+-]{1,88}", site["sourceFile"]) and
                type(site.get("sourceLine")) is int and
                1 <= site["sourceLine"] <= 1_000_000):
            acceptable = False
        for inline in site["inlineChain"]:
            if not isinstance(inline, dict) or \
                    not set(inline).issubset({"function", "sourceFile", "sourceLine"}) or \
                    type(inline.get("function")) is not str or \
                    not re.fullmatch(r"[A-Za-z_~][A-Za-z0-9_~.$:+<>-]{0,95}",
                                     inline["function"]):
                acceptable = False
                break
            if ("sourceFile" in inline or "sourceLine" in inline) and not (
                    type(inline.get("sourceFile")) is str and
                    re.fullmatch(r"[A-Za-z0-9_.+-]{1,88}", inline["sourceFile"]) and
                    type(inline.get("sourceLine")) is int and
                    1 <= inline["sourceLine"] <= 1_000_000):
                acceptable = False
                break
        if acceptable:
            record["assertionSite"] = site
    frames = value.get("frames")
    if isinstance(frames, list) and len(frames) <= 12:
        safe_frames = []
        for frame in frames:
            if not isinstance(frame, dict):
                break
            fun = frame.get("function")
            module = frame.get("module")
            if not isinstance(fun, str) or not re.fullmatch(
                    r"[A-Za-z_~][A-Za-z0-9_~.$:+<>-]{0,95}", fun):
                break
            if not isinstance(module, str) or not re.fullmatch(
                    r"[A-Za-z0-9_.+-]{1,88}", module):
                break
            clean = {"index": len(safe_frames), "function": fun, "module": module}
            for key, pattern in (
                    ("moduleBuildId", r"[a-f0-9]{16,64}"),
                    ("sourceFile", r"[A-Za-z0-9_.+-]{1,88}")):
                field = frame.get(key)
                if isinstance(field, str) and re.fullmatch(pattern, field):
                    clean[key] = field
            number = frame.get("sourceLine")
            if "sourceFile" in clean and type(number) is int and 1 <= number <= 1_000_000:
                clean["sourceLine"] = number
            safe_frames.append(clean)
        record["frames"] = safe_frames
    else:
        record["frames"] = []
    if record["capture"] == "PASS":
        normal = (record.get("observedSignal") is None and
                  record.get("inferiorExited") is True and
                  type(record.get("inferiorExitCode")) is int)
        aborted = (record.get("observedSignal") == "SIGABRT" and
                   record.get("inferiorSignal") == 6 and
                   record.get("signalEvidence") ==
                   "gdb_sigabrt_forwarded_inferior_exited" and
                   record.get("inferiorExited") is True and
                   record.get("inferiorExitCode") is None and
                   bool(record["frames"]))
        if record.get("debuggerExitCode") != 0 or not (normal or aborted):
            return {"capture": "FAIL",
                    "failureClass": "observer_child_state_invalid"}
    return record


def diagnostic_live_link_capture(bpftool, crash_wrapper, audit, tracer_state,
                                 watchdog_seconds=8.0):
    """Non-authoritative observer replaces only ONE *live* link inspection.

    GDB exits and native child status are distinct. This always raises
    ValueError, even after a PASS capture: never interpret GDB output
    as JSON link metadata or arm the readiness FIFO from it.
    """
    before = tracer_state()
    start_ns = time.monotonic_ns()
    output = b""
    diagnostic = {"capture": "FAIL", "failureClass": "observer_unavailable"}
    observer_exit = None
    try:
        result = subprocess.run(
            [sys.executable, "-B", str(crash_wrapper)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False, timeout=watchdog_seconds)
        observer_exit = result.returncode
        output = result.stdout or b""
        if not result.stderr and 0 < len(output) <= 6144:
            try:
                diagnostic = bounded_crash_capture_record(json.loads(output))
            except (ValueError, UnicodeError):
                diagnostic = {"capture": "FAIL",
                              "failureClass": "observer_schema_invalid"}
        if observer_exit != {
                "PASS": 0, "FAIL": 2, "TIMEOUT": 124}.get(
                    diagnostic["capture"]):
            diagnostic = {"capture": "FAIL",
                          "failureClass": "observer_exit_mismatch"}
    except subprocess.TimeoutExpired:
        diagnostic = {"capture": "TIMEOUT", "failureClass": "observer_watchdog"}
    except (OSError, subprocess.SubprocessError):
        diagnostic = {"capture": "FAIL", "failureClass": "observer_spawn_failure"}
    finally:
        if audit is not None:
            audit.record({
                "phase": "live", "kind": "link",
                "argv": [str(bpftool), "-j", "link", "show"],
                "captureWrapperSha256": FIXED_DIAGNOSTIC_CRASH_WRAPPER_SHA256,
                "monotonicStartNs": start_ns,
                "monotonicEndNs": time.monotonic_ns(),
                "exitCode": None, "timedOut": diagnostic["capture"] == "TIMEOUT",
                "result": "diagnostic_only_unverified",
                "failureClass": "CrashCaptureNeverQualifiesLinks",
                "stdoutBytes": 0, "stdoutSha256": hashlib.sha256(b"").hexdigest(),
                "stderrBytes": 0, "stderrSha256": hashlib.sha256(b"").hexdigest(),
                "stderrText": None, "stderrTextStatus": "not_exported",
                "stdoutToolError": None,
                "jsonAttempted": False, "jsonResult": "not_attempted",
                "tracerStateAtStart": before, "tracerStateAtEnd": tracer_state(),
                "crashCapture": diagnostic,
                "observerExitCode": observer_exit,
                "nativeExitStatus": "not_directly_observed",
            })
        print("KERNEL_AUDIT_CRASH_CAPTURE=" + diagnostic["capture"],
              file=sys.stderr, flush=True)
    raise ValueError("Diagnostic-only GDB capture cannot qualify a session link")


def inventory_snapshot(bpftool, kind, timeout, parse_rows, phase="baseline",
                       audit=None, tracer_state="not_started"):
    """Run exactly the reviewed argv, preserving closed-vocabulary failures.

    JSON error output on a nonzero bpftool exit is still *examined* for a
    strictly allowlisted diagnostic, but never accepted as inventory. A
    root-owned per-invocation record holds timestamps, exact argv, raw
    stream lengths/digests and only safe tool diagnostic text.
    """
    if kind not in ("prog", "link") or phase not in ("baseline", "live", "terminal"):
        raise ValueError("Unknown inventory command or phase")
    args = [str(bpftool), "-j", kind, "show"]
    state = tracer_state if callable(tracer_state) else lambda: tracer_state
    started_state = state()
    if started_state not in ("not_started", "running", "exited"):
        raise ValueError("Unknown tracer inventory state")
    start_ns = time.monotonic_ns()
    stdout, stderr = b"", b""
    exit_code = None
    json_attempted = False
    json_result = "not_attempted"
    result = "spawn_error"
    failure_class = "none"
    stdout_diagnostic = None
    parsed_rows = None
    try:
        try:
            process = subprocess.run(
                args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, check=False,
                timeout=max(0.1, min(2.0, timeout)))
            exit_code = getattr(process, "returncode", 0)
            stdout = process.stdout or b""
            stderr = getattr(process, "stderr", b"") or b""
        except subprocess.TimeoutExpired as error:
            stdout = error.stdout or b""
            stderr = error.stderr or b""
            result = "timeout"
            failure_class = "TimeoutExpired"
            raise
        if len(stdout) > MAX_PROGRAM_LIST or len(stderr) > MAX_STDERR:
            result = "output_overflow"
            failure_class = "ValueError"
            raise ValueError("Bounded bpftool inventory output exceeded")
        json_attempted = bool(stdout)
        if json_attempted:
            try:
                parsed_rows = json.loads(stdout)
                json_result = "parsed"
            except (ValueError, UnicodeDecodeError):
                json_result = "decode_error"
        if isinstance(parsed_rows, list) and len(parsed_rows) == 1 and \
                isinstance(parsed_rows[0], dict) and \
                type(parsed_rows[0].get("error")) is str:
            stdout_diagnostic = safe_bpft_diagnostic(
                parsed_rows[0]["error"].encode("utf-8"))
        if exit_code != 0:
            result = "exit_nonzero"
            failure_class = "CalledProcessError"
            raise subprocess.CalledProcessError(exit_code, args)
        if json_result != "parsed":
            result = "json_failure"
            failure_class = "JSONDecodeError"
            raise ValueError("No valid bpftool JSON inventory")
        try:
            inventory = parse_rows(parsed_rows)
        except (ValueError, TypeError, KeyError):
            result = "schema_failure"
            failure_class = "ValueError"
            json_result = "schema_failure"
            raise
        result = "pass"
        return inventory
    except OSError as error:
        if result == "spawn_error":
            failure_class = type(error).__name__
        raise
    finally:
        end_ns = time.monotonic_ns()
        completed_state = state()
        if completed_state not in ("not_started", "running", "exited"):
            completed_state = "unknown"
        stderr_text = safe_bpft_diagnostic(stderr)
        if audit is not None:
            audit.record({
                "phase": phase, "kind": kind, "argv": args,
                "monotonicStartNs": start_ns, "monotonicEndNs": end_ns,
                "exitCode": exit_code,
                "timedOut": result == "timeout", "result": result,
                "failureClass": failure_class,
                "stdoutBytes": len(stdout),
                "stdoutSha256": hashlib.sha256(stdout).hexdigest(),
                "stderrBytes": len(stderr),
                "stderrSha256": hashlib.sha256(stderr).hexdigest(),
                "stderrText": stderr_text,
                "stderrTextStatus": (
                    "allowlisted" if stderr_text else
                    "empty" if not stderr else "redacted"),
                "stdoutToolError": stdout_diagnostic,
                "jsonAttempted": json_attempted,
                "jsonResult": json_result,
                "tracerStateAtStart": started_state,
                "tracerStateAtEnd": completed_state,
            })


def parse_program_inventory(entries):
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


def program_inventory(bpftool, timeout, phase="baseline", audit=None,
                      tracer_state="not_started"):
    """Read-only program registry with one auditable invocation."""
    return inventory_snapshot(bpftool, "prog", timeout,
                              parse_program_inventory, phase, audit, tracer_state)


def new_kprobes(before, after):
    """A bpftrace kprobe session has one entry-named program for both hooks."""
    return {number for number, (kind, name) in after.items()
            if number not in before and kind == "kprobe" and
            name == SESSION_PROG_NAME}


def fresh_kprobe_ids(before, after):
    """All fresh kprobe programs; labels are not authoritative identifiers."""
    return {number for number, (kind, _) in after.items()
            if number not in before and kind == "kprobe"}


def new_separate_return_programs(before, after):
    """A separate return program is NOT evidence for a collapsed session."""
    return {number for number, (kind, name) in after.items()
            if number not in before and kind == "kprobe" and
            name == SEPARATE_RETURN_PROG_NAME}


def parse_link_inventory(rows):
    if not isinstance(rows, list):
        raise ValueError("Invalid kernel link inventory")
    links = {}
    for row in rows:
        if not isinstance(row, dict) or type(row.get("id")) is not int or \
                row["id"] < 1 or row["id"] in links or \
                not isinstance(row.get("type"), str) or \
                (row["type"] == "kprobe_multi" and
                 (type(row.get("prog_id")) is not int or row["prog_id"] < 1)) or \
                (row.get("prog_id") is not None and
                 (type(row["prog_id"]) is not int or row["prog_id"] < 1)):
            raise ValueError("Malformed kernel link inventory entry")
        links[row["id"]] = row
    return links


def link_inventory(bpftool, timeout, phase="baseline", audit=None,
                   tracer_state="not_started"):
    """Read-only link registry, not optional when proving session readiness."""
    return inventory_snapshot(bpftool, "link", timeout,
                              parse_link_inventory, phase, audit, tracer_state)


def inspected_link_inventory(bpftool, timeout, phase, audit, tracer_state,
                             crash_wrapper, preempt_crash_capture, fallback):
    """Ordinary JSON inspection first; observe only a proven live SIGABRT once.

    A GDB observation is NEVER a substitute for valid JSON link inventory.
    The preemptive investigative mode remains separately fail-closed. Normal
    kernel-only mode enters the observer only after an actual native -SIGABRT
    from the *live* private bpftool, while its tracer is still running.
    """
    if phase == "live" and preempt_crash_capture:
        if crash_wrapper is None:
            raise ValueError("Diagnostic crash observer is not qualified")
        diagnostic_live_link_capture(bpftool, crash_wrapper, audit, tracer_state)
    started = time.monotonic()
    try:
        return link_inventory(bpftool, timeout, phase, audit, tracer_state)
    except subprocess.CalledProcessError as error:
        if (phase == "live" and not preempt_crash_capture and
                error.returncode == -signal.SIGABRT and
                crash_wrapper is not None and
                isinstance(fallback, dict) and
                fallback.get("used") is False and
                tracer_state() == "running"):
            fallback["used"] = True  # Consumed BEFORE starting GDB; no retry.
            # The original timeout is the remaining kernel capture budget
            # at inspection start. Never grant the GDB fallback a fresh
            # eight seconds after consuming the existing budget.
            remaining = timeout - (time.monotonic() - started)
            if remaining >= 0.5:
                diagnostic_live_link_capture(
                    bpftool, crash_wrapper, audit, tracer_state,
                    watchdog_seconds=min(8.0, remaining))
        raise


def session_link_ids(before_links, live_links, new_programs, tracer_pid):
    """Prove a NEW tcp_sendmsg session link owned by this tracer.

    bpftrace 0.27 combines the pinned entry and return clauses into a single
    BPF_TRACE_KPROBE_SESSION program/link on supported kernels. Its link is
    represented in bpftool as kprobe_multi; a plain kprobe program name alone
    cannot prove the target hook or attachment. Require an exact new program
    ID -> new link ID -> tcp_sendmsg function -> live bpftrace PID join.
    Absence of that metadata is UNVERIFIED, never a reason to arm anyway.
    """
    if type(tracer_pid) is not int or tracer_pid <= 1 or len(new_programs) != 1:
        return set()
    program_id = next(iter(new_programs))
    links = set()
    for number, row in live_links.items():
        if number in before_links or row.get("prog_id") != program_id or \
                row.get("type") != "kprobe_multi" or \
                row.get("retprobe") is not False or \
                type(row.get("func_cnt")) is not int or row["func_cnt"] != 1 or \
                type(row.get("missed")) is not int or row["missed"] != 0:
            continue
        funcs = row.get("funcs")
        owners = row.get("pids")
        if not isinstance(funcs, list) or len(funcs) != 1 or \
                not isinstance(funcs[0], dict) or \
                funcs[0].get("func") != "tcp_sendmsg" or \
                not isinstance(owners, list) or not owners or \
                not any(isinstance(owner, dict) and
                        owner.get("pid") == tracer_pid and
                        owner.get("comm") == "bpftrace" for owner in owners):
            continue
        links.add(number)
    # One session link for this one tcp_sendmsg program. Duplicates or
    # ambiguous links cannot be used to claim positive readiness.
    return links if len(links) == 1 else set()


def matcher_inventory_diagnostic(before, live, before_links, live_links, tracer_pid):
    """Explain strict predicates using ONLY bounded, content-free metadata.

    This is observational: the admission matcher above stays authoritative.
    Program names, kernel symbols, owner comms and unknown JSON fields are
    compared in memory, then reduced to fixed categories before persistence.
    """
    def verdict(test):
        return "PASS" if test else "FAIL"

    def safe_id(value):
        return value if type(value) is int and 1 <= value <= 0xffffffff else None

    def category(value, names):
        return value if type(value) is str and value in names else (
            "MISSING" if value is None else "OTHER")

    new_program_ids = set(live).difference(before)
    new_link_ids = set(live_links).difference(before_links)
    target_ids = new_kprobes(before, live)
    separate_ids = new_separate_return_programs(before, live)
    tracer_ok = type(tracer_pid) is int and tracer_pid > 1
    target_id = next(iter(target_ids)) if len(target_ids) == 1 else None
    qualifying_links = session_link_ids(
        before_links, live_links, target_ids, tracer_pid)

    # Prefer candidates near the required session shape, but preserve counts
    # and truncation flags for all new objects, even unrelated ones.
    program_candidates = [
        number for number, (kind, name) in live.items()
        if number in new_program_ids or
        (kind == "kprobe" and name in
         (SESSION_PROG_NAME, SESSION_PROG_BTF_NAME,
          SEPARATE_RETURN_PROG_NAME))
    ]
    program_candidates.sort(key=lambda n: (
        live[n][1] not in (SESSION_PROG_NAME, SESSION_PROG_BTF_NAME),
        live[n][0] != "kprobe",
        n not in new_program_ids, n))
    program_rows = []
    for number in program_candidates[:MAX_PREDICATE_CANDIDATES]:
        kind, name = live[number]
        checks = {
            "id_valid": verdict(type(number) is int and number >= 1),
            "fresh": verdict(number not in before),
            "type_kprobe": verdict(kind == "kprobe"),
            "name_exact": verdict(name == SESSION_PROG_NAME),
        }
        program_rows.append({
            "id": safe_id(number),
            "typeClass": category(kind, (
                "kprobe", "tracepoint", "tracing", "raw_tracepoint",
                "perf_event", "xdp", "socket_filter")),
            "nameClass": (
                "SESSION" if name == SESSION_PROG_NAME else
                "SESSION_FULL_BTF" if name == SESSION_PROG_BTF_NAME else
                "SEPARATE_RETURN" if name == SEPARATE_RETURN_PROG_NAME else
                "MISSING" if not name else "OTHER"),
            "predicates": checks,
        })

    session_shaped_program_ids = {
        number for number, (kind, name) in live.items()
        if kind == "kprobe" and name == SESSION_PROG_NAME}
    link_candidates = [
        number for number, row in live_links.items()
        if number in new_link_ids or (
            row.get("type") == "kprobe_multi" and
            row.get("prog_id") in session_shaped_program_ids)
    ]
    link_candidates.sort(key=lambda n: (
        live_links[n].get("prog_id") not in target_ids,
        live_links[n].get("type") != "kprobe_multi",
        n not in new_link_ids, n))

    # Independently count links satisfying all candidate predicates before
    # enforcing uniqueness. The strict matcher still determines readiness.
    complete_candidates = 0
    link_rows = []
    for number in link_candidates:
        row = live_links[number]
        funcs = row.get("funcs")
        owners = row.get("pids")
        owners_list = isinstance(owners, list)
        owner_pid = owners_list and any(
            isinstance(owner, dict) and owner.get("pid") == tracer_pid
            for owner in owners)
        owner_join = owners_list and any(
            isinstance(owner, dict) and owner.get("pid") == tracer_pid
            and owner.get("comm") == "bpftrace" for owner in owners)
        checks = {
            "tracer_pid_valid": verdict(tracer_ok),
            "one_target_program": verdict(len(target_ids) == 1),
            "id_valid": verdict(type(number) is int and number >= 1),
            "fresh": verdict(number not in before_links),
            "linked_program_id_valid": verdict(
                type(row.get("prog_id")) is int and row["prog_id"] > 0),
            "linked_program_matches": verdict(
                target_id is not None and row.get("prog_id") == target_id),
            "type_kprobe_multi": verdict(row.get("type") == "kprobe_multi"),
            "retprobe_false": verdict(row.get("retprobe") is False),
            "func_cnt_one": verdict(
                type(row.get("func_cnt")) is int and row["func_cnt"] == 1),
            "missed_zero": verdict(
                type(row.get("missed")) is int and row["missed"] == 0),
            "funcs_list": verdict(isinstance(funcs, list)),
            "funcs_one": verdict(isinstance(funcs, list) and len(funcs) == 1),
            "func_entry_object": verdict(
                isinstance(funcs, list) and len(funcs) == 1 and
                isinstance(funcs[0], dict)),
            "target_tcp_sendmsg": verdict(
                isinstance(funcs, list) and len(funcs) == 1 and
                isinstance(funcs[0], dict) and
                funcs[0].get("func") == "tcp_sendmsg"),
            "pids_list": verdict(owners_list),
            "pids_nonempty": verdict(owners_list and bool(owners)),
            "owner_pid_present": verdict(owner_pid),
            "owner_pid_and_comm": verdict(owner_join),
        }
        if all(value == "PASS" for value in checks.values()):
            complete_candidates += 1
        if len(link_rows) >= MAX_PREDICATE_CANDIDATES:
            continue
        target = (funcs[0].get("func") if isinstance(funcs, list) and
                  len(funcs) == 1 and isinstance(funcs[0], dict) else None)
        link_rows.append({
            "id": safe_id(number),
            "linkedProgramId": safe_id(row.get("prog_id")),
            "typeClass": category(row.get("type"), (
                "kprobe_multi", "perf_event", "tracing", "tracing_multi",
                "raw_tracepoint", "uprobe_multi", "cgroup", "xdp")),
            "targetClass": ("TCP_SENDMSG" if target == "tcp_sendmsg" else
                            "MISSING" if target is None else "OTHER"),
            "funcsShape": ("LIST" if isinstance(funcs, list) else
                           "MISSING" if funcs is None else "OTHER"),
            "ownersShape": ("LIST" if owners_list else
                            "MISSING" if owners is None else "OTHER"),
            "predicates": checks,
        })
    return {
        "tracerPid": safe_id(tracer_pid),
        "baselineProgramCount": len(before),
        "liveProgramCount": len(live),
        "freshProgramCount": len(new_program_ids),
        "baselineLinkCount": len(before_links),
        "liveLinkCount": len(live_links),
        "freshLinkCount": len(new_link_ids),
        "targetProgramMatchCount": len(target_ids),
        "separateReturnMatchCount": len(separate_ids),
        "completeLinkCandidateCount": complete_candidates,
        "validSessionLinkMatchCount": len(qualifying_links),
        "uniqueTargetProgram": verdict(len(target_ids) == 1),
        "uniqueSessionLink": verdict(complete_candidates == 1),
        "programCandidatesTruncated": len(program_candidates) > len(program_rows),
        "linkCandidatesTruncated": len(link_candidates) > len(link_rows),
        "programCandidates": program_rows,
        "linkCandidates": link_rows,
    }


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


def completed_live_rows(raw):
    """Classify only terminated pipe rows, without trusting an unfinished tail.

    A complete END warning needs the adjacent helper-info row to be benign;
    defer that warning while its next line might still be in flight. Final
    validation always uses the *entire* captured bytes, never this live view.
    """
    end = raw.rfind(b"\n")
    if end < 0:
        return b"", bool(raw)
    complete = raw[:end + 1]
    pending = end + 1 != len(raw)
    final_row = complete[:-1].rsplit(b"\n", 1)[-1].rstrip(b"\r")
    if SAFE_END_WARNING.fullmatch(final_row):
        complete = complete[:complete.rfind(b"\n", 0, len(complete) - 1) + 1]
        pending = True
    return complete, pending


def classify_live_output(raw_stdout, raw_stderr):
    """Never condemn a fragmented warning or arm on unexamined partial data."""
    stdout, stdout_pending = completed_live_rows(raw_stdout)
    stderr, stderr_pending = completed_live_rows(raw_stderr)
    cleaned, strict, notices = classify_source_output(stdout, stderr)
    return cleaned, strict, notices, stdout_pending or stderr_pending


def valid_prearm_meta(row, pid, port):
    """A pre-arm event cannot bypass the pinned terminal parser's row rules."""
    match = PREARM_META.fullmatch(row)
    if not match:
        return False
    op, *numbers = match.groups()
    ns, event_pid, tid, socket, local, remote, requested, result = map(int, numbers)
    return ns > 0 and event_pid == pid and tid > 0 and socket > 0 and \
        local == port and 0 < remote <= 65535 and requested >= 0 and \
        result <= requested and (op != b"attempt" or result == 0)


def source_arm_evidence(stdout_bytes, stderr_bytes, pid, port, before, after,
                        before_links, after_links, tracer_pid,
                        controlled_objects=None):
    """Positive pre-inference evidence: native notice + BEGIN + session link."""
    source_stdout, rest_stderr, notices, pending = classify_live_output(
        stdout_bytes, stderr_bytes)
    expected_ready = f"TCPREADY {pid} {port}".encode("ascii")
    rows = source_stdout.splitlines()
    has_ready = bool(rows) and rows[0] == expected_ready and \
        all(valid_prearm_meta(row, pid, port) for row in rows[1:])
    if controlled_objects is None:
        # Historical strict matcher, retained only for legacy offline fixtures
        # and normalized diagnostic comparison. Production always supplies a
        # fresh, verified controlled-launch/FD-joined proof.
        new_ids = new_kprobes(before, after)
        session_links = session_link_ids(before_links, after_links, new_ids, tracer_pid)
    else:
        new_ids, session_links = controlled_objects
    return (has_ready and not pending and not rest_stderr.strip() and
            notices == 1 and not new_separate_return_programs(before, after) and
            len(new_ids) == 1 and len(session_links) == 1), len(new_ids)


def numeric_arm_line(pid, port, programs, observed_loss=0):
    fields = [pid, port, 4, programs, observed_loss]
    if any(type(value) is not int or value < 0 for value in fields) or \
            pid <= 1 or port != 11434 or programs != 1 or observed_loss != 0:
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


def emit_content_free_audit(stdout, stderr, pid, programs_before, programs_after,
                            child_status, armed, arm_attempted, fifo_write_error,
                            identity_ok, stop_complete, invalid_source, forced,
                            inventory_error, session_link_count=0,
                            link_inventory_error="none", inventory_records=0):
    """Exact byte fingerprints and closed-vocabulary reasons, never TCP pointers.

    The operator's stderr is separate from the private numeric importer/FIFO
    channels. Raw bpftrace stdout can contain a kernel socket pointer, so only
    its size/hash and safe parsed counters may leave this root process.
    """
    clean, strict_stderr, notices = classify_source_output(stdout, stderr)
    lines = clean.splitlines()
    expected_ready = f"TCPREADY {pid} 11434".encode("ascii")
    ready_count = sum(row == expected_ready for row in lines)
    other_ready = sum(row.startswith(b"TCPREADY ") and row != expected_ready for row in lines)
    summary_count = sum(row.startswith(b"TCPSUMMARY ") for row in lines)
    other_stdout = sum(not row.startswith((b"TCPREADY ", b"TCPMETA ",
                                            b"TCPSUMMARY ")) for row in lines)
    entries = {
        "BPF_STDOUT_BYTES": len(stdout),
        "BPF_STDOUT_SHA256": hashlib.sha256(stdout).hexdigest(),
        "BPF_STDERR_BYTES": len(stderr),
        "BPF_STDERR_SHA256": hashlib.sha256(stderr).hexdigest(),
        "BPF_UNRECOGNIZED_STDERR_BYTES": len(strict_stderr),
        "NATIVE_ATTACHED_FOUR_COUNT": notices,
        "MATCHING_BEGIN_COUNT": ready_count,
        "WRONG_BEGIN_COUNT": other_ready,
        "END_COUNT": summary_count,
        "OTHER_STDOUT_ROWS": other_stdout,
        # This label certifies the single target only *after* controlled-launch
        # ownership proof and the authenticated READY write actually succeed.
        "NEW_TARGET_PROGRAM_COUNT": (len(fresh_kprobe_ids(
            programs_before, programs_after)) if armed else 0),
        "NEW_SEPARATE_RETURN_PROGRAM_COUNT":
            len(new_separate_return_programs(programs_before, programs_after)),
        "NEW_VALID_SESSION_LINK_COUNT": session_link_count,
        "SESSION_LINK_INVENTORY_ERROR": link_inventory_error,
        "INVENTORY_RECORD_COUNT": inventory_records,
        "TRACER_EXIT": child_status if child_status is not None else "unknown",
        "READY_FIFO_WRITTEN": int(armed),
        "READY_FIFO_WRITE_ATTEMPTED": int(arm_attempted),
        "READY_FIFO_WRITE_ERROR": int(fifo_write_error),
        "TARGET_IDENTITY_STABLE": int(identity_ok),
        "CONTROL_STOP_RECEIVED": int(stop_complete),
        "SOURCE_INVALID": int(invalid_source),
        "TRACER_FORCE_STOP": int(forced),
        "KERNEL_INVENTORY_ERROR": inventory_error,
    }
    for name, value in entries.items():
        print(f"KERNEL_AUDIT_{name}={value}", file=sys.stderr, flush=True)


def run_capture(pid, duration, ready_fd, control_fd, helper, probe, tracer, bpftool,
                attach_timeout=60, stdout_fd=1, inventory_audit_fd=None,
                bpftool_identity=None, crash_capture_wrapper=None,
                auto_capture_on_sigabrt=False):
    """Own one tracer only, while retaining every byte of untrusted BPF output."""
    inventory_audit = (InventoryAudit(inventory_audit_fd, bpftool_identity)
                       if inventory_audit_fd is not None else None)
    identity = helper.read_identity(pid, 11434)
    baseline_programs = program_inventory(bpftool, 2.0,
                                          "baseline", inventory_audit)
    baseline_links = link_inventory(bpftool, 2.0, "baseline", inventory_audit)
    started = time.monotonic()
    deadline = started + duration
    graceful_at = helper.graceful_shutdown_at(started, duration)
    parent = os.getpid()
    # Explicit line buffering is required for a readiness marker generated by
    # BEGIN to become visible while the tracer is still attached and running.
    child = subprocess.Popen([str(tracer), "-B", "line", str(probe), str(pid), "11434"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True,
                             preexec_fn=lambda: helper.child_pdeathsig(parent),
                             env=PINNED_TRACER_ENV)
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
    armed_link_ids = set()
    signalled = False
    forced = False
    identity_ok = True
    tracer_identity = None
    invalid_source = False
    inventory_error = "none"
    link_inventory_error = "none"
    session_link_count = 0
    fifo_write_error = False
    operator_stopped = False
    stop_complete = False
    control_data = bytearray()
    kill_time = None
    kill_at = deadline
    last_identity = 0
    last_inventory = 0
    current_programs = baseline_programs
    current_links = baseline_links
    crash_fallback = {"used": False}
    def tracer_state():
        return "running" if child.poll() is None else "exited"

    def checked_links(timeout, phase):
        nonlocal link_inventory_error
        try:
            return inspected_link_inventory(
                bpftool, timeout, phase, inventory_audit, tracer_state,
                crash_capture_wrapper,
                crash_capture_wrapper is not None and not auto_capture_on_sigabrt,
                crash_fallback)
        except (OSError, ValueError, subprocess.SubprocessError,
                json.JSONDecodeError) as error:
            link_inventory_error = type(error).__name__
            raise
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
                    live_tracer_identity = tracer_process_identity(
                        child.pid, tracer, probe, pid,
                        verify_bytes=(tracer_identity is None))
                    if tracer_identity is None:
                        tracer_identity = live_tracer_identity
                    identity_ok = (identity_ok and
                                   live_tracer_identity == tracer_identity)
                except (OSError, ValueError, KeyError):
                    identity_ok = False
            if not armed and not signalled and now - last_inventory >= 1 and \
                    now < graceful_at and now - started < attach_timeout:
                last_inventory = now
                try:
                    current_programs = program_inventory(
                        bpftool, deadline - now, "live", inventory_audit,
                        tracer_state)
                    current_links = checked_links(deadline - now, "live")
                    # Short pinned diagnostic only; no impact on the trusted
                    # READY predicate or the inventory-invocation count.
                    if inventory_audit is not None and bpftool_identity is not None:
                        inventory_audit.record_matcher(matcher_inventory_diagnostic(
                            baseline_programs, current_programs,
                            baseline_links, current_links, child.pid))
                    controlled_objects = controlled_session_objects(
                        baseline_programs, current_programs,
                        baseline_links, current_links,
                        child.pid, tracer_identity if identity_ok else None,
                        tracer, probe, pid)
                    controlled_programs, session_links = controlled_objects
                    session_link_count = len(session_links)
                    proof, count = source_arm_evidence(stdout, stderr, pid, 11434,
                                                       baseline_programs, current_programs,
                                                       baseline_links, current_links, child.pid,
                                                       controlled_objects=controlled_objects)
                    if proof and identity_ok:
                        # The inventory call can consume two seconds; recheck
                        # service identity immediately before signaling READY.
                        identity_ok = (helper.read_identity(pid, 11434) == identity and
                                       tracer_process_identity(
                                           child.pid, tracer, probe, pid,
                                           verify_bytes=True) == tracer_identity and
                                       controlled_session_objects(
                                           baseline_programs, current_programs,
                                           baseline_links, current_links, child.pid,
                                           tracer_identity, tracer, probe, pid)
                                       == controlled_objects)
                    if proof and identity_ok and child.poll() is None:
                        # The signal and monitor are independent channels;
                        # readiness is *prior* to any authorized inference.
                        try:
                            nonblocking_write(ready_fd, numeric_arm_line(
                                pid, 11434, count, 0), min(deadline, now + 2))
                            armed = True
                            arm_attempted = True
                            armed_program_ids = controlled_programs
                            armed_link_ids = session_links
                            os.close(ready_fd)
                        except (OSError, ValueError, TimeoutError):
                            invalid_source = True
                            arm_attempted = True
                            fifo_write_error = True
                except (OSError, ValueError, KeyError, subprocess.SubprocessError,
                        json.JSONDecodeError) as error:
                    inventory_error = type(error).__name__
                    invalid_source = True  # no unknown BPF inventory is allowed
            if armed and not signalled and now - last_inventory >= 5 and now < graceful_at:
                last_inventory = now
                try:
                    live = program_inventory(
                        bpftool, deadline - now, "live", inventory_audit,
                        tracer_state)
                    live_links = checked_links(deadline - now, "live")
                    live_objects = controlled_session_objects(
                        baseline_programs, live, baseline_links, live_links,
                        child.pid, tracer_identity if identity_ok else None,
                        tracer, probe, pid)
                    if live_objects != (armed_program_ids, armed_link_ids):
                        invalid_source = True
                except (OSError, ValueError, subprocess.SubprocessError,
                        json.JSONDecodeError) as error:
                    inventory_error = type(error).__name__
                    invalid_source = True
            if armed and classify_live_output(stdout, stderr)[1].strip():
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
            post_programs = program_inventory(
                bpftool, min(2.0, deadline - now), "terminal", inventory_audit,
                tracer_state)
            post_links = checked_links(min(2.0, deadline - now), "terminal")
            kernel_clean = (kernel_clean and
                            not armed_program_ids.intersection(post_programs) and
                            not armed_link_ids.intersection(post_links))
        except (OSError, ValueError, subprocess.SubprocessError,
                json.JSONDecodeError):
            kernel_clean = False
    # An autonomous graceful timeout is bounded cleanup, not an authenticated
    # STOP from the task-owned coordinator. It must never certify a complete
    # operator-controlled kernel session or an importer-ready END receipt.
    complete_source = (armed and arm_attempted and completed_notices == 1 and
                       stop_complete and identity_ok and not invalid_source and
                       not operator_stopped and not forced and now <= deadline and
                       kernel_clean)
    rows, status, complete = helper.summarize_trace(
        source_stdout, source_stderr, pid, 11434, duration_ms, signalled,
        child_exit_status(child.returncode, signalled), complete_source,
        max_duration_ms=duration * 1000)
    if not complete:
        status = status.replace("TCPSESSION complete ", "TCPSESSION partial ", 1)
    emit_content_free_audit(bytes(stdout), bytes(stderr), pid,
                            baseline_programs, current_programs, child.returncode,
                            armed, arm_attempted, fifo_write_error, identity_ok,
                            stop_complete, invalid_source, forced, inventory_error,
                            session_link_count, link_inventory_error,
                            inventory_audit.invocations if inventory_audit else 0)
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
    parser.add_argument("--inventory-audit-fd", required=True, type=int)
    parser.add_argument("--fixed-diagnostic-bpftool", action="store_true")
    parser.add_argument("--capture-live-link-abort", action="store_true")
    args = parser.parse_args(argv)
    if args.capture_live_link_abort and (
            not args.fixed_diagnostic_bpftool or args.seconds > 20):
        parser.error("Crash capture requires fixed short kernel-only diagnostic")
    if platform.system() != "Linux" or sys.byteorder != "little" or os.geteuid() != 0:
        parser.error("Linux little-endian root operator required")
    if args.ready_fd < 3 or args.ready_fd > 255:
        parser.error("Bounded private ready FD must be >= 3")
    if args.control_fd < 0 or args.control_fd > 255 or args.control_fd in (1, 2, args.ready_fd):
        parser.error("Control FD must be a separate private pipe")
    if args.inventory_audit_fd < 3 or args.inventory_audit_fd > 255 or \
            args.inventory_audit_fd in (args.control_fd, args.ready_fd) or \
            not stat.S_ISREG(os.fstat(args.inventory_audit_fd).st_mode) or \
            os.fstat(args.inventory_audit_fd).st_uid != 0 or \
            stat.S_IMODE(os.fstat(args.inventory_audit_fd).st_mode) != 0o600:
        parser.error("Inventory audit FD must be a separate root-owned regular file")
    if not 1 <= args.seconds <= MAX_SECONDS:
        parser.error("Maximum session is 1800 seconds")
    if args.fixed_diagnostic_bpftool and 20 < args.seconds < MAX_SECONDS:
        parser.error("Private bpftool requires approved short or production mode")
    if args.seconds == MAX_SECONDS and not args.fixed_diagnostic_bpftool:
        parser.error("PRIVATE_BPFTOOL_QUALIFICATION_FAILED")
    if not stat.S_ISFIFO(os.fstat(args.ready_fd).st_mode) or \
            not stat.S_ISFIFO(os.fstat(1).st_mode) or \
            not stat.S_ISFIFO(os.fstat(args.control_fd).st_mode):
        parser.error("Control and output channels must be anonymous pipes or FIFOs")
    try:
        folder = verified_file(__file__).parent
        helper = load_hardened_support(folder)
        helper.validate_scope(args.pid, 11434, args.seconds)
        probe = verified_file(folder / "local-muse-tcp.bt", PROBE_SHA256)
        bpftool_name = shutil.which("bpftool") if not args.fixed_diagnostic_bpftool else None
        tracer = qualified_tracer()
        if args.seconds != MAX_SECONDS and not args.fixed_diagnostic_bpftool:
            raise ValueError("Short affected-host diagnostic requires pinned fixed bpftool")
        if args.fixed_diagnostic_bpftool:
            try:
                bpftool, bpftool_identity = qualified_diagnostic_bpftool()
            except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                print("KERNEL_AUDIT_PRIVATE_BPFTOOL_QUALIFICATION_FAILED=1",
                      file=sys.stderr, flush=True)
                raise
            print("KERNEL_AUDIT_BPFT_DIAGNOSTIC_SELECTED=1", file=sys.stderr, flush=True)
            print("KERNEL_AUDIT_BPFT_BINARY_SHA256=" +
                  bpftool_identity["binarySha256"], file=sys.stderr, flush=True)
        else:
            if not bpftool_name:
                raise ValueError("Approved BPF tools unavailable")
            bpftool = helper.trusted_root_file(bpftool_name)
            bpftool_identity = None
        # Mandatory for short private-binary runs, BEFORE BPF attachment:
        # an ordinary live -j link show may still SIGABRT. The exact pinned
        # observer is then used once in that SAME BPF session, never for
        # successful ordinary link inspection. Its result cannot arm READY.
        crash_capture_wrapper = (qualified_diagnostic_crash_wrapper()
                                 if args.fixed_diagnostic_bpftool and args.seconds <= 20 else None)
        if resource is None:
            raise ValueError("Root collector requires Linux core controls")
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        return run_capture(args.pid, args.seconds, args.ready_fd, args.control_fd,
                           helper, probe, tracer, bpftool,
                           inventory_audit_fd=args.inventory_audit_fd,
                           bpftool_identity=bpftool_identity,
                           crash_capture_wrapper=crash_capture_wrapper,
                           auto_capture_on_sigabrt=(
                               args.fixed_diagnostic_bpftool and
                               args.seconds <= 20 and
                               not args.capture_live_link_abort))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        # Setup may have failed before a child was created. Never emit READY.
        # An absent/incomplete import terminal is an unsealable source.
        print(f"KERNEL_AUDIT_SETUP_ERROR={type(error).__name__}",
              file=sys.stderr, flush=True)
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
