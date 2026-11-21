#!/usr/bin/python3 -I
"""Root-owned, sudoers-pinned launcher for ONE reviewed Clack Muse collector.

The only accepted invocations are --self-check and --run RUN_ID OLLAMA_PID.
No shell input, arbitrary paths, environment command overrides, durations,
model requests, or service settings are accepted.  This is an installation
asset, NOT meant to run from the user-writable worktree.
"""
import hashlib
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import sys

LAUNCHER = Path("/usr/local/libexec/clack-one-muse-root")
ASSETS = Path("/usr/local/libexec/clack-one-muse-assets")
STAGE = Path("/run/local-muse-ebpf")
RUN_ID = re.compile(r"muse-one-[a-f0-9]{24}\Z", re.ASCII)
PID = re.compile(r"[1-9][0-9]{0,9}\Z", re.ASCII)
FILES = {
    "local-muse-one-root.sh": "69ad979c5f5cd73cdc3ba5e4e29bafea4dbd278055e27dc6028b2d36fd682137",
    "local-muse-one-ebpf.py": "eed450245218a9cbf02bacdbe4d08c5dc071636e5ca61904aac5f7a4e72c24df",
    "local-muse-tcp-session.py": "d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf",
    "local-muse-tcp.bt": "e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0",
}
SAFE_ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/nonexistent",
    "LANG": "C",
    "LC_ALL": "C",
}
MAX_SECONDS = 1800


def fail(reason):
    # Never emit raw commands, network content, kernel addresses or credentials.
    print("CLACK_NARROW_ROOT_ERROR=" + reason, file=sys.stderr, flush=True)
    raise SystemExit(1)


def secure_file(path, mode, sha=None):
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_gid != 0 or (
            stat.S_IMODE(st.st_mode) != mode or st.st_nlink != 1):
        fail("invalid_root_file")
    if sha and hashlib.sha256(path.read_bytes()).hexdigest() != sha:
        fail("pinned_content_mismatch")


def secure_dir(path, private=False):
    st = path.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_gid != 0:
        fail("untrusted_parent")
    if stat.S_IMODE(st.st_mode) & 0o022:
        fail("replaceable_root_path")
    if private and stat.S_IMODE(st.st_mode) != 0o700:
        fail("asset_directory_not_private")


def inspect_install():
    if os.geteuid() != 0 or os.getuid() != 0:
        fail("must_execute_as_root")
    for parent in (Path("/"), Path("/usr"), Path("/usr/local"),
                   Path("/usr/local/libexec")):
        secure_dir(parent)
    secure_dir(ASSETS, private=True)
    secure_file(LAUNCHER, 0o755)
    for filename, digest in FILES.items():
        secure_file(ASSETS / filename, 0o600, digest)
    if set(item.name for item in ASSETS.iterdir()) != set(FILES):
        fail("unreviewed_installed_asset")
    account = pwd.getpwnam("hylab")
    if account.pw_uid != 1000 or account.pw_gid <= 0:
        fail("unexpected_lab_identity")
    return account.pw_gid


def checked_pid(expected):
    if not PID.fullmatch(expected) or int(expected) > 2147483647:
        fail("invalid_ollama_pid")
    service = subprocess.run(
        ["/usr/bin/systemctl", "show", "--value", "-p", "MainPID", "ollama.service"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=3, check=False, env=SAFE_ENV)
    if service.returncode or service.stdout != expected.encode("ascii") + b"\n":
        fail("ollama_pid_not_current")
    comm = Path("/proc") / expected / "comm"
    if comm.read_bytes() != b"ollama\n":
        fail("not_ollama_service")


def install_stage_file(source, destination, expected):
    # Assets are root-only. Copy with O_NOFOLLOW and O_EXCL; never execute
    # scripts directly from a writable home, an arbitrary path or stdin.
    fd = os.open(source, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        raw = bytearray()
        while True:
            piece = os.read(fd, 65536)
            if not piece:
                break
            raw.extend(piece)
            if len(raw) > 1024 * 1024:
                fail("asset_size_outside_bound")
        if hashlib.sha256(raw).hexdigest() != expected:
            fail("source_asset_changed")
        target_fd = os.open(destination, os.O_CREAT | os.O_EXCL |
                            os.O_WRONLY | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(target_fd, "wb", closefd=False) as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(target_fd)
        finally:
            os.close(target_fd)
        secure_file(destination, 0o600, expected)
    finally:
        os.close(fd)


def owned_stage_cleanup(run_path):
    # Only stage roots created by THIS invocation may be removed. Never
    # recursively remove unknown content or a preexisting /run path.
    if not STAGE.exists() or STAGE.is_symlink():
        return
    expected_children = {
        *FILES, "control.fifo", "ready.fifo", "metadata.fifo",
        "kernel-audit.stderr", "kernel-audit.numeric", "kernel-inventory-audit.jsonl",
    }
    if run_path.exists() and not run_path.is_symlink():
        if not set(p.name for p in run_path.iterdir()).issubset(expected_children):
            fail("unreviewed_stage_cleanup_content")
        for child in run_path.iterdir():
            if child.is_dir() or child.is_symlink():
                fail("unsafe_stage_cleanup_target")
            child.unlink()
        run_path.rmdir()
    if not list(STAGE.iterdir()):
        STAGE.rmdir()


def launch(run_id, expected_pid, group):
    if not RUN_ID.fullmatch(run_id):
        fail("invalid_run_id")
    checked_pid(expected_pid)
    secure_dir(Path("/run"))
    # An owned stage must be created exclusively; never reuse an existing
    # directory, FIFO or older run. hylab receives only traversal permission.
    STAGE.mkdir(mode=0o700)
    run_path = STAGE / run_id
    child = None
    try:
        os.chown(STAGE, 0, group)
        STAGE.chmod(0o710)
        run_path.mkdir(mode=0o700)
        os.chown(run_path, 0, group)
        run_path.chmod(0o710)
        for filename, digest in FILES.items():
            install_stage_file(ASSETS / filename, run_path / filename, digest)
        child = subprocess.Popen(
            ["/usr/bin/bash", str(run_path / "local-muse-one-root.sh"),
             run_id, expected_pid, str(MAX_SECONDS), "", "off"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=sys.stderr,
            env=SAFE_ENV, start_new_session=True, close_fds=True)
        try:
            return child.wait(timeout=MAX_SECONDS + 11)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=3)
            fail("bounded_collector_watchdog")
    finally:
        # Collector normally performs authenticated STOP and removes the
        # exact stage itself; this path only covers earlier failures.
        if child is None or child.poll() is not None:
            owned_stage_cleanup(run_path)


def main():
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(SAFE_ENV)
    os.chdir("/")
    group = inspect_install()
    if sys.argv[1:] == ["--self-check"]:
        print("CLACK_NARROW_SUDO_SELF_CHECK=PASS", flush=True)
        return 0
    if len(sys.argv) == 4 and sys.argv[1] == "--run":
        return launch(sys.argv[2], sys.argv[3], group)
    fail("unrecognized_arguments")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError):
        fail("safe_operation_failed")
