"""Synthetic-only test suite. No bpftool, SSH, sudo, eBPF or inference.

On Linux, the fake debugger executes only short Python crash fixtures; if a
real gdb is locally installed, a compiled C fixture also tests actual GDB
symbolization. The production bpftool path is NEVER used here.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
MODULE = HERE / "clack-bpftool-abort-capture.py"
spec = importlib.util.spec_from_file_location("clack_abort_capture", MODULE)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)

FAKE_DEBUGGER = r'''#!/usr/bin/env python3
import json, os, re, subprocess, sys, time
args = sys.argv[1:]
idx = args.index("--args")
target = args[idx + 1:]
tty = next(x.split(" ", 2)[2] for x in args if x.startswith("set inferior-tty "))
mode = os.environ.get("CLACK_FIXTURE_MODE", "normal")
if mode == "failure":
    print("secret=/home/hylab/.ssh/private 0xdeadbeef", file=sys.stderr)
    sys.exit(4)
if mode == "overflow":
    print("secret-data-should-never-be-exported_" * 5000)
    sys.exit(3)
if mode == "hang":
    subprocess.Popen(target, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(60)
    sys.exit(3)
child = subprocess.run(target, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, check=False)
with open(tty, "wb", buffering=0) as output:
    output.write(child.stdout + child.stderr)
frame = {"function":"abort_fixture_symbol","module":"/tmp/private/fixture",
         "file":"/home/hylab/private/fixture.c","line":37}
signal_name = "SIGABRT" if child.returncode == -6 else None
record = {"observedSignal":signal_name, "inferiorExitCode":
          child.returncode if child.returncode >= 0 else None,
          "inferiorExited":True, "frames":[frame] if signal_name else [],
          "assertionSite":None,
          "modules":[{"module":"/tmp/private/fixture",
                      "buildId":"deadbeefcafe1234"}]}
print("CLACK_GDB_CAPTURE_V1=" + json.dumps(record,separators=(",", ":")))
'''


class PureNormalizerTests(unittest.TestCase):
    def test_drops_private_source_paths_pointer_values_and_args(self):
        valid = {
            "observedSignal": "SIGABRT", "inferiorExitCode": None,
            "inferiorExited": True, "assertionSite": None,
            "frames": [{"function": "abort_fixture_symbol",
                        "module": "/home/hylab/secrets/fixture",
                        "file": "/secret/private/fixture.c", "line": 37},
                       {"function": "secret.password.0xdeadbeef(",
                        "module": "/home/user/foo token", "file": None,
                        "line": 0}],
            "modules": [{"module": "/tmp/fixture", "buildId": "deadbeefcafe1234"}],
        }
        result = capture.normalize_gdb(valid)
        self.assertIsNotNone(result)
        self.assertEqual(result["observedSignal"], "SIGABRT")
        self.assertEqual(result["frames"][0]["function"], "abort_fixture_symbol")
        self.assertEqual(result["frames"][0]["module"], "fixture")
        self.assertEqual(result["frames"][0]["sourceFile"], "fixture.c")
        self.assertEqual(result["frames"][0]["sourceLine"], 37)
        self.assertEqual(result["frames"][0]["moduleBuildId"], "deadbeefcafe1234")
        self.assertEqual(result["frames"][1]["function"], "unknown")
        serialized = json.dumps(result)
        for private in ("/home", "/secret", "0xdeadbeef", "password"):
            self.assertNotIn(private, serialized)

    def test_malformed_gdb_metadata_is_fail_closed(self):
        cases = (None, [], {"debuggerError": "gdb_command_failure"},
                 {"observedSignal": "SIGSEGV"}, {"observedSignal": "SIGABRT",
                 "inferiorExitCode": None, "inferiorExited": True,
                 "frames": [{}], "modules": []},
                 {"observedSignal": None, "inferiorExitCode": 0,
                  "inferiorExited": True, "frames": [], "assertionSite": None,
                  "modules": [None]})
        for value in cases:
            with self.subTest(value=value):
                self.assertIsNone(capture.normalize_gdb(value))

    def test_no_raw_assertion_and_secrets(self):
        self.assertEqual(capture.safe_stderr_class(b"free(): invalid pointer\n"),
                         "free(): invalid pointer")
        assertion = (b"bpftool-678d538: src/link.c:75: show_link: "
                     b"Assertion 'private 0xdeadbeef' failed.\n")
        self.assertEqual(capture.safe_stderr_class(assertion),
                         "bpftool: C assertion failure (details redacted)")
        self.assertIsNone(capture.safe_stderr_class(
            b"Error: API bearer SECRET_0xdeadbeef\n"))
        self.assertIsNone(capture.safe_stderr_class(b"X" * 65537))
        self.assertIsNone(capture.safe_stderr_class(b"\xff\xfe\n"))

    def test_normalized_assertion_location_expression_is_never_exported(self):
        stderr = (b"bpftool-678d538: src/link.c:753: do_show_link: "
                  b"Assertion 'secret 0xdeadbeef /home/hylab/.ssh/private' failed.\n")
        label, location = capture.safe_assertion_metadata(stderr)
        self.assertEqual(label, "bpftool: C assertion failure (details redacted)")
        self.assertEqual(location, {"module": "bpftool-678d538",
                                    "sourceFile": "link.c", "sourceLine": 753,
                                    "function": "do_show_link"})
        blob = json.dumps([label, location])
        for secret in ("secret", "/home", "0xdeadbeef", "Assertion '"):
            self.assertNotIn(secret, blob)

    def test_malformed_and_oversize_assertion_is_rejected(self):
        examples = (b"bpftool: /home/hylab/secret:1: fn: fail\n",
                    b"bpftool: link.c:0: fn: Assertion 1 failed.\n",
                    b"bpftool: link.c:42: fn: Assertion value failed.\nLEAK",
                    b"bpftool: link.c:42: fn: Assertion \xff failed.\n",
                    b"bpftool: link.c:42: fn: Assertion private\x00 failed.\n",
                    b"bpftool: link.c:42: fn: Assertion " + b"x" * 400 + b" failed.\n",
                    b"X" * (capture.MAX_PTY + 1))
        for example in examples:
            with self.subTest(example=example[:60]):
                self.assertEqual(capture.safe_assertion_metadata(example),
                                 (None, None))

    def test_module_relative_pc_inline_chain_and_unresolved_name(self):
        raw = {"observedSignal": "SIGABRT", "inferiorExitCode": None,
               "inferiorExited": True, "frames": [],
               "modules": [{"module": "/private/fixture",
                            "buildId": "deadbeefcafe1234"}],
               "assertionSite": {
                   "module": "/private/fixture", "moduleOffset": 1337,
                   "symbol": "assertion_site", "functionOffset": 23,
                   "file": "/home/private/link.c", "line": 81,
                   "inlineChain": [
                       {"function": "inlined_inner",
                        "file": "/private/src/inline.h", "line": 10},
                       {"function": "inlined_outer",
                        "file": "/private/src/inline.h", "line": 20}]}}
        normalized = capture.normalize_gdb(raw)
        site = normalized["assertionSite"]
        self.assertEqual(site["moduleOffset"], 1337)
        self.assertEqual(site["functionOffset"], 23)
        self.assertEqual(site["symbol"], "assertion_site")
        self.assertEqual(site["moduleBuildId"], "deadbeefcafe1234")
        self.assertEqual(site["sourceFile"], "link.c")
        self.assertEqual(site["sourceLine"], 81)
        self.assertEqual([row["function"] for row in site["inlineChain"]],
                         ["inlined_inner", "inlined_outer"])
        self.assertNotIn("/private", json.dumps(normalized))
        raw["assertionSite"]["symbol"] = "private /home/key"
        raw["assertionSite"]["functionOffset"] = None
        unresolved = capture.normalize_gdb(raw)["assertionSite"]
        self.assertEqual(unresolved["symbol"], "unknown")
        self.assertNotIn("functionOffset", unresolved)
        raw["assertionSite"]["moduleOffset"] = 0x7fff00000000
        self.assertIsNone(capture.normalize_gdb(raw))
        raw["assertionSite"]["moduleOffset"] = 18
        raw["assertionSite"]["inlineChain"] *= 3
        self.assertIsNone(capture.normalize_gdb(raw))

    def test_no_absolute_address_register_memory_or_environment_escape(self):
        source = capture.GDB_SCRIPT
        for secret_command in ("info registers", "gcore", "dump memory",
                               "show environment", "print *", "x/32",
                               "thread apply all bt", "gdb.parse_and_eval"):
            self.assertNotIn(secret_command, source)
        self.assertIn('gdb.execute("info symbol 0x%x" % pc', source)
        self.assertIn('open("/proc/%d/maps" % pid', source)
        self.assertIn("MAX_MODULE_OFFSET", MODULE.read_text(encoding="utf-8"))
        self.assertIn("resource.setrlimit(resource.RLIMIT_CORE, (0, 0))",
                      MODULE.read_text(encoding="utf-8"))

    def test_production_cli_rejects_user_supplied_commands(self):
        with patch.object(capture, "production_preflight") as preflight:
            self.assertEqual(capture.main(["--target", "/usr/bin/bpftool"]), 2)
            self.assertEqual(capture.main(["--args", "private"]), 2)
            preflight.assert_not_called()

    def test_gdb_script_contains_no_memory_or_core_dump_commands(self):
        text = capture.GDB_SCRIPT
        self.assertIn('gdb.execute("handle SIGABRT stop print nopass"', text)
        self.assertIn('gdb.execute("signal SIGABRT"', text)
        self.assertIn("frame.find_sal()", text)
        self.assertNotIn("info registers", text)
        self.assertNotIn("gcore", text)
        self.assertNotIn("dump memory", text)
        self.assertNotIn("print *", text)
        self.assertNotIn("show environment", text)
        self.assertNotIn("thread apply all bt", text)


@unittest.skipUnless(os.name == "posix", "PTY requires Linux")
class FakeDebuggerIntegration(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="clack-offline-crash-")
        root = Path(self.folder.name)
        self.gdb = root / "fake-gdb"
        self.gdb.write_text(FAKE_DEBUGGER, encoding="ascii")
        self.gdb.chmod(0o700)
        self.fixture = root / "fake-fixture.py"
        self.fixture.write_text(
            "#!/usr/bin/env python3\n"
            "import os,sys,time\n"
            "mode=os.environ.get('CLACK_FIXTURE_MODE','normal')\n"
            "if mode=='abort':\n"
            "  os.abort()\n"
            "if mode=='stderr':\n"
            "  print('free(): invalid pointer',file=sys.stderr)\n"
            "  os.abort()\n"
            "if mode=='hang':\n"
            "  time.sleep(60)\n"
            "print('[]')\n",
            encoding="ascii")
        self.fixture.chmod(0o700)

    def tearDown(self):
        self.folder.cleanup()

    def capture_mode(self, mode, seconds=3):
        old = os.environ.get("CLACK_FIXTURE_MODE")
        os.environ["CLACK_FIXTURE_MODE"] = mode
        try:
            return capture.capture(
                str(self.fixture), str(self.gdb), timeout=seconds,
                debugger_version="GNU gdb (GDB) 18.1")
        finally:
            if old is None:
                os.environ.pop("CLACK_FIXTURE_MODE", None)
            else:
                os.environ["CLACK_FIXTURE_MODE"] = old

    def test_normal_child_exit(self):
        result = self.capture_mode("normal")
        self.assertEqual(result["capture"], "PASS")
        self.assertTrue(result["inferiorExited"])
        self.assertEqual(result["inferiorExitCode"], 0)
        self.assertIsNone(result["observedSignal"])
        self.assertEqual(result["cleanup"], "PASS")

    def test_sigabrt_child_symbolic_frame_and_native_signal(self):
        result = self.capture_mode("abort")
        self.assertEqual(result["capture"], "PASS", result)
        self.assertEqual(result["observedSignal"], "SIGABRT")
        self.assertIsNone(result["inferiorExitCode"])
        self.assertEqual(result["inferiorSignal"], 6)
        self.assertEqual(result["signalEvidence"],
                         "gdb_sigabrt_forwarded_inferior_exited")
        self.assertEqual(result["frames"][0]["function"], "abort_fixture_symbol")
        self.assertEqual(result["frames"][0]["module"], "fixture")
        self.assertEqual(result["frames"][0]["sourceFile"], "fixture.c")
        self.assertEqual(result["cleanup"], "PASS")
        self.assertNotIn("/home", json.dumps(result))

    def test_stderr_only_assertion_is_safely_classified(self):
        result = self.capture_mode("stderr")
        self.assertEqual(result["capture"], "PASS")
        self.assertEqual(result["observedSignal"], "SIGABRT")
        self.assertEqual(result["assertionClass"], "free(): invalid pointer",
                         {k: result[k] for k in (
                             "inferiorOutputBytes", "inferiorOutputSha256",
                             "debuggerOutputBytes", "debuggerExitCode")})
        self.assertEqual(result["cleanup"], "PASS")

    def test_timeout_bounded_and_cleanup(self):
        started = __import__("time").monotonic()
        result = self.capture_mode("hang", seconds=0.4)
        self.assertEqual(result["capture"], "TIMEOUT")
        self.assertTrue(result["timedOut"])
        self.assertEqual(result["cleanup"], "PASS")
        self.assertLess(__import__("time").monotonic() - started, 3)

    def test_debugger_failure_no_raw_stderr_export(self):
        result = self.capture_mode("failure")
        self.assertEqual(result["capture"], "FAIL")
        self.assertEqual(result["cleanup"], "PASS")
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("0xdeadbeef", json.dumps(result))
        self.assertNotIn("/home/hylab/.ssh/private", json.dumps(result))

    def test_oversized_output_discarded_and_cleanup(self):
        result = self.capture_mode("overflow")
        self.assertEqual(result["capture"], "FAIL")
        self.assertEqual(result["cleanup"], "PASS")
        self.assertLessEqual(result["debuggerOutputBytes"], capture.MAX_STREAM)
        self.assertNotIn("secret-data-should-never-be-exported", json.dumps(result))

    def test_no_core_file_generated_by_abort_fixture(self):
        self.capture_mode("abort")
        self.assertFalse(list(Path(self.folder.name).rglob("core*")))
        self.assertFalse(list(Path(self.folder.name).rglob("capture.gdb")))


@unittest.skipUnless(
    os.name == "posix" and Path("/usr/bin/gdb").is_file() and shutil.which("cc"),
    "Real GDB fixture available only on a Linux host with compiler and gdb")
class RealGdbFixture(unittest.TestCase):
    def test_symbolic_stack_for_compiled_abort_fixture(self):
        # Independent of bpftool: execute only this fresh tiny C fixture.
        with tempfile.TemporaryDirectory(prefix="clack-real-gdb-fixture-") as folder:
            p = Path(folder)
            c = p / "fixture.c"
            c.write_text("#include <stdlib.h>\n"
                         "__attribute__((noinline)) void captured_marker(void) { abort(); }\n"
                         "int main(void) { captured_marker(); return 0; }\n",
                         encoding="ascii")
            binary = p / "fixture"
            subprocess.run(["/usr/bin/cc", "-g", "-O0", "-fno-omit-frame-pointer",
                            "-o", str(binary), str(c)], check=True, timeout=8)
            result = capture.capture(str(binary), "/usr/bin/gdb", timeout=4)
            self.assertEqual(result["capture"], "PASS", result)
            self.assertEqual(result["observedSignal"], "SIGABRT")
            self.assertTrue(any(
                frame["function"] == "captured_marker"
                for frame in result["frames"]), result)
            self.assertEqual(result["cleanup"], "PASS")
            self.assertFalse(list(p.glob("core*")))

    def test_assertion_source_line_function_and_relative_pc_in_real_gdb(self):
        # Never invokes the fixed tool: this is a synthetic assertion-only C program.
        with tempfile.TemporaryDirectory(prefix="clack-real-assert-fixture-") as folder:
            p = Path(folder)
            c = p / "fixture.c"
            c.write_text("#include <assert.h>\n"
                         "__attribute__((noinline)) void captured_marker(void) {\n"
                         "  assert(0 && \"secret_0xdeadbeef\");\n"
                         "}\n"
                         "int main(void) { captured_marker(); return 0; }\n",
                         encoding="ascii")
            binary = p / "fixture"
            subprocess.run(["/usr/bin/cc", "-g", "-O0", "-fno-omit-frame-pointer",
                            "-o", str(binary), str(c)], check=True, timeout=8)
            result = capture.capture(str(binary), "/usr/bin/gdb", timeout=4)
            self.assertEqual(result["capture"], "PASS", result)
            self.assertEqual(result["observedSignal"], "SIGABRT")
            site = result["assertionSite"]
            self.assertIsNotNone(site, result)
            self.assertEqual(site["module"], "fixture")
            self.assertIsInstance(site["moduleOffset"], int, result)
            self.assertEqual(site["sourceFile"], "fixture.c")
            self.assertEqual(site["sourceLine"], 3)
            self.assertEqual(site["symbol"], "captured_marker")
            self.assertIsInstance(site.get("functionOffset"), int, result)
            self.assertEqual(result["cleanup"], "PASS")
            self.assertNotIn("secret_0xdeadbeef", json.dumps(result))
            self.assertFalse(list(p.glob("core*")))


if __name__ == "__main__":
    unittest.main()
