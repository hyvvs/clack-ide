"""Offline-only regression for the *actual* embedded admin compile/cleanup Bash.

Runs under local Git Bash (Windows) or Bash (Linux). Never starts SSH, sudo,
Ollama, bpftrace or eBPF: the real compiler path is replaced with a tiny fake
shell script, and remote identity/staging checks are replaced with temporary
local fixtures. This intentionally tests the embedded shell, not a re-creation.
"""

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HELPER = (ROOT / "src-tauri/target/local-muse-ebpf-host-validation-a6c95a3"
          / "Run-AdminValidation.ps1")
if os.name == "nt":
    BASH = Path(r"C:\Program Files\Git\bin\bash.exe")
else:
    BASH = Path("/bin/bash")


def bash_path(path):
    result = Path(path).resolve().as_posix()
    if os.name == "nt":
        assert result[1] == ":", result
        return "/" + result[0].lower() + result[2:]
    return result


def one_replace(source, before, after):
    occurrences = source.count(before)
    if occurrences != 1:
        raise AssertionError(f"Expected exactly one real Bash anchor ({occurrences}): {before}")
    return source.replace(before, after)


def compiled_root_script():
    source = HELPER.read_text(encoding="utf-8")
    match = re.search(r"(?ms)^\$rootScript = @'\n(.*?)\n'@", source)
    if not match:
        raise AssertionError("Unable to extract root-script here-string from admin helper")
    body = match.group(1)
    body = one_replace(body, "dest=/run/local-muse-ebpf", 'dest="$TEST_DEST"')

    # Replace privileged preflight and installation before running *anything*.
    # The real compiler invocation, traps, result handling and cleanup remain.
    start = body.index('if [ "$(id -u)" -ne 0 ]; then')
    end_text = "echo FILTER=PID_1139_IPV4_LOOPBACK_11434_NO_SSH_OR_RECV"
    end = body.index(end_text, start) + len(end_text)
    body = (body[:start]
            + 'mkdir -p "$dest"\n'
              'owned=1\n'
              'printf "fixture\\n" > "$dest/local-muse-tcp.bt"\n'
              'printf "fixture\\n" > "$dest/local-muse-tcp-session.py"\n'
              + end_text
              + body[end:])
    body = one_replace(
        body, "/usr/bin/bpftrace --mode codegen --verify-llvm-ir -q",
        '/usr/bin/bash "$TEST_COMPILER" --mode codegen --verify-llvm-ir -q')
    body = one_replace(body, "--kill-after=2s 8s", "--kill-after=1s 1s")
    if "/usr/bin/bpftrace --mode codegen" in body or "sudo /usr/bin" in body:
        raise AssertionError("A real privileged or eBPF command survived fixture isolation")
    return body


def wrapper_script():
    source = HELPER.read_text(encoding="utf-8")
    match = re.search(r"(?ms)^\$wrapper = @'\n(.*?)\n'@", source)
    if not match:
        raise AssertionError("Unable to extract the outer SSH shell wrapper")
    body = match.group(1)
    body = one_replace(body, "result='__STAGE__/result.numeric'",
                       'result="$TEST_STAGE/result.numeric"')
    body = one_replace(
        body,
        "sudo /usr/bin/bash -c 'echo __ROOT_B64__ | base64 -d | /usr/bin/bash'",
        '/usr/bin/bash "$TEST_ROOT_WRAPPER"')
    if "sudo /usr/bin/bash" in body or "/usr/bin/bpftrace" in body:
        raise AssertionError("Wrapper fixture would invoke a privileged command")
    return body


class CompileOnlyReportingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not HELPER.is_file():
            raise unittest.SkipTest("Interactive admin helper not present in this workspace")
        if not BASH.is_file():
            raise unittest.SkipTest("Local Bash is required for shell-level regressions")
        helper_text = HELPER.read_text(encoding="utf-8")
        if "if (-not $CompileOnly)" not in helper_text:
            raise AssertionError("Unapproved default attachment must be rejected before SSH")
        if "/usr/bin/bpftrace --mode codegen --verify-llvm-ir -q" not in helper_text:
            raise AssertionError("Actual compiler MUST use non-attaching --mode codegen")
        if "/usr/bin/bpftrace -d codegen" in helper_text or "--dry-run -q" in helper_text:
            raise AssertionError("Debug/dry-run is not a safe compile-only command")
        if "ROOT_SESSION_BEGIN=1" in helper_text:
            raise AssertionError("Compile-only helper must not contain an attach path")
        cls.body = compiled_root_script()
        cls.assert_in_body = ("COMPILER_DIAGNOSTICS_BEGIN", "COMPILER_DIAGNOSTICS_END",
                              "PROBE_COMPILATION_EXIT=", "CLEANUP_STATUS=")
        for token in cls.assert_in_body:
            if token not in cls.body:
                raise AssertionError(f"Missing required emitted diagnostic: {token}")

    def run_fake(self, fake_script):
        with tempfile.TemporaryDirectory(prefix="clack-compile-offline-") as tmp:
            folder = Path(tmp)
            script = folder / "fake-compiler.sh"
            script.write_text("#!/usr/bin/env bash\n" + fake_script, encoding="utf-8")
            dest = folder / "root-owned-fixture"
            env = dict(os.environ,
                       TEST_COMPILER=bash_path(script),
                       TEST_DEST=bash_path(dest))
            done = subprocess.run([str(BASH), "-s"], input=self.body, env=env,
                                  text=True, capture_output=True, timeout=12)
            self.assertFalse(dest.exists(), "Root cleanup trap left fixture resources")
            stdout = done.stdout
            for token in self.assert_in_body:
                self.assertIn(token, stdout, f"Missing {token}: {stdout!r} / {done.stderr!r}")
            self.assertIn("CLEANUP_STATUS=PASS", stdout)
            self.assertIn("ATTACHMENT=NOT_ATTEMPTED_COMPILE_ONLY", stdout)
            self.assertNotIn("ROOT_SESSION_BEGIN", stdout)
            self.assertLess(stdout.index("COMPILER_DIAGNOSTICS_BEGIN"),
                            stdout.index("COMPILER_DIAGNOSTICS_END"))
            self.assertLess(stdout.index("COMPILER_DIAGNOSTICS_END"),
                            stdout.index("PROBE_COMPILATION="))
            self.assertLess(stdout.index("PROBE_COMPILATION_EXIT="),
                            stdout.index("CLEANUP_STATUS="))
            return done

    def test_success_includes_separate_stdout_and_stderr_and_cleanup(self):
        done = self.run_fake(
            'test "$1" = "--mode" && test "$2" = "codegen" || exit 99\n'
            'test "$3" = "--verify-llvm-ir" && test "$4" = "-q" || exit 98\n'
            'echo "LLVM codegen produced"\n'
            'echo "benign compiler note" >&2\n'
            'exit 0\n')
        self.assertEqual(done.returncode, 0, done.stderr)
        for token in ("COMPILER_STDOUT_BEGIN", "LLVM codegen produced",
                      "COMPILER_STDERR_BEGIN", "benign compiler note",
                      "PROBE_COMPILATION=PASS", "PROBE_COMPILATION_EXIT=0"):
            self.assertIn(token, done.stdout)

    def test_syntax_error_preserves_original_error_exit_and_cleanup(self):
        done = self.run_fake(
            'echo "error: unknown socket field at line 27" >&2\n'
            'exit 23\n')
        self.assertEqual(done.returncode, 23, done.stderr)
        for token in ("error: unknown socket field at line 27",
                      "PROBE_COMPILATION=FAIL", "PROBE_COMPILATION_EXIT=23"):
            self.assertIn(token, done.stdout)

    def test_stderr_only_error_is_not_silenced(self):
        done = self.run_fake(
            'printf "%s\\n" "error: unknown bpftrace builtin" >&2\n'
            'exit 31\n')
        self.assertEqual(done.returncode, 31, done.stderr)
        self.assertIn("COMPILER_STDOUT_CAPTURE_BYTES=0", done.stdout)
        self.assertIn("error: unknown bpftrace builtin", done.stdout)
        self.assertIn("PROBE_COMPILATION_EXIT=31", done.stdout)
        self.assertIn("PROBE_COMPILATION=FAIL", done.stdout)

    def test_timeout_preserves_status_diagnostics_and_cleanup(self):
        done = self.run_fake(
            'echo "compiler began"\n'
            'echo "compilation still running" >&2\n'
            'sleep 5\n')
        self.assertEqual(done.returncode, 124, done.stderr)
        for token in ("compiler began", "compilation still running",
                      "PROBE_COMPILATION=TIMEOUT", "PROBE_COMPILATION_EXIT=124"):
            self.assertIn(token, done.stdout)

    def test_runtime_markers_fail_closed_even_with_compiler_zero_exit(self):
        done = self.run_fake(
            'echo "compiled"\n'
            'echo "TCPREADY 1139 11434"\n'
            'echo "TCPSUMMARY 0 0 0"\n'
            'exit 0\n')
        self.assertEqual(done.returncode, 1, done.stderr)
        self.assertIn("PROBE_COMPILATION=FAIL", done.stdout)
        self.assertIn("PROBE_COMPILATION_EXIT=0", done.stdout)
        self.assertIn("COMPILER_RUNTIME_OUTPUT_DETECTED=YES", done.stdout)

    def test_large_stdout_bounded_without_silencing_stderr(self):
        done = self.run_fake(
            'head -c 120000 /dev/zero | tr "\\000" "x"\n'
            'echo "error: after codegen output" >&2\n'
            'exit 41\n')
        self.assertEqual(done.returncode, 41, done.stderr)
        self.assertIn("COMPILER_STDOUT_TRUNCATED_MIDDLE_BYTES=", done.stdout)
        self.assertIn("error: after codegen output", done.stdout)
        self.assertIn("PROBE_COMPILATION_EXIT=41", done.stdout)
        self.assertLess(len(done.stdout), 100000, "Diagnostics must be bounded")


class OuterFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not HELPER.is_file() or not BASH.is_file():
            raise unittest.SkipTest("Admin helper and local Bash required")
        cls.body = wrapper_script()

    def run_mock_root(self, fake_script):
        with tempfile.TemporaryDirectory(prefix="clack-compile-wrapper-") as tmp:
            folder = Path(tmp)
            fake = folder / "fake-root.sh"
            fake.write_text("#!/usr/bin/env bash\n" + fake_script, encoding="utf-8")
            env = dict(os.environ,
                       TEST_ROOT_WRAPPER=bash_path(fake),
                       TEST_STAGE=bash_path(folder))
            done = subprocess.run([str(BASH), "-s"], input=self.body, env=env,
                                  text=True, capture_output=True, timeout=5)
            saved = (folder / "result.numeric").read_text(encoding="utf-8")
            self.assertEqual(saved, done.stdout,
                             "Fallback evidence must also remain in the private result receipt")
            return done

    def test_aborted_root_shell_cannot_silently_claim_success(self):
        done = self.run_mock_root(
            'echo FILTER=PID_1139_IPV4_LOOPBACK_11434_NO_SSH_OR_RECV\n'
            'exit 66\n')
        self.assertEqual(done.returncode, 66, done.stderr)
        for token in ("COMPILER_DIAGNOSTICS_BEGIN", "COMPILER_DIAGNOSTICS_END",
                      "PROBE_COMPILATION=FAIL", "PROBE_COMPILATION_EXIT=UNOBSERVED",
                      "CLEANUP_STATUS=FAIL"):
            self.assertIn(token, done.stdout)

    def test_aborted_root_shell_with_zero_exit_still_fails_closed(self):
        done = self.run_mock_root("echo FILTER=PID_1139\nexit 0\n")
        self.assertEqual(done.returncode, 1, done.stderr)
        self.assertIn("PROBE_COMPILATION_EXIT=UNOBSERVED", done.stdout)
        self.assertIn("CLEANUP_STATUS=FAIL", done.stdout)

    def test_valid_root_terminal_records_not_duplicated(self):
        done = self.run_mock_root(
            'echo COMPILER_DIAGNOSTICS_BEGIN\n'
            'echo COMPILER_DIAGNOSTICS_END\n'
            'echo PROBE_COMPILATION=PASS\n'
            'echo PROBE_COMPILATION_EXIT=0\n'
            'echo CLEANUP_STATUS=PASS\n'
            'exit 0\n')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.count("COMPILER_DIAGNOSTICS_BEGIN"), 1)
        self.assertEqual(done.stdout.count("CLEANUP_STATUS=PASS"), 1)


if __name__ == "__main__":
    unittest.main()
