"""Offline-only qualification tests: never load a kernel probe or run SSH."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "muse_bpftool_qualifier", HERE / "local-muse-one-ebpf.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

FIXED_BINARY = collector.FIXED_DIAGNOSTIC_BPFT_PATH
PIN = collector.FIXED_DIAGNOSTIC_BPFT_PIN
HASH = hashlib.sha256(b"verified-private-bpftool-fixture").hexdigest()


def manifest(**override):
    row = {
        "schemaVersion": 1,
        "binaryPath": str(FIXED_BINARY),
        "binarySha256": HASH,
        "version": "7.8.1",
        "libbpfVersion": "1.9",
        "sourceCommit": collector.FIXED_DIAGNOSTIC_SOURCE_COMMIT,
        "libbpfCommit": collector.FIXED_DIAGNOSTIC_LIBBPF_COMMIT,
        "linkBlob": collector.FIXED_DIAGNOSTIC_LINK_BLOB,
        "sourceArchiveSha256": collector.FIXED_DIAGNOSTIC_SOURCE_ARCHIVE_SHA256,
        "libbpfArchiveSha256": collector.FIXED_DIAGNOSTIC_LIBBPF_ARCHIVE_SHA256,
    }
    row.update(override)
    return json.dumps(row, separators=(",", ":")).encode("ascii")


class FakeBinary:
    def __str__(self):
        return str(FIXED_BINARY)

    def stat(self):
        return SimpleNamespace(st_mode=stat.S_IFREG | 0o755)


class PinnedBpftoolTests(unittest.TestCase):
    def qualify(self, raw_manifest=None, version_json=None,
                version_exit=0, version_stderr=b"", hash_ok=True):
        if raw_manifest is None:
            raw_manifest = manifest()
        if version_json is None:
            version_json = {
                "version": "7.8.1", "libbpf_version": "1.9",
                "features": {"skeletons": True, "llvm": True},
            }
        if not isinstance(version_json, bytes):
            version_json = json.dumps(version_json).encode("ascii")
        def trusted_file(path, digest=None):
            self.assertIn(Path(path), (PIN, FIXED_BINARY))
            if Path(path) == PIN:
                self.assertIsNone(digest)
                return SimpleNamespace(read_bytes=lambda: raw_manifest)
            if not hash_ok or digest != HASH:
                raise ValueError("Incorrect binary SHA-256")
            return FakeBinary()
        response = SimpleNamespace(
            returncode=version_exit, stdout=version_json,
            stderr=version_stderr)
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=trusted_file) as verified, \
             patch.object(collector.subprocess, "run",
                          return_value=response) as run:
            try:
                result = collector.qualified_diagnostic_bpftool()
                failure = None
            except Exception as error:
                result, failure = None, error
            return result, failure, run, verified

    def test_approved_sha_pinned_fixed_binary_accepted(self):
        result, error, run, verified = self.qualify()
        self.assertIsNone(error)
        binary, evidence = result
        self.assertEqual(str(binary), str(FIXED_BINARY))
        self.assertEqual(evidence["binarySha256"], HASH)
        self.assertEqual(evidence["binaryVersion"], "7.8.1")
        self.assertEqual(evidence["libbpfVersion"], "1.9")
        self.assertEqual(evidence["sourceCommit"],
                         collector.FIXED_DIAGNOSTIC_SOURCE_COMMIT)
        self.assertEqual(verified.call_count, 3)
        self.assertEqual(run.call_args.args[0],
                         [str(FIXED_BINARY), "-j", "version"])
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs["check"], False)
        self.assertEqual(run.call_args.kwargs["timeout"], 2.0)

    def test_wrong_hash_rejected_before_binary_execution(self):
        result, error, run, verified = self.qualify(hash_ok=False)
        self.assertIsNone(result)
        self.assertIsInstance(error, ValueError)
        run.assert_not_called()
        self.assertEqual(verified.call_count, 2)

    def test_vulnerable_system_binary_and_unreviewed_path_rejected(self):
        for path in (Path("/usr/bin/bpftool"), Path("/tmp/unsafe-bpftool")):
            with self.subTest(path=path), \
                    patch.object(collector, "pinned_diagnostic_file") as verified, \
                    patch.object(collector.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    collector.qualified_diagnostic_bpftool(binary_path=path)
                verified.assert_not_called()
                run.assert_not_called()

    def test_missing_manifest_binary_and_unapproved_owner_fail_closed(self):
        for failure in (FileNotFoundError, PermissionError, ValueError):
            with self.subTest(failure=failure), \
                    patch.object(collector, "pinned_diagnostic_file",
                                 side_effect=failure("unavailable")), \
                    patch.object(collector.subprocess, "run") as run:
                with self.assertRaises(failure):
                    collector.qualified_diagnostic_bpftool()
                run.assert_not_called()

        def missing_binary(path, digest=None):
            if Path(path) == PIN:
                return SimpleNamespace(read_bytes=manifest)
            raise FileNotFoundError("Fixed binary not installed")
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=missing_binary), \
             patch.object(collector.subprocess, "run") as run:
            with self.assertRaises(FileNotFoundError):
                collector.qualified_diagnostic_bpftool()
            run.assert_not_called()

    def test_nonexecutable_pin_rejected_before_version(self):
        class NonExecutable(FakeBinary):
            def stat(self):
                return SimpleNamespace(st_mode=stat.S_IFREG | 0o644)
        def verifier(path, digest=None):
            return (SimpleNamespace(read_bytes=manifest)
                    if Path(path) == PIN else NonExecutable())
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=verifier), \
             patch.object(collector.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                collector.qualified_diagnostic_bpftool()
            run.assert_not_called()

    def test_wrong_source_commit_link_blob_archive_or_version_rejected(self):
        invalid = (
            {"sourceCommit": "0" * 40},
            {"libbpfCommit": "0" * 40},
            {"linkBlob": "0" * 40},
            {"sourceArchiveSha256": "0" * 64},
            {"libbpfArchiveSha256": "0" * 64},
            {"binaryPath": "/usr/bin/bpftool"},
            {"version": "7.8.0"},
            {"libbpfVersion": "1.8"},
            {"schemaVersion": True},
            {"unexpectedKey": "bad"},
        )
        for fields in invalid:
            with self.subTest(fields=fields):
                result, error, run, _ = self.qualify(
                    raw_manifest=manifest(**fields))
                self.assertIsNone(result)
                self.assertIsInstance(error, ValueError)
                run.assert_not_called()

    def test_missing_or_malformed_manifest_rejected(self):
        for raw in (b"", b"x" * 2049, b"{", b"[]", b"null"):
            with self.subTest(size=len(raw)):
                result, error, run, _ = self.qualify(raw_manifest=raw)
                self.assertIsNone(result)
                self.assertIsInstance(error, ValueError)
                run.assert_not_called()

    def test_version_provenance_skeleton_and_schema_mismatch(self):
        candidates = (
            {"version": "7.8.0", "libbpf_version": "1.9",
             "features": {"skeletons": True}},
            {"version": "7.8.1", "libbpf_version": "1.8",
             "features": {"skeletons": True}},
            {"version": "7.8.1", "libbpf_version": "1.9",
             "features": {"skeletons": False}},
            {"version": "7.8.1", "libbpf_version": "1.9"},
            [],
            b"not-json",
            b"[]" * 1100,
        )
        for version in candidates:
            with self.subTest(version=str(version)[:60]):
                result, error, run, _ = self.qualify(version_json=version)
                self.assertIsNone(result)
                self.assertIsInstance(error, ValueError)
                self.assertEqual(run.call_count, 1)

    def test_command_failure_and_timeout_fail_closed(self):
        for kwargs in (
            {"version_exit": -6},
            {"version_exit": 1},
            {"version_stderr": b"anything"},
        ):
            with self.subTest(kwargs=kwargs):
                result, error, _, _ = self.qualify(**kwargs)
                self.assertIsNone(result)
                self.assertIsInstance(error, ValueError)
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=lambda path, digest=None:
                          (SimpleNamespace(read_bytes=manifest)
                           if Path(path) == PIN else FakeBinary())), \
             patch.object(collector.subprocess, "run",
                          side_effect=subprocess.TimeoutExpired(
                              str(FIXED_BINARY), 2)):
            with self.assertRaises(subprocess.TimeoutExpired):
                collector.qualified_diagnostic_bpftool()

    def test_binary_replaced_during_version_check_rejected(self):
        checks = [0]
        def verifier(path, digest=None):
            if Path(path) == PIN:
                return SimpleNamespace(read_bytes=manifest)
            checks[0] += 1
            if checks[0] == 2:
                raise ValueError("Binary digest changed after execution")
            return FakeBinary()
        version = json.dumps({
            "version": "7.8.1", "libbpf_version": "1.9",
            "features": {"skeletons": True},
        }).encode("ascii")
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=verifier), \
             patch.object(collector.subprocess, "run",
                          return_value=SimpleNamespace(
                              returncode=0, stdout=version, stderr=b"")) as run:
            with self.assertRaises(ValueError):
                collector.qualified_diagnostic_bpftool()
            run.assert_called_once()
            self.assertEqual(checks[0], 2)

    def test_symlink_parent_untrusted_ownership_or_executable_denied(self):
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / "bpftool"
            binary.write_bytes(b"fixture")
            check = [
                ("symlink", stat.S_IFLNK | 0o777, 0),
                ("user", stat.S_IFDIR | 0o755, 1000),
                ("group-writable", stat.S_IFDIR | 0o775, 0),
            ]
            for _, mode, uid in check:
                with self.subTest(mode=mode, uid=uid), \
                     patch.object(Path, "lstat", return_value=SimpleNamespace(
                         st_mode=mode, st_uid=uid)):
                    with self.assertRaises(ValueError):
                        collector.pinned_diagnostic_file(binary)
        result, error, run, _ = self.qualify()
        self.assertIsNone(error)
        self.assertIsNotNone(result)
        run.assert_called_once()

    def test_fixed_binary_provenance_in_inventory_not_in_raw_stream(self):
        with tempfile.TemporaryFile(mode="w+b") as output:
            record = collector.InventoryAudit(output.fileno(), {
                "binaryPath": str(FIXED_BINARY),
                "binarySha256": HASH,
                "binaryVersion": "7.8.1",
                "libbpfVersion": "1.9",
            })
            record.record({"kind": "link", "phase": "baseline",
                           "stdoutSha256": hashlib.sha256(b"secret").hexdigest()})
            output.seek(0)
            row = json.loads(output.read())
        self.assertEqual(row["binaryPath"], str(FIXED_BINARY))
        self.assertEqual(row["binarySha256"], HASH)
        self.assertEqual(row["binaryVersion"], "7.8.1")
        self.assertNotIn("secret", json.dumps(row))


if __name__ == "__main__":
    unittest.main()
