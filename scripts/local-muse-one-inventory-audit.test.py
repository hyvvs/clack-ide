"""Synthetic-only bpftool inventory diagnostics; no SSH, sudo or probe attach."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "one_muse_inventory_collector", HERE / "local-muse-one-ebpf.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class BpftoolAuditTests(unittest.TestCase):
    def capture(self, kind="link", phase="live", response=None,
                error=None, state="running"):
        with tempfile.TemporaryFile(mode="w+b") as output:
            audit = collector.InventoryAudit(output.fileno())
            with patch.object(collector.subprocess, "run",
                              side_effect=error) if error else patch.object(
                                  collector.subprocess, "run",
                                  return_value=response) as process:
                try:
                    if kind == "link":
                        value = collector.link_inventory(
                            "/usr/bin/bpftool", 1, phase, audit, state)
                    else:
                        value = collector.program_inventory(
                            "/usr/bin/bpftool", 1, phase, audit, state)
                    exception = None
                except Exception as exc:
                    value, exception = None, exc
            output.seek(0)
            rows = [json.loads(line) for line in output.read().splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(audit.invocations, 1)
        self.assertGreater(audit.bytes_written, 0)
        return value, exception, rows[0], process

    def test_baseline_and_live_use_identical_exact_bpftool_argv(self):
        baseline = SimpleNamespace(stdout=b"[]", stderr=b"", returncode=0)
        _, err1, first, mock1 = self.capture(phase="baseline", response=baseline,
                                             state="not_started")
        self.assertIsNone(err1)
        live = SimpleNamespace(stdout=b"[]", stderr=b"", returncode=0)
        _, err2, later, mock2 = self.capture(response=live)
        self.assertIsNone(err2)
        expected = ["/usr/bin/bpftool", "-j", "link", "show"]
        self.assertEqual(first["argv"], expected)
        self.assertEqual(later["argv"], expected)
        for mock in (mock1, mock2):
            self.assertEqual(mock.call_args.args[0], expected)
            self.assertEqual(mock.call_args.kwargs["stdin"], subprocess.DEVNULL)
            self.assertEqual(mock.call_args.kwargs["check"], False)
        self.assertEqual(first["tracerStateAtStart"], "not_started")
        self.assertEqual(later["tracerStateAtStart"], "running")
        self.assertEqual(later["tracerStateAtEnd"], "running")
        self.assertLessEqual(later["monotonicStartNs"], later["monotonicEndNs"])
        self.assertEqual(later["stdoutBytes"], 2)
        self.assertEqual(later["stdoutSha256"], hashlib.sha256(b"[]").hexdigest())
        self.assertEqual(later["stderrBytes"], 0)
        self.assertEqual(later["stderrTextStatus"], "empty")
        self.assertTrue(later["jsonAttempted"])
        self.assertEqual(later["jsonResult"], "parsed")
        self.assertEqual(later["result"], "pass")

    def test_each_sequential_baseline_live_and_terminal_invocation_is_retained(self):
        answer = SimpleNamespace(stdout=b"[]", stderr=b"", returncode=0)
        with tempfile.TemporaryFile(mode="w+b") as output, \
                patch.object(collector.subprocess, "run", return_value=answer) as run:
            audit = collector.InventoryAudit(output.fileno())
            for phase, state in (("baseline", "not_started"),
                                 ("live", "running"),
                                 ("terminal", "exited")):
                self.assertEqual(collector.link_inventory(
                    "/usr/bin/bpftool", 1, phase, audit, state), {})
            output.seek(0)
            rows = [json.loads(line) for line in output.read().splitlines()]
        self.assertEqual(run.call_count, 3)
        self.assertEqual(audit.invocations, 3)
        self.assertEqual([row["invocation"] for row in rows], [1, 2, 3])
        self.assertEqual([row["phase"] for row in rows],
                         ["baseline", "live", "terminal"])
        self.assertEqual([row["tracerStateAtStart"] for row in rows],
                         ["not_started", "running", "exited"])
        self.assertEqual([row["argv"] for row in rows],
                         [["/usr/bin/bpftool", "-j", "link", "show"]] * 3)

    def test_nonzero_live_json_error_retains_exact_exit_and_safe_text(self):
        stdout = b'[{"error":"can\'t get next link: Invalid argument"}]'
        stderr = b"Error: can't get next link: Invalid argument\n"
        response = SimpleNamespace(stdout=stdout, stderr=stderr, returncode=255)
        _, exc, row, _ = self.capture(response=response)
        self.assertIsInstance(exc, subprocess.CalledProcessError)
        self.assertEqual(exc.returncode, 255)
        self.assertEqual(row["exitCode"], 255)
        self.assertEqual(row["failureClass"], "CalledProcessError")
        self.assertEqual(row["result"], "exit_nonzero")
        self.assertEqual(row["stdoutToolError"], "can't get next link: Invalid argument")
        self.assertEqual(row["stderrText"], stderr.decode().strip())
        self.assertEqual(row["stderrTextStatus"], "allowlisted")
        self.assertEqual(row["stdoutSha256"], hashlib.sha256(stdout).hexdigest())
        self.assertEqual(row["stderrSha256"], hashlib.sha256(stderr).hexdigest())
        self.assertEqual(row["jsonResult"], "parsed")
        self.assertFalse(row["timedOut"])

    def test_unprivileged_permission_error_is_distinct_from_root_run(self):
        response = SimpleNamespace(
            stdout=b'[{"error":"can\'t get next link: Operation not permitted"}]',
            stderr=b"", returncode=255)
        _, exc, row, _ = self.capture(response=response)
        self.assertIsInstance(exc, subprocess.CalledProcessError)
        self.assertEqual(row["stdoutToolError"],
                         "can't get next link: Operation not permitted")
        self.assertEqual(row["stderrTextStatus"], "empty")

    def test_unsupported_link_type_and_disappearing_object_are_not_guessed(self):
        for diagnostic in ("can't get next link: Invalid argument",
                           "can't get next link: No such file or directory",
                           "can't get next link: Operation not supported"):
            with self.subTest(diagnostic=diagnostic):
                response = SimpleNamespace(
                    stdout=json.dumps([{"error": diagnostic}]).encode(),
                    stderr=b"", returncode=255)
                _, exc, row, _ = self.capture(response=response)
                self.assertIsInstance(exc, subprocess.CalledProcessError)
                self.assertEqual(row["stdoutToolError"], diagnostic)
                self.assertEqual(row["result"], "exit_nonzero")

    def test_unsupported_command_syntax_and_json_mode_are_categorized(self):
        response = SimpleNamespace(
            stdout=b"", stderr=b"Usage: bpftool link show\n", returncode=255)
        _, exc, row, _ = self.capture(response=response)
        self.assertIsInstance(exc, subprocess.CalledProcessError)
        self.assertEqual(row["stderrText"], "Usage: bpftool link show")
        self.assertFalse(row["jsonAttempted"])
        self.assertEqual(row["jsonResult"], "not_attempted")

    def test_partial_malformed_json_stays_fail_closed(self):
        for kind in ("link", "prog"):
            with self.subTest(kind=kind):
                _, exc, row, _ = self.capture(
                    kind=kind, response=SimpleNamespace(
                        stdout=b'[{"id":1,', stderr=b"", returncode=0))
                self.assertIsInstance(exc, ValueError)
                self.assertEqual(row["result"], "json_failure")
                self.assertEqual(row["jsonResult"], "decode_error")
                self.assertTrue(row["jsonAttempted"])
                self.assertEqual(row["exitCode"], 0)

    def test_valid_json_with_invalid_link_type_or_schema_is_not_accepted(self):
        for body in (b'{"error":"bad"}',
                     b'[{"id":3,"type":"kprobe_multi"}]',
                     b'[{"id":1,"type":"kprobe_multi","prog_id":9},'
                     b'{"id":1,"type":"kprobe_multi","prog_id":10}]'):
            with self.subTest(body=body):
                _, exc, row, _ = self.capture(
                    response=SimpleNamespace(stdout=body, stderr=b"", returncode=0))
                self.assertIsInstance(exc, ValueError)
                self.assertEqual(row["result"], "schema_failure")
                self.assertEqual(row["jsonResult"], "schema_failure")

    def test_timeout_records_partial_stream_hashes_without_parsing(self):
        partial = b'[{ "link":'
        error = subprocess.TimeoutExpired(
            ["/usr/bin/bpftool", "-j", "link", "show"], 1,
            output=partial, stderr=b"Error: timed out")
        _, exc, row, _ = self.capture(error=error)
        self.assertIsInstance(exc, subprocess.TimeoutExpired)
        self.assertTrue(row["timedOut"])
        self.assertEqual(row["result"], "timeout")
        self.assertEqual(row["stdoutBytes"], len(partial))
        self.assertEqual(row["stdoutSha256"], hashlib.sha256(partial).hexdigest())
        self.assertFalse(row["jsonAttempted"])
        self.assertEqual(row["jsonResult"], "not_attempted")
        self.assertIsNone(row["exitCode"])

    def test_spawn_permissions_and_missing_binary_are_distinct(self):
        for exc_type in (FileNotFoundError, PermissionError):
            with self.subTest(exc_type=exc_type):
                _, exc, row, _ = self.capture(error=exc_type("private path"))
                self.assertIsInstance(exc, exc_type)
                self.assertEqual(row["result"], "spawn_error")
                self.assertEqual(row["failureClass"], exc_type.__name__)
                self.assertIsNone(row["exitCode"])
                self.assertNotIn("private path", json.dumps(row))

    def test_bounded_output_overflow_is_not_parsed(self):
        for kind, stdout, stderr in (
                ("stdout", b"[]" * 10, b""),
                ("stderr", b"[]", b"Error: " + b"x" * 60)):
            with self.subTest(kind=kind), \
                    patch.object(collector, "MAX_PROGRAM_LIST", 15), \
                    patch.object(collector, "MAX_STDERR", 20):
                _, exc, row, _ = self.capture(response=SimpleNamespace(
                    stdout=stdout, stderr=stderr, returncode=0))
                self.assertIsInstance(exc, ValueError)
                self.assertEqual(row["result"], "output_overflow")
                self.assertFalse(row["jsonAttempted"])
                self.assertEqual(row["stdoutBytes"], len(stdout))
                self.assertEqual(row["stderrBytes"], len(stderr))

    def test_tracer_exiting_during_live_inventory_is_visible(self):
        states = iter(("running", "exited"))
        _, exc, row, _ = self.capture(
            state=lambda: next(states),
            response=SimpleNamespace(stdout=b"[]", stderr=b"", returncode=0))
        self.assertIsNone(exc)
        self.assertEqual(row["tracerStateAtStart"], "running")
        self.assertEqual(row["tracerStateAtEnd"], "exited")

    def test_redaction_suppresses_sensitive_paths_and_raw_kernel_content(self):
        secret = b"Error: /home/hylab/.ssh/password-123 0xfeedcafe\n"
        response = SimpleNamespace(
            stdout=b'[{"error":"secret token 0xdeadbeef"}]',
            stderr=secret, returncode=255)
        _, exc, row, _ = self.capture(response=response)
        self.assertIsInstance(exc, subprocess.CalledProcessError)
        self.assertIsNone(row["stderrText"])
        self.assertIsNone(row["stdoutToolError"])
        self.assertEqual(row["stderrTextStatus"], "redacted")
        rendered = json.dumps(row)
        for private in ("/home/hylab", "password-123", "0xfeedcafe",
                        "0xdeadbeef"):
            self.assertNotIn(private, rendered)
        self.assertEqual(row["stderrSha256"], hashlib.sha256(secret).hexdigest())
        for private in (b"Error: bearer token ABCD1234",
                        b"Error: socket inode 12345",
                        b"Error: private credential",
                        b"Error: 0xdeadbeef"):
            with self.subTest(private=private):
                self.assertIsNone(collector.safe_bpft_diagnostic(private))

    def test_audit_capacity_fails_closed_without_truncating_a_record(self):
        with tempfile.TemporaryFile(mode="w+b") as output, \
                patch.object(collector, "MAX_INVENTORY_AUDIT", 15):
            audit = collector.InventoryAudit(output.fileno())
            with self.assertRaises(ValueError):
                audit.record({"phase": "baseline", "kind": "prog"})
            output.seek(0)
            self.assertEqual(output.read(), b"")

    def test_rejects_unreviewed_program_link_argv_and_phase(self):
        with patch.object(collector.subprocess, "run") as process:
            for kind, phase in (("perf", "live"), ("link", "other"),
                                ("exec", "baseline")):
                with self.subTest(kind=kind, phase=phase):
                    with self.assertRaises(ValueError):
                        collector.inventory_snapshot(
                            "/usr/bin/bpftool", kind, 1, lambda _: None, phase)
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
