"""Offline-only private binary replacement and idle JSON regression tests.

Root Bash is transformed to a user-owned /tmp fixture with mock idle output.
The newly built bpftool is NEVER executed, and no BPF, SSH, root, HTTP, Muse,
ForgeBoard, GDB, or inference is started.
"""
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).parent
SHELL = HERE / "clack-replace-json-bpftool-root.sh"
IDLE = HERE / "clack-json-idle-qualify.py"
OPERATOR = HERE / "Replace-ClackBpftoolJsonBalance.ps1"
ARTIFACT = ROOT / "src-tauri/target/clack-bpftool-json-balance"
SOURCES = ROOT / "src-tauri/target/clack-bpftool-fixed-build"
NEW_SHA = "0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0"
PATCH_SHA = "3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d"
BUILD_ID = "7f530859f49ede16767f9f4eb8551a6ac85aa25d"
ROOT_SCRIPT_SHA = "PLACEHOLDER"

spec = importlib.util.spec_from_file_location("clack_json_idle_offline", IDLE)
idle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(idle)


class IdleSchemaTests(unittest.TestCase):
    def fake(self, argv, **kwargs):
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(kwargs["timeout"], 3)
        self.assertIn(argv[0], (idle.FIXED, idle.PACKAGED))
        if argv[1:] == ["-j", "version"]:
            rows = {"version": "7.8.1", "libbpf_version": "1.9",
                    "features": {"skeletons": True}}
        elif argv[1:] == ["-j", "prog", "show"]:
            rows = [{"id": 12, "type": "kprobe", "name": "synthetic"}]
        elif argv[1:] == ["-j", "link", "show"]:
            rows = [{"id": 22, "type": "kprobe_multi", "prog_id": 12}]
        else:
            self.fail("Unexpected idle command")
        return SimpleNamespace(stdout=json.dumps(rows).encode("ascii"),
                               stderr=b"", returncode=0)

    def test_valid_idle_comparison_only_approved_operations(self):
        with patch.object(idle.subprocess, "run", side_effect=self.fake) as invoked:
            summary = idle.qualify()
        self.assertEqual(invoked.call_count, 5)
        self.assertIn("CLACK_JSON_IDLE_PROG_COMPARE=PASS", summary)
        self.assertIn("CLACK_JSON_IDLE_LINK_COMPARE=PASS", summary)
        self.assertIn("CLACK_JSON_IDLE_OWNER_SKELETON=PASS", summary)
        self.assertTrue(all("synthetic" not in x for x in summary))

    def test_reject_abort_bad_json_stderr_unbounded_wrong_schema(self):
        original = self.fake
        def broken(argv, **kwargs):
            response = original(argv, **kwargs)
            if argv[0] == idle.FIXED and argv[-2:] == ["link", "show"]:
                response.returncode = -6
            return response
        with patch.object(idle.subprocess, "run", side_effect=broken):
            with self.assertRaises(ValueError):
                idle.qualify()
        for response in (
                SimpleNamespace(returncode=0, stderr=b"private stderr",
                                stdout=b"[]"),
                SimpleNamespace(returncode=0, stderr=b"", stdout=b"not-json"),
                SimpleNamespace(returncode=0, stderr=b"", stdout=b"x" * 4_194_305),
                SimpleNamespace(returncode=0, stderr=b"",
                                stdout=b'[{"id":true,"type":"kprobe"}]'),
        ):
            with self.subTest(response=str(response)[:50]):
                with patch.object(idle.subprocess, "run", return_value=response):
                    with self.assertRaises(ValueError):
                        idle.qualify()

    def test_mismatch_and_missing_owner_skeleton_fail_closed(self):
        def mismatch(argv, **kwargs):
            response = self.fake(argv, **kwargs)
            if argv[0] == idle.PACKAGED and argv[-2:] == ["prog", "show"]:
                response.stdout = b"[]"
            return response
        with patch.object(idle.subprocess, "run", side_effect=mismatch):
            with self.assertRaisesRegex(ValueError, "semantics mismatch"):
                idle.qualify()
        def no_skeleton(argv, **kwargs):
            response = self.fake(argv, **kwargs)
            if argv[-1:] == ["version"]:
                response.stdout = b'{"version":"7.8.1","libbpf_version":"1.9","features":{"skeletons":false}}'
            return response
        with patch.object(idle.subprocess, "run", side_effect=no_skeleton):
            with self.assertRaisesRegex(ValueError, "skeleton mismatch"):
                idle.qualify()


@unittest.skipUnless(os.name == "posix", "Unprivileged Linux fixture only")
class AtomicRootScriptFixture(unittest.TestCase):
    def run_case(self, failure):
        if os.geteuid() == 0:
            self.skipTest("Root is not used for offline fixture")
        with tempfile.TemporaryDirectory(prefix="clack-json-replace-test-") as folder:
            fixture = Path(folder)
            parent = fixture / "dir"
            parent.mkdir(mode=0o700)
            stage = Path(tempfile.mkdtemp(prefix=".clack-json-replace.", dir=parent))
            uid, gid = os.getuid(), os.getgid()
            user, group = pwd.getpwuid(uid).pw_name, grp.getgrgid(gid).gr_name
            old_data = b"old-synthetic-private\n"
            old_hash = hashlib.sha256(old_data).hexdigest()
            old_bin = parent / "bpftool-678d538"
            old_bin.write_bytes(old_data)
            old_bin.chmod(0o755)
            if failure == "old_changed":
                old_bin.write_bytes(b"unapproved-old-installation\n")
            system = fixture / "system-bpftool"
            system.write_bytes(b"system-binary-preserved\n")
            system.chmod(0o755)
            manifest = {
                "schemaVersion": 1,
                "binaryPath": "/opt/clack/diagnostic-tools/bpftool-678d538",
                "binarySha256": "ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d",
                "version": "7.8.1", "libbpfVersion": "1.9",
                "sourceCommit": "678d538a85e6960f84e443695eebb13f66f89981",
                "libbpfCommit": "872299d94e27d2fa9f119667c7e52268698dc760",
                "linkBlob": "5cffa2d283b47327b8611b4d85b1d70821f40964",
                "sourceArchiveSha256": "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362",
                "libbpfArchiveSha256": "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74",
            }
            pin = parent / "bpftool-678d538.pin.json"
            pin.write_text(json.dumps(manifest), encoding="ascii")
            pin.chmod(0o644)
            if failure == "old_pin_changed":
                manifest["sourceCommit"] = "0" * 40
                pin.write_text(json.dumps(manifest), encoding="ascii")
            inputs = {
                "new-bpftool": ARTIFACT / "bpftool-json-balance-linux-x86_64",
                "source.tar": SOURCES / "bpftool-678d538a-source.tar",
                "libbpf.tar": SOURCES / "libbpf-872299d9-source.tar",
                "fix.patch": HERE / "clack-bpftool-json-balance.patch",
                "build-summary.numeric": ARTIFACT / "build-summary.numeric",
            }
            for name, source in inputs.items():
                dest = stage / name
                shutil.copyfile(source, dest)
                dest.chmod(0o755 if name == "new-bpftool" else 0o600)
            if failure == "bad_patch":
                (stage / "fix.patch").write_bytes(b"wrong-patch")
            if failure == "bad_receipt":
                (stage / "build-summary.numeric").write_bytes(b"unreviewed-build")
            idle_source = (
                "print('CLACK_JSON_IDLE_PROG_COMPARE=PASS')\n"
                "print('CLACK_JSON_IDLE_LINK_COMPARE=PASS')\n"
                "print('CLACK_JSON_IDLE_OWNER_SKELETON=PASS')\n"
                "print('CLACK_JSON_IDLE=PASS')\n"
            )
            if failure == "idle":
                idle_source = "raise SystemExit(9)\n"
            (stage / "idle-qualify.py").write_text(idle_source, encoding="ascii")
            (stage / "idle-qualify.py").chmod(0o600)
            script = SHELL.read_text(encoding="utf-8")
            transformations = {
                "[[ $# == 1 && $(/usr/bin/id -u) == 0 ]]":
                    "[[ $# == 1 && $(/usr/bin/id -u) == %d ]]" % uid,
                "parent=/opt/clack/diagnostic-tools": "parent=" + str(parent),
                "old_sha=ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d":
                    "old_sha=" + old_hash,
                "^/opt/clack/diagnostic-tools/\\.clack-json-replace\\.[A-Za-z0-9]{8}$":
                    "^" + re.escape(str(stage)) + "$",
                "0:0:755:1": "%d:%d:755:1" % (uid, gid),
                "0:0:644:1": "%d:%d:644:1" % (uid, gid),
                "0:0:600:1": "%d:%d:600:1" % (uid, gid),
                "0:0:700": "%d:%d:700" % (uid, gid),
                "for dir in /opt /opt/clack \"$parent\"; do":
                    "for dir in \"$parent\"; do",
                "$( /usr/bin/stat -c '%u' -- \"$dir\") == 0".replace("$( ", "$("):
                    f"$(/usr/bin/stat -c '%u' -- \"$dir\") == {uid}",
                "/usr/bin/install -o root -g root": "/usr/bin/install -o %s -g %s" % (user,group),
                "/usr/bin/bpftool": str(system),
                "/run/local-muse-ebpf": str(fixture / "no-active-stage"),
                "if /usr/bin/pgrep -x \"$process\" >/dev/null; then":
                    "if false; then",
            }
            for before, after in transformations.items():
                if before not in script:
                    raise AssertionError("Synthetic transform missing: " + before)
                script = script.replace(before, after)
            stage_script = stage / "synthetic-root.sh"
            stage_script.write_text(script, encoding="utf-8")
            result = subprocess.run(["/usr/bin/bash", str(stage_script), str(stage)],
                                    stdin=subprocess.DEVNULL, capture_output=True,
                                    timeout=12, check=False)
            if failure is None:
                self.assertEqual(result.returncode, 0, result.stderr[-600:])
                self.assertEqual(hashlib.sha256(old_bin.read_bytes()).hexdigest(), NEW_SHA)
                self.assertEqual(json.loads(pin.read_bytes())["schemaVersion"], 2)
                self.assertIn(b"CLACK_JSON_REPLACE=PASS", result.stdout)
            else:
                self.assertNotEqual(result.returncode, 0, (failure, result.stdout[-400:]))
                self.assertEqual(old_bin.read_bytes(),
                                 b"unapproved-old-installation\n" if failure == "old_changed"
                                 else old_data)
                self.assertEqual(json.loads(pin.read_bytes())["schemaVersion"], 1)
                if failure == "idle":
                    self.assertIn(b"CLACK_JSON_REPLACE_ROLLBACK=PASS", result.stderr)
            self.assertEqual(system.read_bytes(), b"system-binary-preserved\n")
            self.assertFalse(stage.exists(), "Synthetic root stage residue")

    def test_atomic_success_bad_provenance_and_idle_rollback(self):
        for failure in (None, "bad_patch", "bad_receipt", "old_changed",
                        "old_pin_changed", "idle"):
            with self.subTest(failure=failure):
                self.run_case(failure)


class StaticProvenance(unittest.TestCase):
    def test_fixed_source_hashes_and_no_live_execution(self):
        binary = ARTIFACT / "bpftool-json-balance-linux-x86_64"
        self.assertEqual(hashlib.sha256(binary.read_bytes()).hexdigest(), NEW_SHA)
        self.assertIn(PATCH_SHA, SHELL.read_text(encoding="utf-8"))
        text = SHELL.read_text(encoding="utf-8")
        for dangerous in ("make install", "/usr/bin/bpftool -j",
                          "/usr/bin/bpftrace -", "/api/chat", "curl "):
            self.assertNotIn(dangerous, text)
        self.assertIn("schemaVersion", text)
        self.assertIn('swapped=1', text)
        self.assertIn('qualified=1', text)
        self.assertLess(text.index("swapped=1\n/usr/bin/mv -T"),
                        text.index('qualified=1\n'))


if __name__ == "__main__":
    unittest.main()
