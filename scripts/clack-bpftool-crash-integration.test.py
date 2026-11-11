"""Offline integration tests: no root, BPF, sudo, SSH, or inference."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "collector_aborted_link", HERE / "local-muse-one-ebpf.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

HASH = collector.FIXED_DIAGNOSTIC_BPFT_SHA256
WRAPPER = collector.FIXED_DIAGNOSTIC_CRASH_WRAPPER_PATH
SOURCE = collector.FIXED_DIAGNOSTIC_BPFT_PATH


def record(**changes):
    data = {
        "schemaVersion": 1, "capture": "PASS",
        "commandClass": "private_fixed_link_show",
        "executableSha256": HASH,
        "buildId": "8faee6f37ed17666af07f7d8f671bf40a9fd38e5",
        "debuggerVersion": "GNU gdb (GDB) 18.1",
        "debuggerExitCode": 0, "observedSignal": "SIGABRT",
        "inferiorExitCode": None, "inferiorSignal": 6,
        "signalEvidence": "gdb_sigabrt_forwarded_inferior_exited",
        "inferiorExited": True, "timedOut": False, "cleanup": "PASS",
        "assertionClass": "bpftool: C assertion failure (details redacted)",
        "inferiorOutputBytes": 88,
        "inferiorOutputSha256": hashlib.sha256(b"secret").hexdigest(),
        "debuggerOutputBytes": 180,
        "debuggerOutputSha256": hashlib.sha256(b"gdb").hexdigest(),
        "frames": [{
            "index": 0, "function": "do_show_link", "module": "bpftool-678d538",
            "moduleBuildId": "8faee6f37ed17666af07f7d8f671bf40a9fd38e5",
            "sourceFile": "link.c", "sourceLine": 320,
        }],
    }
    data.update(changes)
    return data


class CrashCaptureIntegration(unittest.TestCase):
    def run_observer(self, stdout=None, stderr=b"", exit=0, side_effect=None):
        if stdout is None:
            stdout = json.dumps(record()).encode("ascii")
        with tempfile.TemporaryFile("w+b") as output:
            audit = collector.InventoryAudit(output.fileno(), {
                "binaryPath": str(SOURCE), "binarySha256": HASH})
            response = SimpleNamespace(
                stdout=stdout, stderr=stderr, returncode=exit)
            with patch.object(collector.subprocess, "run",
                              side_effect=side_effect,
                              return_value=response) as invoked:
                with self.assertRaisesRegex(ValueError,
                                            "cannot qualify a session link"):
                    collector.diagnostic_live_link_capture(
                        SOURCE, WRAPPER, audit, lambda: "running")
            output.seek(0)
            rows = [json.loads(x) for x in output.read().splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(audit.invocations, 1)
        return rows[0], invoked

    def test_real_fixed_tool_pin_and_abort_is_diagnostic_only(self):
        row, run = self.run_observer()
        self.assertEqual(run.call_count, 1)
        args = run.call_args.args[0]
        self.assertEqual(args, [
            collector.sys.executable, "-B", str(WRAPPER)])
        self.assertEqual(run.call_args.kwargs["timeout"], 8.0)
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(row["binarySha256"], HASH)
        self.assertEqual(row["captureWrapperSha256"],
                         collector.FIXED_DIAGNOSTIC_CRASH_WRAPPER_SHA256)
        self.assertEqual(row["argv"],
                         [str(SOURCE), "-j", "link", "show"])
        self.assertEqual(row["crashCapture"]["capture"], "PASS")
        self.assertEqual(row["crashCapture"]["observedSignal"], "SIGABRT")
        self.assertEqual(row["crashCapture"]["inferiorSignal"], 6)
        self.assertEqual(row["crashCapture"]["frames"][0]["function"],
                         "do_show_link")
        self.assertIsNone(row["exitCode"])
        self.assertEqual(row["nativeExitStatus"], "not_directly_observed")
        self.assertEqual(row["result"], "diagnostic_only_unverified")
        self.assertEqual(row["tracerStateAtEnd"], "running")
        self.assertFalse(row["jsonAttempted"])

    def test_normal_debugger_exit_cannot_arm(self):
        response = record(observedSignal=None, inferiorSignal=None,
                          signalEvidence="none", inferiorExitCode=0,
                          frames=[], assertionClass=None)
        row, _ = self.run_observer(stdout=json.dumps(response).encode("ascii"))
        self.assertEqual(row["crashCapture"]["capture"], "PASS")
        self.assertEqual(row["result"], "diagnostic_only_unverified")
        self.assertIsNone(row["exitCode"])

    def test_bad_and_mismatched_provenance_cannot_promote_capture(self):
        cases = (
            record(executableSha256="0" * 64),
            record(buildId="0" * 40),
            record(debuggerVersion="unexpected gdb"),
            record(inferiorExited=False),
            record(signalEvidence="none"),
            record(inferiorSignal=None),
            record(debuggerExitCode=42),
            record(schemaVersion=True),
        )
        for response in cases:
            with self.subTest(response={k: response[k] for k in
                                        ("executableSha256", "buildId",
                                         "debuggerVersion")}):
                row, _ = self.run_observer(
                    stdout=json.dumps(response).encode("ascii"))
                self.assertEqual(row["crashCapture"]["capture"], "FAIL")

    def test_arbitrary_text_and_pointer_never_enter_audit(self):
        malicious = record(
            assertionClass="/home/hylab/secret 0xdeadbeef",
            frames=[{
                "function": "0xdeadbeef SECRET_VALUE",
                "module": "/home/hylab/.ssh/private_key",
                "sourceFile": "/path/secret",
                "sourceLine": 2,
            }])
        row, _ = self.run_observer(
            stdout=json.dumps(malicious).encode("ascii"))
        blob = json.dumps(row)
        for private in ("0xdeadbeef", "/home/hylab", "SECRET_VALUE",
                        "private_key", "/path/secret"):
            self.assertNotIn(private, blob)
        self.assertEqual(row["result"], "diagnostic_only_unverified")

    def test_debugger_failure_exits_without_fallback(self):
        row, run = self.run_observer(stdout=b"not JSON secret",
                                     stderr=b"password 0xabc", exit=4)
        self.assertEqual(row["crashCapture"]["capture"], "FAIL")
        self.assertEqual(row["crashCapture"]["failureClass"],
                         "observer_exit_mismatch")
        self.assertNotIn("password", json.dumps(row))
        self.assertEqual(run.call_count, 1)

    def test_timeout_and_oversized_output_fail_closed(self):
        row, _ = self.run_observer(
            side_effect=subprocess.TimeoutExpired("gdb", 8))
        self.assertEqual(row["crashCapture"]["capture"], "TIMEOUT")
        self.assertTrue(row["timedOut"])
        row, _ = self.run_observer(stdout=b"private" * 2000)
        self.assertEqual(row["crashCapture"]["capture"], "FAIL")
        self.assertNotIn("privateprivate", json.dumps(row))

    def test_unavailable_wrapper_rejected_before_attachment(self):
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=FileNotFoundError("no wrapper")):
            with self.assertRaises(FileNotFoundError):
                collector.qualified_diagnostic_crash_wrapper()
        with patch.object(collector, "pinned_diagnostic_file",
                          side_effect=ValueError("sha mismatch")):
            with self.assertRaises(ValueError):
                collector.qualified_diagnostic_crash_wrapper()

    def test_wrapper_pin_matches_actual_reviewed_source_and_installer(self):
        import hashlib
        path = HERE / "clack-bpftool-abort-capture.py"
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(actual, collector.FIXED_DIAGNOSTIC_CRASH_WRAPPER_SHA256)
        installer = (HERE / "Install-ClackBpftoolCrashCapture.ps1").read_text(
            encoding="utf-8")
        self.assertIn(actual, installer)
        self.assertIn("test ! -e", installer)
        self.assertIn("test ! -L", installer)
        self.assertIn("clack-crash-install-snapshot.", installer)
        self.assertIn('"$tmp/observer.py"', installer)
        self.assertIn('sha256sum -- "$tmp/observer.py"', installer)
        self.assertIn("CLACK_CRASH_OBSERVER_EXECUTED=0", installer)
        self.assertNotIn("-j link show", installer)
        snippet = re.search(r"\$bootstrap = @'\n(.*?)\n'@", installer, re.S)
        self.assertIsNotNone(snippet)
        bash = (r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt"
                else "/usr/bin/bash")
        if Path(bash).exists():
            syntax = subprocess.run([bash, "-n"],
                                    input=snippet.group(1).encode("ascii"),
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=3)
            self.assertEqual(syntax.returncode, 0, syntax.stderr)

    def test_bad_flag_pair_rejected_before_linux_root_fd_checks(self):
        parser_args = ["--pid", "2023", "--seconds", "20",
                       "--ready-fd", "3", "--inventory-audit-fd", "4",
                       "--capture-live-link-abort"]
        with self.assertRaises(SystemExit):
            collector.main(parser_args)
        parser_args.extend(["--fixed-diagnostic-bpftool"])
        parser_args[3] = "1800"
        with self.assertRaises(SystemExit):
            collector.main(parser_args)

    def test_non_capture_baseline_program_terminal_untouched(self):
        src = (HERE / "local-muse-one-ebpf.py").read_text(encoding="utf-8")
        self.assertIn('crash_capture_wrapper is not None and phase == "live"', src)
        self.assertIn('if args.capture_live_link_abort', src)
        self.assertIn('if args.capture_live_link_abort else None', src)
        self.assertIn('raise ValueError("Diagnostic-only GDB capture', src)
        shell = (HERE / "local-muse-one-root.sh").read_text(encoding="utf-8")
        self.assertIn('if [[ "$9" == capture ]]; then', shell)
        self.assertIn("--capture-live-link-abort", shell)
        self.assertIn("fixed_bpftool_mode=fixed", shell)
        ps = (HERE / "Run-OneMuseKernelOperator.ps1").read_text(encoding="utf-8")
        self.assertIn("[switch]$CrashCapture", ps)
        self.assertIn("if ($CrashCapture -and $Seconds -gt 20)", ps)
        self.assertEqual(ps.count("'scripts/local-muse-one-ebpf.py'"), 1)


if __name__ == "__main__":
    unittest.main()
