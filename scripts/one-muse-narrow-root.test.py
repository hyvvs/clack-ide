#!/usr/bin/env python3
"""Unprivileged tests for the no-password, exact-command root launcher."""
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("one-muse-narrow-root.py")
spec = importlib.util.spec_from_file_location("one_muse_narrow_root", SCRIPT)
module = importlib.util.module_from_spec(spec)
if os.name == "nt":
    with patch.dict(sys.modules, {"pwd": SimpleNamespace()}):
        spec.loader.exec_module(module)
else:
    spec.loader.exec_module(module)


class NarrowRootTests(unittest.TestCase):
    def test_no_arbitrary_commands_paths_durations_or_environment(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("shell=True", text)
        self.assertNotIn("eval(", text)
        self.assertNotIn("os.system(", text)
        self.assertNotIn("subprocess.run(sys.argv", text)
        self.assertNotIn("shell -c", text)
        self.assertIn('os.environ.clear()', text)
        self.assertIn('MAX_SECONDS = 1800', text)
        self.assertIn('sys.argv[1:] == ["--self-check"]', text)
        self.assertIn('len(sys.argv) == 4 and sys.argv[1] == "--run"', text)
        self.assertIn('"/usr/bin/bash"', text)
        self.assertEqual(len(module.FILES), 4)
        self.assertTrue(all(len(d) == 64 and
                            all(c in '0123456789abcdef' for c in d)
                            for d in module.FILES.values()))
        for word in ("--seconds", "--exec", "--path", "--shell", "--command"):
            self.assertNotIn('"' + word + '"', text)

    def test_run_id_and_pid_fail_closed(self):
        valid = "muse-one-" + "1" * 24
        self.assertTrue(module.RUN_ID.fullmatch(valid))
        self.assertFalse(module.RUN_ID.fullmatch(valid + "/../../etc"))
        self.assertFalse(module.RUN_ID.fullmatch("muse-one-" + "g" * 24))
        self.assertFalse(module.RUN_ID.fullmatch("muse-one-" + "1" * 23))
        for bad in ("0", "01", "-1", "1658;id", "1/2", "1\n2",
                    "2147483648", "99999999999"):
            with self.subTest(pid=bad):
                with self.assertRaises(SystemExit):
                    module.checked_pid(bad)
        with patch.object(module, "checked_pid") as check:
            with self.assertRaises(SystemExit):
                module.launch("bad", "1658", 1000)
            check.assert_not_called()

    @unittest.skipUnless(hasattr(os, "O_NOFOLLOW"), "Linux-only fd semantics")
    def test_copy_and_hash_with_nofollow_and_exclusive_target(self):
        with TemporaryDirectory() as directory:
            tmp = Path(directory)
            source = tmp / "source"
            dest = tmp / "dest"
            source.write_bytes(b"exact immutable data")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            with patch.object(module, "secure_file"):
                module.install_stage_file(source, dest, digest)
            self.assertEqual(dest.read_bytes(), source.read_bytes())
            with patch.object(module, "secure_file"):
                with self.assertRaises(FileExistsError):
                    module.install_stage_file(source, dest, digest)
            (tmp / "wrong").write_bytes(b"different")
            with self.assertRaises(SystemExit):
                module.install_stage_file(tmp / "wrong", tmp / "dest2", digest)
            (tmp / "symlink").symlink_to(source)
            with self.assertRaises(OSError):
                module.install_stage_file(tmp / "symlink", tmp / "dest3", digest)

    def test_cleanup_only_exact_owned_stage_entries(self):
        with TemporaryDirectory() as directory:
            parent = Path(directory) / "run"
            stage = parent / "muse-one-".replace("-", "-")
            # Real stage variable is statically fixed in production.
            with patch.object(module, "STAGE", parent):
                parent.mkdir()
                stage.mkdir()
                (stage / "local-muse-tcp.bt").write_bytes(b"probe")
                (stage / "kernel-audit.numeric").write_bytes(b"audit")
                module.owned_stage_cleanup(stage)
                self.assertFalse(parent.exists())
                parent.mkdir()
                stage.mkdir()
                (stage / "unrecognized-secret").write_bytes(b"private")
                with self.assertRaises(SystemExit):
                    module.owned_stage_cleanup(stage)
                self.assertTrue((stage / "unrecognized-secret").exists())

    @unittest.skipUnless(hasattr(os.stat_result, "st_uid"), "Unix-only ownership")
    def test_security_checks_require_root_control_of_asset_tree(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "file"
            path.write_bytes(b"asset")
            with self.assertRaises(SystemExit):
                module.secure_file(path, 0o600)
            with self.assertRaises(SystemExit):
                module.secure_dir(Path(directory), private=True)
            self.assertEqual(module.SAFE_ENV, {
                'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent',
                'LANG': 'C', 'LC_ALL': 'C'})


if __name__ == "__main__":
    unittest.main()
