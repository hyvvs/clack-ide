#!/usr/bin/env python3
"""Root-local symbolic SIGABRT observer; NEVER a readiness proof.

Production CLI has no arguments: ONLY the SHA-pinned private bpftool
with the literal -j link show command is supported. Inferior/debugger
output never crosses the JSON boundary except closed-vocabulary fields.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time

VERSION = 1
TARGET = Path("/opt/clack/diagnostic-tools/bpftool-678d538")
TARGET_SHA = "0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0"
TARGET_BUILD_ID = "7f530859f49ede16767f9f4eb8551a6ac85aa25d"
GDB = Path("/usr/bin/gdb")
GDB_VERSION = "GNU gdb (GDB) 18.1"
MAX_SECONDS = 4.0
MAX_FRAMES = 12
MAX_INLINES = 4
MAX_MODULE_OFFSET = 32 * 1024 * 1024
MAX_STREAM = 32768
MAX_PTY = 65536
MAX_RECORD = 6144
MARKER = b"CLACK_GDB_CAPTURE_V1="
EMPTY_SHA = hashlib.sha256(b"").hexdigest()

# Embedded GDB Python uses frame metadata only. It NEVER prints memory,
# argument values, registers, arbitrary debugger console text or environment.
# Child stdout/stderr goes to the dedicated PTY and is separately suppressed.
GDB_SCRIPT = r'''
python
import gdb
import json
import os
import re

_state = {"observedSignal": None, "inferiorExitCode": None,
          "inferiorExited": False, "frames": [], "modules": [],
          "assertionSite": None}
_name = re.compile(r"[A-Za-z_~][A-Za-z0-9_~.$:+<>-]{0,95}\Z")
_symbol = re.compile(
    r"([A-Za-z_~][A-Za-z0-9_~.$:+<>-]{0,95})"
    r"(?: \+ ([0-9]{1,8}))? in section [A-Za-z0-9_.+-]+ of ")

def _source(pc, frame):
    # For an older frame, pc-1 resolves the CALL site, not the return
    # instruction. GDB APIs, not source/memory printing, supply DWARF.
    sal = gdb.find_pc_line(pc)
    if sal and sal.symtab and sal.line > 0:
        return sal.symtab.filename, sal.line
    sal = frame.find_sal()
    return (sal.symtab.filename if sal and sal.symtab else None,
            sal.line if sal else None)

def _main_module(pc):
    try:
        # GDB can return no section owner for the return-address-adjusted
        # caller even when its DWARF frame and line are resolved. Require
        # both non-solib attribution AND a /proc mapping owned by the exact
        # active inferior executable; never classify libc by absence alone.
        return gdb.solib_name(pc) is None and _relative_pc(pc) is not None
    except Exception:
        return False

def _relative_pc(pc):
    # Read only the debugger inferior's kernel mapping metadata. NEVER export
    # a /proc/maps row, absolute PC, address, allocation or pathname.
    pid = gdb.selected_inferior().pid
    path = os.path.realpath(gdb.current_progspace().filename)
    if not isinstance(pid, int) or pid <= 1:
        return None
    with open("/proc/%d/maps" % pid, "r", encoding="ascii",
              errors="replace") as handle:
        data = handle.read(65537)
    if len(data) > 65536:
        return None
    base = None
    executable = False
    for row in data.splitlines():
        fields = row.split(None, 5)
        if len(fields) != 6 or fields[5] != path:
            continue
        addresses = fields[0].split("-")
        if len(addresses) != 2:
            continue
        start, end = int(addresses[0], 16), int(addresses[1], 16)
        if int(fields[2], 16) == 0:
            base = start if base is None else min(base, start)
        if start <= pc < end and "x" in fields[1]:
            executable = True
    if base is None or not executable:
        return None
    offset = pc - base
    return offset if 0 <= offset < 33554432 else None

def _symbol_name(pc, frame):
    name = frame.name()
    # An optimized/unwound frame may have no Frame.name even if .symtab has a
    # usable nearest symbol. This command's raw text stays INSIDE GDB.
    try:
        result = gdb.execute("info symbol 0x%x" % pc, to_string=True).strip()
        match = _symbol.match(result)
        if match:
            offset = int(match.group(2) or 0)
            if offset < 33554432:
                return match.group(1), offset
    except gdb.error:
        pass
    return (name if isinstance(name, str) and _name.fullmatch(name)
            else "unknown"), None

def _assertion_site(frame, index):
    pc = int(frame.pc())
    # A caller's saved PC is the instruction *after* the call to
    # __assert_fail; subtract one for exact call-site lookup.
    pc = pc - 1 if index > 0 and pc > 0 else pc
    if not _main_module(pc):
        return None
    name, displacement = _symbol_name(pc, frame)
    file, line = _source(pc, frame)
    site = {"module": os.path.basename(gdb.current_progspace().filename),
            "moduleOffset": _relative_pc(pc),
            "symbol": name, "functionOffset": displacement,
            "file": file, "line": line, "inlineChain": []}
    cursor = frame
    for _ in range(4):
        if cursor is None or cursor.type() != gdb.INLINE_FRAME:
            break
        if not _main_module(int(cursor.pc()) - 1):
            break
        inner_file, inner_line = _source(int(cursor.pc()) - 1, cursor)
        site["inlineChain"].append({
            "function": cursor.name(), "file": inner_file, "line": inner_line})
        cursor = cursor.older()
    return site

def _stopped(event):
    if isinstance(event, gdb.SignalEvent):
        _state["observedSignal"] = event.stop_signal
def _exited(event):
    _state["inferiorExited"] = True
    if hasattr(event, "exit_code"):
        _state["inferiorExitCode"] = event.exit_code
gdb.events.stop.connect(_stopped)
gdb.events.exited.connect(_exited)
try:
    gdb.execute("set pagination off", to_string=True)
    gdb.execute("set confirm off", to_string=True)
    gdb.execute("set print frame-arguments none", to_string=True)
    gdb.execute("set print address off", to_string=True)
    gdb.execute("set print elements 0", to_string=True)
    gdb.execute("handle SIGABRT stop print nopass", to_string=True)
    gdb.execute("run", to_string=True)
    if _state["observedSignal"] == "SIGABRT":
        frame = gdb.selected_frame()
        previous = None
        for index in range(12):
            if frame is None:
                break
            sal = frame.find_sal()
            if previous == "__assert_fail" and _state["assertionSite"] is None:
                try:
                    _state["assertionSite"] = _assertion_site(frame, index)
                except (OSError, ValueError, gdb.error):
                    pass  # missing symbols/maps are unresolved, never guessed
            _state["frames"].append({
                "function": frame.name(),
                "module": gdb.solib_name(frame.pc()),
                "file": sal.symtab.filename if sal and sal.symtab else None,
                "line": sal.line if sal else None})
            previous = frame.name()
            frame = frame.older()
        for obj in gdb.objfiles():
            _state["modules"].append({
                "module": obj.filename,
                "buildId": getattr(obj, "build_id", None)})
        gdb.execute("signal SIGABRT", to_string=True)
    print("CLACK_GDB_CAPTURE_V1=" +
          json.dumps(_state, separators=(",", ":"), ensure_ascii=True))
except BaseException:
    print('CLACK_GDB_CAPTURE_V1={"debuggerError":"gdb_command_failure"}')
end
'''

SAFE_FUNCTION = re.compile(r"[A-Za-z_~][A-Za-z0-9_~.$:+<>-]{0,95}\Z")
SAFE_BASENAME = re.compile(r"[A-Za-z0-9_.+-]{1,88}\Z")
SAFE_BUILD_ID = re.compile(r"[a-f0-9]{16,64}\Z")
SAFE_ABORT = frozenset((
    "free(): invalid pointer", "free(): double free detected in tcache 2",
    "malloc(): corrupted top size", "malloc(): invalid size (unsorted)",
    "corrupted size vs. prev_size", "double free or corruption (out)",
    "munmap_chunk(): invalid pointer",
))
SAFE_ASSERT = re.compile(
    rb"(?:bpftool(?:-678d538)?|/opt/clack/diagnostic-tools/bpftool-678d538): "
    rb"((?:[A-Za-z0-9_.-]+/){0,6}([A-Za-z_][A-Za-z0-9_.+-]{0,87}\.[ch])):"
    rb"([1-9][0-9]{0,5}): ([A-Za-z_][A-Za-z0-9_]{0,63}): "
    rb"Assertion [^\x00\r\n]{1,110} failed\.\Z")


def safe_assertion_metadata(data):
    """Return only a fixed category and four location fields; never expression."""
    if not data or len(data) > MAX_PTY:
        return None, None
    lines = data.splitlines()
    if len(lines) != 1 or len(lines[0]) > 240:
        return None, None
    line = lines[0]
    try:
        decoded = line.decode("ascii")
    except UnicodeDecodeError:
        return None, None
    if decoded in SAFE_ABORT:
        return decoded, None
    match = SAFE_ASSERT.fullmatch(line)
    if not match:
        return None, None
    return "bpftool: C assertion failure (details redacted)", {
        "module": "bpftool-678d538",
        "sourceFile": match.group(2).decode("ascii"),
        "sourceLine": int(match.group(3)),
        "function": match.group(4).decode("ascii")}


def safe_stderr_class(data):
    return safe_assertion_metadata(data)[0]


def safe_basename(value):
    if not isinstance(value, str) or len(value) > 384 or "\x00" in value:
        return None
    name = value.replace("\\", "/").rsplit("/", 1)[-1]
    return name if SAFE_BASENAME.fullmatch(name) and name not in (".", "..") else None


def safe_source(value, line):
    name = safe_basename(value)
    if name and type(line) is int and 1 <= line <= 1_000_000:
        return {"sourceFile": name, "sourceLine": line}
    return {}


def normalize_assertion_site(raw, ids):
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != {
            "module", "moduleOffset", "symbol", "functionOffset",
            "file", "line", "inlineChain"}:
        raise ValueError("unrecognized_assertion_site")
    module = safe_basename(raw["module"])
    if not module or module not in ids:
        raise ValueError("unverified_assertion_module")
    result = {"module": module, "moduleBuildId": ids[module]}
    if type(raw["moduleOffset"]) is int and 0 <= raw["moduleOffset"] < MAX_MODULE_OFFSET:
        result["moduleOffset"] = raw["moduleOffset"]
    elif raw["moduleOffset"] is not None:
        raise ValueError("unbounded_module_offset")
    name = raw["symbol"]
    result["symbol"] = name if isinstance(name, str) and SAFE_FUNCTION.fullmatch(name) \
        else "unknown"
    displacement = raw["functionOffset"]
    if type(displacement) is int and 0 <= displacement < MAX_MODULE_OFFSET and \
            result["symbol"] != "unknown":
        result["functionOffset"] = displacement
    elif displacement is not None:
        raise ValueError("unbounded_function_offset")
    result.update(safe_source(raw["file"], raw["line"]))
    if not isinstance(raw["inlineChain"], list) or len(raw["inlineChain"]) > MAX_INLINES:
        raise ValueError("unbounded_inline_chain")
    chain = []
    for item in raw["inlineChain"]:
        if not isinstance(item, dict) or set(item) != {"function", "file", "line"}:
            raise ValueError("invalid_inline_frame")
        name = item["function"]
        if not isinstance(name, str) or not SAFE_FUNCTION.fullmatch(name):
            raise ValueError("invalid_inline_name")
        chain.append({"function": name, **safe_source(item["file"], item["line"])})
    result["inlineChain"] = chain
    return result


def normalize_gdb(raw):
    """Drop paths, addresses, all argument values and unrecognized metadata."""
    if not isinstance(raw, dict) or set(raw) != {
            "observedSignal", "inferiorExitCode", "inferiorExited", "frames",
            "modules", "assertionSite"} or raw["observedSignal"] not in (None, "SIGABRT"):
        return None
    if type(raw["inferiorExited"]) is not bool:
        return None
    code = raw["inferiorExitCode"]
    if code is not None and (type(code) is not int or not 0 <= code <= 255):
        return None
    frames, modules = raw["frames"], raw["modules"]
    if not isinstance(frames, list) or not isinstance(modules, list) or \
            len(frames) > MAX_FRAMES or len(modules) > 128:
        return None
    ids = {}
    for item in modules:
        if not isinstance(item, dict) or set(item) != {"module", "buildId"}:
            return None
        name = safe_basename(item["module"])
        bid = item["buildId"]
        if name and isinstance(bid, str) and SAFE_BUILD_ID.fullmatch(bid):
            ids[name] = bid
    safe_frames = []
    for n, item in enumerate(frames):
        if not isinstance(item, dict) or set(item) != {
                "function", "module", "file", "line"}:
            return None
        fun = item["function"]
        if not isinstance(fun, str) or not SAFE_FUNCTION.fullmatch(fun):
            fun = "unknown"
        module = safe_basename(item["module"]) or "bpftool-678d538"
        frame = {"index": n, "function": fun, "module": module}
        if module in ids:
            frame["moduleBuildId"] = ids[module]
        file = safe_basename(item["file"])
        line = item["line"]
        if file and type(line) is int and 1 <= line <= 1_000_000:
            frame["sourceFile"] = file
            frame["sourceLine"] = line
        safe_frames.append(frame)
    try:
        site = normalize_assertion_site(raw["assertionSite"], ids)
    except ValueError:
        return None
    return {"observedSignal": raw["observedSignal"],
            "inferiorExitCode": code, "inferiorExited": raw["inferiorExited"],
            "frames": safe_frames, "assertionSite": site}


def root_executable(path):
    path = Path(path)
    for item in (path, *path.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or \
                info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise ValueError("unsafe_root_path")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or not info.st_mode & stat.S_IXUSR:
        raise ValueError("unsafe_root_executable")
    return path


def file_sha(path):
    size = Path(path).stat().st_size
    if not 0 < size <= 32 * 1024 * 1024:
        raise ValueError("unbounded_executable")
    digest = hashlib.sha256()
    with open(path, "rb") as fd:
        for block in iter(lambda: fd.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def production_preflight():
    if os.geteuid() != 0:
        raise ValueError("requires_root")
    fixed = root_executable(TARGET)
    debugger = root_executable(GDB)
    if file_sha(fixed) != TARGET_SHA:
        raise ValueError("wrong_private_hash")
    version = subprocess.run(
        [str(debugger), "--version"], stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1.5,
        check=False)
    if version.returncode or version.stderr or len(version.stdout) > 512 or \
            not version.stdout.startswith((GDB_VERSION + "\n").encode("ascii")):
        raise ValueError("unapproved_debugger_version")
    elf = subprocess.run(
        ["/usr/bin/readelf", "-n", str(fixed)], stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1.5,
        check=False)
    if elf.returncode or elf.stderr or len(elf.stdout) > MAX_STREAM or \
            not re.search(rb"\bBuild ID: " + TARGET_BUILD_ID.encode("ascii") +
                          rb"\b", elf.stdout):
        raise ValueError("wrong_binary_build_id")
    return str(fixed), str(debugger)


def _no_core():
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _reap(proc):
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=1.0)


def capture(target, debugger, *, timeout=MAX_SECONDS, debugger_version=GDB_VERSION):
    """Unprivileged tests can inject fixtures; production CLI cannot."""
    if not 0.1 <= timeout <= MAX_SECONDS:
        raise ValueError("invalid_timeout")
    record = {
        "schemaVersion": VERSION, "capture": "FAIL",
        "commandClass": "private_fixed_link_show",
        "executableSha256": None, "buildId": None,
        "debuggerVersion": debugger_version, "debuggerExitCode": None,
        "observedSignal": None, "inferiorExitCode": None,
        "inferiorSignal": None, "signalEvidence": "none",
        "inferiorExited": False, "frames": [], "assertionClass": None,
        "assertionLocation": None, "assertionSite": None,
        "inferiorOutputBytes": 0, "inferiorOutputSha256": EMPTY_SHA,
        "debuggerOutputBytes": 0, "debuggerOutputSha256": EMPTY_SHA,
        "timedOut": False, "cleanup": "FAIL",
    }
    proc = None
    master = slave = None
    started = time.monotonic()
    try:
        record["executableSha256"] = file_sha(target)
        import pty
        import tty
        import errno
        master, slave = pty.openpty()
        tty.setraw(slave)
        tty_name = os.ttyname(slave)
        if not re.fullmatch(r"/dev/pts/[0-9]{1,7}", tty_name):
            raise ValueError("untrusted_inferior_tty")
        with tempfile.TemporaryDirectory(
                prefix="clack-gdb-capture-",
                dir="/run" if hasattr(os, "geteuid") and os.geteuid() == 0
                else None) as folder:
            os.chmod(folder, 0o700)
            command = Path(folder, "capture.gdb")
            fd = os.open(command, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                         os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w", encoding="ascii") as script:
                script.write(GDB_SCRIPT)
            argv = [
                str(debugger), "-q", "-nx", "-nh", "--batch",
                "-iex", "set auto-load off",
                "-iex", "set debuginfod enabled off",
                "-iex", "set disable-randomization off",
                "-iex", "set pagination off",
                "-iex", "set confirm off",
                "-ex", "set inferior-tty " + tty_name,
                "-x", str(command),
                "--args", str(target), "-j", "link", "show"]
            proc = subprocess.Popen(
                argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, start_new_session=True,
                preexec_fn=_no_core, close_fds=True)
            # Keep the slave PTY open until the debugger can open it. Closing
            # it immediately allows the master's early EIO to discard *all*
            # late inferior diagnostics, especially brief abort messages.
            outputs = {"gdb": bytearray(), "gdbError": bytearray(),
                       "inferior": bytearray()}
            sel = selectors.DefaultSelector()
            for channel, name in ((proc.stdout, "gdb"), (proc.stderr, "gdbError"),
                                  (master, "inferior")):
                fd = channel if isinstance(channel, int) else channel.fileno()
                os.set_blocking(fd, False)
                sel.register(fd, selectors.EVENT_READ, name)
            overflow = False
            try:
                while sel.get_map():
                    remaining = started + timeout - time.monotonic()
                    if remaining <= 0:
                        record["capture"], record["timedOut"] = "TIMEOUT", True
                        break
                    for key, _ in sel.select(min(remaining, 0.1)):
                        try:
                            data = os.read(key.fd, 4096)
                        except OSError as e:
                            if e.errno != errno.EIO:
                                raise
                            data = b""
                        if not data:
                            sel.unregister(key.fd)
                        elif len(outputs[key.data]) + len(data) > (
                                MAX_PTY if key.data == "inferior" else MAX_STREAM):
                            overflow = True
                            break
                        else:
                            outputs[key.data].extend(data)
                    if proc.poll() is not None and slave is not None and \
                            not any(key.data in ("gdb", "gdbError")
                                    for key in sel.get_map().values()):
                        os.close(slave)
                        slave = None
                    if overflow:
                        break
            finally:
                sel.close()
                _reap(proc)
            record["debuggerExitCode"] = proc.returncode
            for name, field in (("gdb", "debugger"), ("inferior", "inferior")):
                record[field + "OutputBytes"] = len(outputs[name])
                record[field + "OutputSha256"] = hashlib.sha256(
                    outputs[name]).hexdigest()
            record["assertionClass"], record["assertionLocation"] = (
                safe_assertion_metadata(bytes(outputs["inferior"])))
            if not (overflow or record["timedOut"] or outputs["gdbError"]):
                markers = [x[len(MARKER):] for x in outputs["gdb"].splitlines()
                           if x.startswith(MARKER)]
                if len(markers) == 1 and len(markers[0]) <= 8192:
                    try:
                        normalized = normalize_gdb(json.loads(markers[0]))
                    except (ValueError, UnicodeDecodeError):
                        normalized = None
                    if normalized is not None:
                        record.update(normalized)
                        if normalized["observedSignal"] == "SIGABRT" and \
                                normalized["inferiorExited"] and \
                                normalized["inferiorExitCode"] is None:
                            # GDB caught SIGABRT, explicitly delivered it
                            # onward and received the inferior-exited event.
                            # GDB's own exit status remains *separate*.
                            record["inferiorSignal"] = 6
                            record["signalEvidence"] = (
                                "gdb_sigabrt_forwarded_inferior_exited")
                        if proc.returncode == 0 and normalized["inferiorExited"] and (
                                normalized["observedSignal"] == "SIGABRT" and
                                bool(normalized["frames"]) or
                                normalized["observedSignal"] is None and
                                normalized["inferiorExitCode"] is not None):
                            record["capture"] = "PASS"
    except (OSError, ValueError, subprocess.SubprocessError):
        record["capture"] = "FAIL"
    finally:
        if proc is not None:
            try:
                _reap(proc)
            except (OSError, subprocess.SubprocessError):
                record["capture"] = "FAIL"
            for stream in (proc.stdout, proc.stderr):
                if stream is not None:
                    stream.close()
        for fd in (master, slave):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
        record["cleanup"] = "PASS" if proc is None or proc.poll() is not None else "FAIL"
        if record["cleanup"] != "PASS":
            record["capture"] = "FAIL"
    if len(json.dumps(record, separators=(",", ":"), ensure_ascii=True)) > MAX_RECORD:
        record["capture"], record["frames"] = "FAIL", []
    return record


def main(argv=None):
    if argv if argv is not None else sys.argv[1:]:
        return 2
    try:
        target, debugger = production_preflight()
        record = capture(target, debugger)
        record["buildId"] = TARGET_BUILD_ID
    except (OSError, ValueError, subprocess.SubprocessError):
        record = {"schemaVersion": VERSION, "capture": "FAIL",
                  "commandClass": "private_fixed_link_show",
                  "failureClass": "preflight_unavailable", "cleanup": "PASS"}
    payload = json.dumps(record, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=True)
    if len(payload) > MAX_RECORD:
        return 2
    sys.stdout.write(payload + "\n")
    return {"PASS": 0, "FAIL": 2, "TIMEOUT": 124}[record["capture"]]


if __name__ == "__main__":
    sys.exit(main())
