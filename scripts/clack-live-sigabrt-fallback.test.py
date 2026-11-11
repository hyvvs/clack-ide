"""No-BPF, no-GDB regression: ordinary link JSON first, GDB only after SIGABRT.

Exactly one observer fallback is allowed for a normal (non-crash-capture)
short kernel validation. It always raises and never substitutes link proof.
"""
import importlib.util
from pathlib import Path
import signal
import subprocess
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "collector_one_sigabrt_fallback", HERE / "local-muse-one-ebpf.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class InlineSigabrtFallbackTests(unittest.TestCase):
    def invoke(self, phase="live", result=None, exit_code=None, fallback_used=False,
               tracer="running", preempt=False, observer=None):
        if result is None:
            result = {101: {"id": 101, "type": "kprobe_multi", "prog_id": 93}}
        state = {"used": fallback_used}
        if exit_code is not None:
            # A native subprocess returncode is negative for signal death.
            inventory_effect = subprocess.CalledProcessError(
                exit_code, ["/private/bpftool", "-j", "link", "show"])
        else:
            inventory_effect = None
        with patch.object(collector, "link_inventory", return_value=result,
                          side_effect=inventory_effect) as link, \
             patch.object(collector, "diagnostic_live_link_capture",
                          side_effect=observer or ValueError(
                              "Diagnostic-only GDB capture cannot qualify a session link")
                          ) as capture:
            try:
                value = collector.inspected_link_inventory(
                    collector.FIXED_DIAGNOSTIC_BPFT_PATH, 2.0, phase, None,
                    lambda: tracer, collector.FIXED_DIAGNOSTIC_CRASH_WRAPPER_PATH,
                    preempt, state)
                failure = None
            except Exception as exc:
                value, failure = None, exc
            return value, failure, state, link, capture

    def test_normal_live_valid_json_never_starts_gdb(self):
        value, failure, state, link, capture = self.invoke()
        self.assertIsNone(failure)
        self.assertEqual(len(value), 1)
        self.assertFalse(state["used"])
        link.assert_called_once()
        capture.assert_not_called()

    def test_actual_live_native_sigabrt_uses_one_gdb_and_always_blocks(self):
        value, failure, state, link, capture = self.invoke(
            exit_code=-signal.SIGABRT)
        self.assertIsNone(value)
        self.assertIsInstance(failure, ValueError)
        self.assertTrue(state["used"])
        link.assert_called_once()
        capture.assert_called_once()
        self.assertGreater(capture.call_args.kwargs["watchdog_seconds"], 0)
        self.assertLessEqual(capture.call_args.kwargs["watchdog_seconds"], 8.0)
        # Even a non-aborting GDB inferior cannot be credited as proof.
        with patch.object(collector, "link_inventory",
                          side_effect=subprocess.CalledProcessError(
                              -signal.SIGABRT, ["bpftool"])) as link, \
             patch.object(collector, "diagnostic_live_link_capture",
                          return_value=None) as capture:
            state = {"used": False}
            with self.assertRaises(subprocess.CalledProcessError):
                collector.inspected_link_inventory(
                    collector.FIXED_DIAGNOSTIC_BPFT_PATH, 2.0, "live",
                    None, lambda: "running",
                    collector.FIXED_DIAGNOSTIC_CRASH_WRAPPER_PATH,
                    False, state)
            self.assertTrue(state["used"])
            link.assert_called_once()
            capture.assert_called_once()

    def test_only_once_and_only_live_native_sigabrt_while_tracer_running(self):
        for kwargs in (
                {"exit_code": 1},
                {"exit_code": -signal.SIGSEGV},
                {"exit_code": -signal.SIGABRT, "phase": "baseline"},
                {"exit_code": -signal.SIGABRT, "phase": "terminal"},
                {"exit_code": -signal.SIGABRT, "tracer": "exited"},
                {"exit_code": -signal.SIGABRT, "fallback_used": True}):
            with self.subTest(kwargs=kwargs):
                value, failure, state, link, capture = self.invoke(**kwargs)
                self.assertIsNone(value)
                self.assertIsInstance(failure, subprocess.CalledProcessError)
                self.assertEqual(state["used"], kwargs.get("fallback_used", False))
                link.assert_called_once()
                capture.assert_not_called()

    def test_preemptive_investigative_mode_uses_no_ordinary_inventory(self):
        value, failure, state, link, capture = self.invoke(preempt=True)
        self.assertIsNone(value)
        self.assertIsInstance(failure, ValueError)
        self.assertFalse(state["used"])
        link.assert_not_called()
        capture.assert_called_once()

    def test_preemptive_mode_requires_pinned_observer(self):
        with patch.object(collector, "link_inventory") as link, \
             patch.object(collector, "diagnostic_live_link_capture") as capture:
            with self.assertRaises(ValueError):
                collector.inspected_link_inventory(
                    collector.FIXED_DIAGNOSTIC_BPFT_PATH, 2.0, "live",
                    None, lambda: "running", None, True, {"used": False})
            link.assert_not_called()
            capture.assert_not_called()


if __name__ == "__main__":
    unittest.main()
