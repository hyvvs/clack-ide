#!/usr/bin/python3 -I
"""One-time, pinned, fail-closed production Clack private-bpftool repin.

Only an independently SHA-pinned root bootstrap may execute this exact script.
Runtime sudoers NEVER allows this installer. This program does not attach BPF,
change kernel settings, call Ollama, or run Clack inference.

The sudoers digest is atomically changed FIRST, so the old wrapper cannot run
while the exact new assets and wrapper are switched. Each rename is atomic on
the local filesystem. An exception restores old wrapper/assets and swaps
the old pinned sudoers LAST. A hard crash may leave admission denied, never
an unpinned executable authorized by sudoers.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys

# Importing the reviewed collector for its version-only identity helper must
# NEVER create __pycache__ inside the exact-four-files immutable asset tree.
sys.dont_write_bytecode = True

VERSION = "private-bpftool-v2-20261112"
ROOT = Path("/usr/local/libexec")
ASSETS = ROOT / "clack-one-muse-assets"
WRAPPER = ROOT / "clack-one-muse-root"
RULE = Path("/etc/sudoers.d/90-clack-one-muse-root")
PIN_BINARY = Path("/opt/clack/diagnostic-tools/bpftool-678d538")
PIN_MANIFEST = Path("/opt/clack/diagnostic-tools/bpftool-678d538.pin.json")
PRIVATE_SHA = "0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0"
PRIVATE_PIN_SHA = "215855a87f21ecd219cb642a392fa4cb8e716a58b9f1b811f4b8e91e876ff197"
PRIVATE_BUILD_ID = "7f530859f49ede16767f9f4eb8551a6ac85aa25d"
MANIFEST_SHA = "34cdff42d5e43a1cbdbadbb96d537614e6bf7d81099cdcd92a753b1db84809a7"
STAGE_RE = re.compile(
    r"/home/hylab/\.cache/clack-muse-private-repin\.[A-Za-z0-9]{8}\Z",
    re.ASCII)
OLD = {
    "local-muse-one-root.sh": "69ad979c5f5cd73cdc3ba5e4e29bafea4dbd278055e27dc6028b2d36fd682137",
    "local-muse-one-ebpf.py": "eed450245218a9cbf02bacdbe4d08c5dc071636e5ca61904aac5f7a4e72c24df",
    "local-muse-tcp-session.py": "d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf",
    "local-muse-tcp.bt": "e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0",
    "one-muse-narrow-root.py": "551de3b1b2895b06f5bafd19b569fb41ab2170990bbb74a39d41014532ab223b",
    "one-muse-narrow-sudoers": "5c009fffbfe7c2ebb5cf720a0cd31e44f46559477af0f1b5c0b6f7646e096268",
}
NEW = {
    "local-muse-one-root.sh": "b3da0a0de8e8c6c1648ef6ce9c9ecb14f642341468e8dfc567962667ad3f6f44",
    "local-muse-one-ebpf.py": "169c1ae8e6822f7e795cfadb8d624d5e03964d0f182cdf6c948aa012dc12a527",
    "local-muse-tcp-session.py": OLD["local-muse-tcp-session.py"],
    "local-muse-tcp.bt": OLD["local-muse-tcp.bt"],
    "one-muse-narrow-root.py": "bdba04eb0952a2cd4c1e9f77f645be716b6ef220e124045d0e0f630ddee77260",
    "one-muse-narrow-sudoers": "a9782c350e18c09a83bd543d3359ab13cc371aae945f28f39492db421cf49586",
}
ASSET_NAMES = frozenset(("local-muse-one-root.sh", "local-muse-one-ebpf.py",
                          "local-muse-tcp-session.py", "local-muse-tcp.bt"))
STAGED_NAMES = frozenset(("local-muse-one-root.sh", "local-muse-one-ebpf.py",
                          "one-muse-narrow-root.py", "one-muse-narrow-sudoers",
                          "manifest.json", "installer.py"))
ROOT_ENV = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent",
            "LANG": "C", "LC_ALL": "C"}


class RepinFailure(RuntimeError):
    pass


def stop(reason):
    if not re.fullmatch(r"[A-Z0-9_]{3,72}", reason):
        reason = "SAFE_OPERATION_FAILED"
    raise RepinFailure(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def root_dir(path, mode=None):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid or info.st_gid or (
            info.st_mode & 0o022) or (
            mode is not None and stat.S_IMODE(info.st_mode) != mode):
        stop("UNSAFE_ROOT_DIRECTORY")


def root_file(path, expected_sha, mode):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid or info.st_gid or (
            stat.S_IMODE(info.st_mode) != mode or info.st_nlink != 1):
        stop("UNSAFE_ROOT_FILE")
    raw = path.read_bytes()
    if sha(raw) != expected_sha:
        stop("IMMUTABLE_ROOT_BUNDLE_HASH_MISMATCH")
    return raw


def verify_bundle(version):
    expected = OLD if version == "old" else NEW
    root_dir(ROOT)
    root_dir(ASSETS, 0o700)
    if {p.name for p in ASSETS.iterdir()} != ASSET_NAMES:
        stop("UNREVIEWED_ROOT_ASSET")
    for name in ASSET_NAMES:
        root_file(ASSETS / name, expected[name], 0o600)
    root_file(WRAPPER, expected["one-muse-narrow-root.py"], 0o755)
    root_file(RULE, expected["one-muse-narrow-sudoers"], 0o440)
    check_policy(RULE)


def checked_process(argv, seconds=8):
    completed = subprocess.run(
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False, timeout=seconds, env=ROOT_ENV)
    if completed.returncode or len(completed.stdout) > 16384 or (
            len(completed.stderr) > 4096):
        stop("ROOT_POST_INSTALL_PROCESS_FAILED")
    return completed.stdout


def check_policy(path):
    checked_process(["/usr/bin/visudo", "-c", "-f", str(path)], 6)


def check_user_sudo():
    output = checked_process(
        ["/usr/bin/runuser", "-u", "hylab", "--",
         "/usr/bin/sudo", "-n", str(WRAPPER), "--self-check"], 9)
    if output != b"CLACK_NARROW_SUDO_SELF_CHECK=PASS\n":
        stop("NARROW_SUDO_NO_TRAFFIC_SELF_CHECK_FAILED")


def check_private_tool(source_path):
    # This checks exact root-owned path, digest, provenance and version ONLY.
    # The imported reviewed module does not start a tracer; the function's
    # sole child invocation is the private bpftool '-j version'.
    for parent in (Path("/"), Path("/opt"), Path("/opt/clack"),
                   Path("/opt/clack/diagnostic-tools")):
        root_dir(parent)
    root_file(PIN_BINARY, PRIVATE_SHA, 0o755)
    root_file(PIN_MANIFEST, PRIVATE_PIN_SHA, 0o644)
    notes = checked_process(["/usr/bin/readelf", "-n", str(PIN_BINARY)])
    matches = re.findall(rb"Build ID: ([a-f0-9]{40})", notes)
    if matches != [PRIVATE_BUILD_ID.encode("ascii")]:
        stop("PRIVATE_BPFTOOL_QUALIFICATION_FAILED")
    spec = importlib.util.spec_from_file_location(
        "clack_private_bpftool_prod_identity", source_path)
    if spec is None or spec.loader is None:
        stop("PRIVATE_BPFTOOL_QUALIFICATION_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path, details = module.qualified_diagnostic_bpftool()
    if (path != PIN_BINARY or details.get("binaryPath") != str(PIN_BINARY)
            or details.get("binarySha256") != PRIVATE_SHA
            or details.get("binaryVersion") != "7.8.1"
            or details.get("libbpfVersion") != "1.9"):
        stop("PRIVATE_BPFTOOL_QUALIFICATION_FAILED")


def require_initial_security():
    if os.geteuid() != 0 or os.getuid() != 0:
        stop("ROOT_INSTALLER_REQUIRED")
    for parent in (Path("/"), Path("/usr"), Path("/usr/local"),
                   ROOT, Path("/etc"), Path("/etc/sudoers.d")):
        root_dir(parent)
    account = pwd.getpwnam("hylab")
    if account.pw_uid != 1000 or account.pw_gid != 1000:
        stop("UNEXPECTED_OPERATOR_IDENTITY")
    if not Path("/usr/bin/sudo").is_file() or not Path("/usr/bin/runuser").is_file():
        stop("POST_INSTALL_VERIFIER_MISSING")


def read_stage(stage):
    if not STAGE_RE.fullmatch(str(stage)):
        stop("UNREVIEWED_STAGE_PATH")
    for parent in (Path("/home"), Path("/home/hylab"),
                   Path("/home/hylab/.cache")):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or (
                info.st_mode & 0o022 and info.st_uid != 1000):
            stop("UNSAFE_STAGE_PARENT")
    info = stage.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 1000 or (
            stat.S_IMODE(info.st_mode) != 0o700):
        stop("UNSAFE_USER_STAGE")
    fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if set(os.listdir(fd)) != STAGED_NAMES:
            stop("UNREVIEWED_STAGE_ENTRY")
        expected = dict(NEW)
        expected["manifest.json"] = MANIFEST_SHA
        # The already-running root loader independently verifies installer.py
        # from a single O_NOFOLLOW fd before executing it.
        expected.pop("local-muse-tcp-session.py")
        expected.pop("local-muse-tcp.bt")
        payload = {}
        for name in STAGED_NAMES - {"installer.py"}:
            handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                st = os.fstat(handle)
                if not stat.S_ISREG(st.st_mode) or st.st_uid != 1000 or (
                        stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1
                        or st.st_size > 200000):
                    stop("UNSAFE_STAGE_FILE")
                chunks = bytearray()
                while True:
                    part = os.read(handle, 65536)
                    if not part:
                        break
                    chunks.extend(part)
                    if len(chunks) > 200000:
                        stop("STAGE_FILE_TOO_LARGE")
                blob = bytes(chunks)
                if sha(blob) != expected[name]:
                    stop("STAGED_ASSET_HASH_MISMATCH")
                payload[name] = blob
            finally:
                os.close(handle)
        manifest = json.loads(payload["manifest.json"])
        if (manifest.get("version") != VERSION
                or manifest.get("newSha256") != {
                    k: NEW[k] for k in ("local-muse-one-root.sh",
                        "local-muse-one-ebpf.py", "one-muse-narrow-root.py",
                        "one-muse-narrow-sudoers")}
                or manifest.get("acceptedPrivateBpftool", {}).get("sha256")
                    != PRIVATE_SHA):
            stop("VERSIONED_MANIFEST_MISMATCH")
        return payload
    finally:
        os.close(fd)


def durable_write(path, data, mode):
    handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     os.O_NOFOLLOW, mode)
    try:
        os.fchmod(handle, mode)
        cursor = memoryview(data)
        while cursor:
            count = os.write(handle, cursor)
            if count <= 0:
                stop("ROOT_STAGED_WRITE_FAILED")
            cursor = cursor[count:]
        os.fsync(handle)
    finally:
        os.close(handle)


def sync_directory(path):
    handle = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


class FailClosedSwitch:
    """Fixed role paths only; injections are test-only import hooks, never argv."""

    def __init__(self, wrapper, assets, rule, root_stage, rule_candidate):
        self.wrapper = wrapper
        self.assets = assets
        self.rule = rule
        self.work = root_stage
        self.rule_candidate = rule_candidate
        self.swapped_rule = False
        self.moved_old_assets = False
        self.moved_new_assets = False
        self.swapped_wrapper = False

    def activate(self, after_step=None):
        def step(label):
            if after_step is not None:
                after_step(label)

        try:
            # New sudoers digest FIRST: existing executable now fails closed.
            os.replace(self.rule_candidate, self.rule)
            self.swapped_rule = True
            sync_directory(self.rule.parent)
            step("new_pinned_policy")
            os.replace(self.assets, self.work / "old_assets")
            self.moved_old_assets = True
            sync_directory(self.assets.parent)
            step("old_assets_withheld")
            os.replace(self.work / "new_assets", self.assets)
            self.moved_new_assets = True
            sync_directory(self.assets.parent)
            step("new_assets_installed")
            os.replace(self.work / "new_wrapper", self.wrapper)
            self.swapped_wrapper = True
            sync_directory(self.wrapper.parent)
            step("new_wrapper_installed")
        except BaseException:
            self.rollback()
            raise

    def rollback(self):
        # New rule remains pinned while the old wrapper/assets are restored.
        if self.swapped_wrapper:
            os.replace(self.work / "old_wrapper", self.wrapper)
            self.swapped_wrapper = False
            sync_directory(self.wrapper.parent)
        if self.moved_new_assets:
            os.replace(self.assets, self.work / "rejected_assets")
            self.moved_new_assets = False
            sync_directory(self.assets.parent)
        if self.moved_old_assets:
            os.replace(self.work / "old_assets", self.assets)
            self.moved_old_assets = False
            sync_directory(self.assets.parent)
        if self.swapped_rule:
            # Only AFTER old executable and assets are back in place.
            os.replace(self.work / "old_rule", self.rule)
            self.swapped_rule = False
            sync_directory(self.rule.parent)


def install(stage):
    require_initial_security()
    verify_bundle("old")
    check_user_sudo()
    payload = read_stage(stage)
    work = ROOT / (".clack-one-muse-repin-" + VERSION)
    candidate = RULE.parent / (".90-clack-one-muse-root-" + VERSION)
    if work.exists() or work.is_symlink() or (
            candidate.exists() or candidate.is_symlink()):
        stop("EXISTING_REPIN_CANDIDATE_REFUSED")
    work.mkdir(mode=0o700)
    tx = FailClosedSwitch(WRAPPER, ASSETS, RULE, work, candidate)
    committed = False
    try:
        durable_write(work / "old_wrapper",
                      root_file(WRAPPER, OLD["one-muse-narrow-root.py"], 0o755),
                      0o755)
        durable_write(work / "old_rule",
                      root_file(RULE, OLD["one-muse-narrow-sudoers"], 0o440),
                      0o440)
        durable_write(work / "new_wrapper",
                      payload["one-muse-narrow-root.py"], 0o755)
        root_file(work / "new_wrapper", NEW["one-muse-narrow-root.py"], 0o755)
        new_assets = work / "new_assets"
        new_assets.mkdir(mode=0o700)
        for name in sorted(ASSET_NAMES):
            data = (payload[name] if name in payload else
                    root_file(ASSETS / name, OLD[name], 0o600))
            durable_write(new_assets / name, data, 0o600)
            root_file(new_assets / name, NEW[name], 0o600)
        sync_directory(new_assets)
        check_private_tool(new_assets / "local-muse-one-ebpf.py")
        durable_write(candidate, payload["one-muse-narrow-sudoers"], 0o440)
        root_file(candidate, NEW["one-muse-narrow-sudoers"], 0o440)
        check_policy(candidate)
        if work.stat().st_dev != ASSETS.parent.stat().st_dev or (
                candidate.stat().st_dev != RULE.stat().st_dev):
            stop("ATOMIC_SAME_FILESYSTEM_REQUIRED")
        sync_directory(work)
        tx.activate()
        try:
            verify_bundle("new")
            check_private_tool(ASSETS / "local-muse-one-ebpf.py")
            check_user_sudo()
        except BaseException:
            tx.rollback()
            verify_bundle("old")
            check_user_sudo()
            print("ROOT_REPIN_ROLLBACK=PASS", flush=True)
            raise
        print("ROOT_REPIN_VERSION=" + VERSION, flush=True)
        print("PRODUCTION_PRIVATE_BPFTOOL=PASS", flush=True)
        print("ROOT_REPIN_INSTALL=PASS", flush=True)
        committed = True
    except BaseException:
        # Before activation the old state remains untouched; after any
        # partial activation the transaction rolled back before re-raising.
        raise
    finally:
        if not committed and not (tx.swapped_rule or tx.swapped_wrapper or
                                  tx.moved_old_assets or tx.moved_new_assets):
            # Task-owned paths only. Never remove another administrator's
            # unrecognized entries or follow symlinks, including when the
            # authenticated operation was interrupted before activation.
            if candidate.is_file() and not candidate.is_symlink():
                if candidate.stat().st_uid == 0:
                    candidate.unlink()
            if work.is_dir() and not work.is_symlink() and (
                    work.stat().st_uid == 0):
                names = {p.name for p in work.iterdir()}
                if names.issubset({
                    "old_wrapper", "old_rule", "new_wrapper", "new_assets",
                    "old_assets", "rejected_assets"}):
                    for dirname in ("new_assets", "rejected_assets"):
                        folder = work / dirname
                        if folder.is_dir() and not folder.is_symlink() and (
                                folder.stat().st_uid == 0) and {
                                    p.name for p in folder.iterdir()
                                }.issubset(ASSET_NAMES):
                            for file in folder.iterdir():
                                if file.is_file() and not file.is_symlink():
                                    file.unlink()
                            folder.rmdir()
                    for filename in ("old_wrapper", "old_rule", "new_wrapper"):
                        entry = work / filename
                        if entry.is_file() and not entry.is_symlink():
                            entry.unlink()
                    if not list(work.iterdir()):
                        work.rmdir()


def main():
    if len(sys.argv) != 2:
        stop("ONE_FIXED_STAGING_ARGUMENT_REQUIRED")
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(ROOT_ENV)
    os.chdir("/")
    def interrupt(_signum, _frame):
        stop("INTERRUPTED_ATOMIC_DEPLOYMENT")
    signal.signal(signal.SIGINT, interrupt)
    signal.signal(signal.SIGTERM, interrupt)
    install(Path(sys.argv[1]))


if __name__ == "__main__":
    try:
        main()
    except RepinFailure as e:
        print("ROOT_REPIN_FAILED=" + str(e), file=sys.stderr, flush=True)
        sys.exit(72)
    except BaseException:
        print("ROOT_REPIN_FAILED=SAFE_OPERATION_FAILED", file=sys.stderr,
              flush=True)
        sys.exit(72)
