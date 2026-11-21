#!/usr/bin/env python3
"""Offline root repin tests. Never sudo, attach BPF, infer or modify the lab."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    instance = importlib.util.module_from_spec(spec)
    if os.name == "nt":
        # Root deployment is Linux-only; offline tests exercise pure parsing,
        # immutable pins and atomic rename rollback without privileged calls.
        with patch.dict(sys.modules, {"pwd": SimpleNamespace()}):
            spec.loader.exec_module(instance)
    else:
        spec.loader.exec_module(instance)
    return instance


installer = load("offline_private_bpftool_repin_installer", HERE / "installer.py")
collector = load("offline_private_bpftool_production_collector",
                 HERE / "local-muse-one-ebpf.py")


class IdentityTests(unittest.TestCase):
    def config(self):
        c = collector
        return {
            "schemaVersion": 2,
            "binaryPath": str(c.FIXED_DIAGNOSTIC_BPFT_PATH),
            "binarySha256": c.FIXED_DIAGNOSTIC_BPFT_SHA256,
            "version": "7.8.1", "libbpfVersion": "1.9",
            "sourceCommit": c.FIXED_DIAGNOSTIC_SOURCE_COMMIT,
            "libbpfCommit": c.FIXED_DIAGNOSTIC_LIBBPF_COMMIT,
            "linkBlob": c.FIXED_DIAGNOSTIC_LINK_BLOB,
            "sourceArchiveSha256": c.FIXED_DIAGNOSTIC_SOURCE_ARCHIVE_SHA256,
            "libbpfArchiveSha256": c.FIXED_DIAGNOSTIC_LIBBPF_ARCHIVE_SHA256,
            "patchSha256": c.FIXED_DIAGNOSTIC_PATCH_SHA256,
            "patchedLinkBlob": c.FIXED_DIAGNOSTIC_PATCHED_LINK_BLOB,
            "patchedLinkSha256": c.FIXED_DIAGNOSTIC_PATCHED_LINK_SHA256,
            "binaryBuildId": c.FIXED_DIAGNOSTIC_BPFT_BUILD_ID,
        }

    def qualified(self, change=None, missing=False):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            pin = root / "pinned.json"
            binary = root / "private"
            config = self.config()
            if change is not None:
                config.update(change)
            pin.write_text(json.dumps(config), encoding="ascii")
            binary.write_bytes(b"correct pinned tool, supplied by test only")
            binary.chmod(0o755)
            seen = []

            def pinned(path, expected=None):
                if path == collector.FIXED_DIAGNOSTIC_BPFT_PIN:
                    return pin
                self.assertEqual(path, collector.FIXED_DIAGNOSTIC_BPFT_PATH)
                self.assertEqual(expected, collector.FIXED_DIAGNOSTIC_BPFT_SHA256)
                if missing:
                    raise FileNotFoundError("missing")
                if change and change.get("wrongBinary"):
                    raise ValueError("SHA-256 mismatch")
                return binary

            def version(argv, **kwargs):
                seen.append(argv)
                self.assertEqual(argv, [str(binary), "-j", "version"])
                return SimpleNamespace(
                    returncode=0, stderr=b"",
                    stdout=json.dumps({"version": "7.8.1",
                                       "libbpf_version": "1.9",
                                       "features": {"skeletons": True}}).encode())
            original_stat = Path.stat
            def posix_executable_stat(path, *args, **kwargs):
                actual = original_stat(path, *args, **kwargs)
                if path == binary and os.name == "nt":
                    # Win32 chmod does not encode the Unix owner's X bit.
                    return SimpleNamespace(st_mode=actual.st_mode | stat.S_IXUSR)
                return actual
            with patch.object(collector, "pinned_diagnostic_file", side_effect=pinned), \
                 patch.object(collector.subprocess, "run", side_effect=version), \
                 patch.object(Path, "stat", posix_executable_stat):
                if missing:
                    with self.assertRaises(FileNotFoundError):
                        collector.qualified_diagnostic_bpftool()
                elif change:
                    with self.assertRaises(ValueError):
                        collector.qualified_diagnostic_bpftool()
                else:
                    tool, identity = collector.qualified_diagnostic_bpftool()
                    self.assertEqual(tool, binary)
                    self.assertEqual(identity["binarySha256"],
                                     installer.PRIVATE_SHA)
                    self.assertEqual(identity["binaryVersion"], "7.8.1")
                if missing or change and not change.get("wrongBinary"):
                    # Refuse before ever spawning an alternate executable.
                    self.assertEqual(seen, [])
                elif not change:
                    self.assertEqual(len(seen), 1)

    def test_correct_exact_private_pin_accepted(self):
        self.qualified()

    def test_wrong_private_sha_rejected_without_fallback(self):
        self.qualified({"wrongBinary": True})

    def test_missing_private_tool_rejected_without_fallback(self):
        self.qualified(missing=True)

    def test_wrong_build_id_rejected_without_fallback(self):
        self.qualified({"binaryBuildId": "0" * 40})

    def test_wrong_provenance_rejected_without_fallback(self):
        self.qualified({"sourceCommit": "0" * 40})

    def test_system_tool_is_not_authorized_for_production(self):
        shell = (HERE / "local-muse-one-root.sh").read_text()
        source = (HERE / "local-muse-one-ebpf.py").read_text()
        self.assertIn("fixed_bpftool_mode=fixed", shell)
        self.assertNotIn("fixed_bpftool_mode=normal", shell)
        self.assertIn("if args.seconds == MAX_SECONDS and not args.fixed_diagnostic_bpftool:", source)
        self.assertIn('parser.error("PRIVATE_BPFTOOL_QUALIFICATION_FAILED")', source)
        self.assertIn("bpftool, bpftool_identity = qualified_diagnostic_bpftool()", source)
        self.assertIn("KERNEL_AUDIT_PRIVATE_BPFTOOL_QUALIFICATION_FAILED=1", source)
        self.assertIn("args.seconds <= 20 else None)", source)
        self.assertIn("args.seconds <= 20 and", source)
        self.assertNotIn("PINNED_TRACER_SHA256 = None", source)


class DeployTests(unittest.TestCase):
    def test_original_standalone_sources_are_byte_identical(self):
        import importlib.util
        build = load("clack_offline_repin_builder",
                     SCRIPTS / "build-one-muse-private-bpftool-v2.py")
        for filename, digest in build.BEFORE.items():
            self.assertEqual(hashlib.sha256(
                (SCRIPTS / filename).read_bytes()).hexdigest(), digest)
        original = (SCRIPTS / "local-muse-one-root.sh").read_text()
        self.assertIn("fixed_bpftool_mode=normal", original)
        self.assertIn("if ((seconds != 1800)); then", original)
        self.assertEqual(installer.OLD["local-muse-one-ebpf.py"],
                         build.BEFORE["local-muse-one-ebpf.py"])

    def test_root_old_bundle_hash_mismatch_fails_closed(self):
        with TemporaryDirectory() as folder:
            src = Path(folder) / "asset"
            src.write_bytes(b"unexpected")
            fake = SimpleNamespace(
                st_mode=stat.S_IFREG | 0o600, st_uid=0, st_gid=0,
                st_nlink=1)
            with patch.object(Path, "lstat", return_value=fake):
                with self.assertRaisesRegex(
                        installer.RepinFailure,
                        "IMMUTABLE_ROOT_BUNDLE_HASH_MISMATCH"):
                    installer.root_file(src, "0" * 64, 0o600)

    def test_v2_manifest_and_both_sudoers_digests_are_pinned(self):
        bundle = json.loads((HERE / "manifest.json").read_text())
        self.assertEqual(bundle["acceptedPrivateBpftool"]["sha256"],
                         installer.PRIVATE_SHA)
        self.assertEqual(bundle["acceptedPrivateBpftool"]["buildId"],
                         installer.PRIVATE_BUILD_ID)
        self.assertEqual(hashlib.sha256(
            (HERE / "manifest.json").read_bytes()).hexdigest(),
            installer.MANIFEST_SHA)
        new_wrapper_sha = hashlib.sha256(
            (HERE / "one-muse-narrow-root.py").read_bytes()).hexdigest()
        self.assertEqual(new_wrapper_sha, installer.NEW["one-muse-narrow-root.py"])
        policy = (HERE / "one-muse-narrow-sudoers").read_text()
        self.assertEqual(policy.count("sha256:" + new_wrapper_sha), 2)
        self.assertNotIn("sha256:" + installer.OLD["one-muse-narrow-root.py"], policy)
        self.assertNotIn("NOPASSWD: ALL", policy)
        self.assertIn("NOSETENV:", policy)
        self.assertIn(" ^--run muse-one-[a-f0-9]{24} [1-9][0-9]*$", policy)
        self.assertNotIn("installer", policy)
        self.assertNotIn(" /usr/bin/bash ", policy)

    def fixture(self, folder):
        root = Path(folder)
        (root / "live-assets").mkdir()
        (root / "work").mkdir()
        (root / "work" / "new_assets").mkdir()
        (root / "live-wrapper").write_bytes(b"old-wrapper")
        (root / "live-rule").write_bytes(b"old-rule")
        (root / "live-assets" / "data").write_bytes(b"old-data")
        (root / "work" / "old_wrapper").write_bytes(b"old-wrapper")
        (root / "work" / "old_rule").write_bytes(b"old-rule")
        (root / "work" / "new_wrapper").write_bytes(b"new-wrapper")
        (root / "work" / "new_assets" / "data").write_bytes(b"new-data")
        (root / "rule_candidate").write_bytes(b"new-rule")
        return root, installer.FailClosedSwitch(
            root / "live-wrapper", root / "live-assets", root / "live-rule",
            root / "work", root / "rule_candidate")

    @patch.object(installer, "sync_directory")
    def test_atomic_activation_and_repin(self, _):
        with TemporaryDirectory() as folder:
            root, tx = self.fixture(folder)
            tx.activate()
            self.assertEqual((root / "live-rule").read_bytes(), b"new-rule")
            self.assertEqual((root / "live-wrapper").read_bytes(), b"new-wrapper")
            self.assertEqual((root / "live-assets" / "data").read_bytes(),
                             b"new-data")
            tx.rollback()
            self.assertEqual((root / "live-wrapper").read_bytes(), b"old-wrapper")
            self.assertEqual((root / "live-assets" / "data").read_bytes(),
                             b"old-data")
            self.assertEqual((root / "live-rule").read_bytes(), b"old-rule")

    @patch.object(installer, "sync_directory")
    def test_interrupted_atomic_rollback_all_four_boundaries(self, _):
        for step in ("new_pinned_policy", "old_assets_withheld",
                     "new_assets_installed", "new_wrapper_installed"):
            with self.subTest(step=step), TemporaryDirectory() as folder:
                root, tx = self.fixture(folder)

                def fail_here(stage):
                    if stage == step:
                        raise RuntimeError("injected interruption")

                with self.assertRaisesRegex(RuntimeError, "injected"):
                    tx.activate(after_step=fail_here)
                self.assertEqual((root / "live-rule").read_bytes(), b"old-rule")
                self.assertEqual((root / "live-wrapper").read_bytes(),
                                 b"old-wrapper")
                self.assertEqual((root / "live-assets" / "data").read_bytes(),
                                 b"old-data")
                self.assertFalse(tx.swapped_rule)
                self.assertFalse(tx.swapped_wrapper)

    def test_strict_root_argument_and_immutable_stage_paths(self):
        self.assertTrue(installer.STAGE_RE.fullmatch(
            "/home/hylab/.cache/clack-muse-private-repin.Abcd1234"))
        for bad in ("/tmp/evil", "/home/hylab/.cache/other.Xxxxxxxx",
                    "/home/hylab/.cache/clack-muse-private-repin.aaaaaaaa/evil",
                    "/home/hylab/.cache/clack-muse-private-repin.Abcd1234;id"):
            self.assertIsNone(installer.STAGE_RE.fullmatch(bad))
        text = (HERE / "installer.py").read_text()
        self.assertNotIn("shell=True", text)
        self.assertNotIn("eval(", text)
        self.assertIn("if len(sys.argv) != 2:", text)
        self.assertIn('check_user_sudo()', text)
        self.assertIn('check_private_tool(ASSETS / "local-muse-one-ebpf.py")', text)
        self.assertIn("os.replace(self.rule_candidate, self.rule)", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
