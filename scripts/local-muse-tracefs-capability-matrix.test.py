"""Offline-only capability campaign tests. No host tracefs/BPF calls."""
import errno
import importlib.util
from pathlib import Path
import re
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    "clack_capability_matrix",
    HERE / "local-muse-tracefs-capability-matrix.py")
cap = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cap)
SCOPE = "muse-one-" + "a" * 24


class FakeMatrix(cap.Matrix):
    def __init__(self, root, reject_ids=(), break_cleanup=False):
        self.reject_ids = set(reject_ids)
        self.break_cleanup = break_cleanup
        super().__init__(SCOPE, root)
        for directory in ("events", "instances"):
            (root / directory).mkdir()
        for name, data in (
            ("kprobe_events", ""),
            ("tracing_on", "1\n"),
            ("current_tracer", "nop\n"),
            ("events/enable", "0\n"),
            ("set_event", ""),
            ("error_log", ""),
        ):
            target = root / name
            target.parent.mkdir(exist_ok=True)
            target.write_text(data)
        self.actual_definitions = {}

    def preflight(self):
        self.baseline = cap.tracefs_snapshot(self.root, self.group)
        self.bpf_baseline = cap.bpf_ids()
        self.deadline = time.monotonic() + 55

    def _write_definition(self, line):
        if line.startswith("-:"):
            event = line.split("/", 1)[1]
            node = self.root / "events" / self.group / event
            if self.break_cleanup:
                raise OSError(errno.EPERM, "simulate blocked cleanup")
            if not node.exists():
                raise OSError(errno.ENOENT, "no registered event")
            shutil.rmtree(node)
            original = (self.root / "kprobe_events").read_text()
            entry = self.actual_definitions.pop(event)
            (self.root / "kprobe_events").write_text(
                original.replace(entry + "\n", ""))
            if not any((self.root / "events" / self.group).iterdir()):
                (self.root / "events" / self.group).rmdir()
            return
        part = line.split(" ", 1)[0]
        event = part.split("/", 1)[1]
        match = re.search(r"cap(\d{2})_", event)
        assert match is not None
        idx = int(match.group(1))
        cid = cap.cases()[idx - 1][0]
        if cid in self.reject_ids:
            with (self.root / "error_log").open("a") as f:
                f.write("error " + event +
                        ": BAD_FETCH_ARG at argument index=2 offset=8\n")
            raise OSError(errno.EINVAL, "simulated invalid fetcharg")
        self.actual_definitions[event] = line
        with (self.root / "kprobe_events").open("a") as f:
            f.write(line + "\n")
        node = self.root / "events" / self.group / event
        node.mkdir(parents=True, exist_ok=True)
        (node / "enable").write_text("0\n")
        kind = cap.cases()[idx - 1][3]
        suffix = line.split(" ", 2)[-1]
        fetch_fields = re.findall(r"(\w+)=([^ ]+)", suffix)
        lines = ["field:int common_pid; offset:4; size:4; signed:1;"]
        for name, expr in sorted(fetch_fields):
            if name == "sym" and "string" in expr:
                dtype, width, signed = "__data_loc char[]", 4, 0
            elif expr.endswith(":s32"):
                dtype, width, signed = "int", 4, 1
            elif expr.endswith(":s64"):
                dtype, width, signed = "long", 8, 1
            elif expr.endswith(":u32"):
                dtype, width, signed = "unsigned int", 4, 0
            else:
                dtype, width, signed = "unsigned long", 8, 0
            lines.append(f"field:{dtype} {name}; offset:8; "
                         f"size:{width}; signed:{signed};")
        (node / "format").write_text("\n".join(lines))


class CapabilityMatrixTests(unittest.TestCase):
    def execute(self, reject_ids=(), break_cleanup=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(cap, "bpf_ids", return_value={
                    "prog": (2, 157), "link": (3, 11)}):
                matrix = FakeMatrix(root, reject_ids, break_cleanup)
                before = cap.tracefs_snapshot(root, matrix.group)
                if break_cleanup:
                    with self.assertRaises(cap.MatrixError):
                        matrix.run()
                    self.assertTrue(matrix.registered)
                    return matrix, None
                report = matrix.run()
                self.assertEqual(report["cleanup"], "PASS")
                self.assertEqual(report["bpf_objects"], "UNCHANGED")
                self.assertEqual(report["unrelated_tracing"], "UNCHANGED")
                self.assertEqual(cap.tracefs_snapshot(root, matrix.group),
                                 before)
                self.assertFalse((root / "events" / matrix.group).exists())
                self.assertFalse((root / "instances" / matrix.group).exists())
                self.assertEqual((root / "kprobe_events").read_text(), "")
                return matrix, report

    def test_lattice_within_48_and_only_two_allowed_symbols(self):
        definitions = cap.cases()
        self.assertEqual(len(definitions), 40)
        self.assertLessEqual(len(definitions), 48)
        self.assertEqual({x[1] for x in definitions}, {cap.OUTER, cap.LOOKUP})
        self.assertEqual(len({x[0] for x in definitions}), len(definitions))
        self.assertEqual(sum(x[2] == "return" for x in definitions), 10)

    def test_all_supported_selects_four_definitions_and_cleans(self):
        matrix, result = self.execute()
        self.assertEqual(result["attempts"], 40)
        self.assertIsNone(result["gap"])
        self.assertEqual(result["selected"]["ids"],
                         ["B_FULL32", "C_S32", "D_FULL_NEST64", "E_S32"])
        self.assertEqual(len(result["selected"]["definitions"]), 4)
        self.assertIn("sym=+0(+0($arg1)):string",
                      result["selected"]["definitions"][2])
        self.assertFalse(matrix.registered)

    def test_first_EINVAL_does_not_stop_other_39_attempts(self):
        _, report = self.execute({"A_O_E"})
        self.assertEqual(report["attempts"], 40)
        self.assertEqual(report["gap"], "OUTER_ENTRY_SYMBOL")
        bad = report["tests"][0]
        self.assertEqual(bad["errno"], "EINVAL")
        self.assertEqual(bad["parser_category"], "BAD_FETCH_ARGUMENT")
        self.assertEqual(bad["parser_arg_index"], 2)
        self.assertEqual(bad["parser_offset"], 8)
        self.assertEqual(report["tests"][-1]["status"], "PASS")

    def test_kernel_copied_lookup_fallback_does_not_block(self):
        _, report = self.execute({"D_FULL_NEST64"})
        self.assertIsNone(report["gap"])
        self.assertEqual(report["selected"]["ids"],
                         ["B_FULL32", "C_S32", "D_FULL_NEST32", "E_S32"])

    def test_u64_read_over_u32_link_attr_is_never_selected(self):
        _, report = self.execute({"B_FULL32"})
        self.assertEqual(report["gap"], "OUTER_ARGS")
        self.assertEqual(next(x for x in report["tests"]
                              if x["id"] == "B_FULL64")["status"], "PASS")

    def test_missing_kernel_owned_string_yields_specific_target_gap(self):
        _, report = self.execute({
            "D_FULL_NEST64", "D_FULL_NEST32",
            "D_FULL_ARRAY64", "D_FULL_ARRAY32"})
        self.assertEqual(report["gap"], "KERNEL_COPIED_TARGET")
        self.assertEqual(report["cleanup"], "PASS")
        self.assertEqual(report["attempts"], 40)

    def test_missing_return_form_yields_specific_fd_gap(self):
        _, report = self.execute({"C_S32", "C_S64"})
        self.assertEqual(report["gap"], "OUTER_RETURN_FD")

    def test_cleanup_denial_never_reports_PASS(self):
        matrix, _ = self.execute(break_cleanup=True)
        self.assertEqual(matrix.attempts, 1)

    def test_invalid_group_and_untrusted_test_name_fail_closed(self):
        with self.assertRaises(cap.MatrixError):
            cap.Matrix("muse-one-invalid")
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(cap, "bpf_ids", return_value={
                    "prog": (), "link": ()}):
                matrix = FakeMatrix(Path(folder))
                with self.assertRaises(cap.MatrixError):
                    matrix._remove_event("unrelated_event")

    def test_sanitized_parser_never_returns_arbitrary_text(self):
        event = "cap05_" + "a" * 24
        log = ("unrelated service password: secret\n"
               + event + ": BAD_FETCH_ARG index=2 offset=8\n"
               "random kernel address 0xffff111222333444\n")
        reason, arg, offset = cap.normalized_parser_detail(
            log, event, "a=$arg1")
        self.assertEqual((reason, arg, offset), ("BAD_FETCH_ARGUMENT", 2, 8))
        self.assertNotIn("secret", str((reason, arg, offset)))
        self.assertNotIn("0xffff", str((reason, arg, offset)))

    def test_no_trace_capture_bpf_creation_or_tuning_in_matrix_source(self):
        src = (HERE / "local-muse-tracefs-capability-matrix.py").read_text()
        for banned in ("BPF_PROG_LOAD =", "BPF_LINK_CREATE =",
                       "trace_pipe", "tracing_on\", \"1", "sysctl -w",
                       "bpftrace --", "ollama serve", "trace_printk"):
            self.assertNotIn(banned, src)
        self.assertIn("BPF_PROG_NEXT_ID", src)
        self.assertIn("BPF_LINK_NEXT_ID", src)
        self.assertIn("MAX_ATTEMPTS = 48", src)
        self.assertIn("MAX_SECS = 60", src)


if __name__ == "__main__":
    unittest.main()
