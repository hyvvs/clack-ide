"""Synthetic-only arm, source-integrity and teardown tests; no BPF/SSH/Ollama."""

import hashlib
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


collector = load("local_muse_one_ebpf", "local-muse-one-ebpf.py")
supervisor = load("local_muse_pinned_helper_for_test", "local-muse-tcp-session.py")
PID = 1139
ATTEMPT = b"TCPMETA attempt 100150000 1139 1140 12345 11434 43000 149 0 ollama\n"
RETURN = b"TCPMETA send 100180000 1139 1140 12345 11434 43000 149 149 ollama\n"
PROBE_START = b"TCPREADY 1139 11434\n"
PROBE_END = b"TCPSUMMARY 1 1 0\n"
PROBE_TRACE = PROBE_START + ATTEMPT + RETURN + PROBE_END
ATTACHED = b"Attached 4 probes\n"
ATTACHING = b"Attaching 4 probes...\n"
BASE = {91: ("kprobe", "other_trace"), 92: ("tracepoint", "other_point")}
ARMED = {**BASE, 93: ("kprobe", "kprobe_tcp_send")}
LINKS_BASE = {100: {"id": 100, "type": "cgroup", "prog_id": 91}}
LINKS_ARMED = {**LINKS_BASE, 101: {
    "id": 101, "type": "kprobe_multi", "prog_id": 93, "retprobe": False,
    "func_cnt": 1, "missed": 0, "funcs": [{"func": "tcp_sendmsg"}],
    "pids": [{"pid": 55123, "comm": "bpftrace"}],
}}
TRACER_PID = 55123


class FakeTracer:
    """Pre-recorded anonymous pipes and an owned, interruptible fake process."""

    pid = 55123

    def __init__(self, output=PROBE_TRACE, errors=ATTACHED):
        stdout_read, stdout_write = os.pipe()
        stderr_read, stderr_write = os.pipe()
        os.write(stdout_write, output)
        os.write(stderr_write, errors)
        os.close(stdout_write)
        os.close(stderr_write)
        self.stdout = os.fdopen(stdout_read, "rb", buffering=0)
        self.stderr = os.fdopen(stderr_read, "rb", buffering=0)
        self.returncode = None
        self.signals = []

    def poll(self):
        return self.returncode

    def interrupt(self, how=signal.SIGINT):
        self.signals.append(how)
        self.returncode = -how

    def wait(self, timeout=None):
        if self.returncode is None:
            raise subprocess.TimeoutExpired("fake-tracer", timeout)
        return self.returncode


class OneEbpOfflineTests(unittest.TestCase):
    def test_existing_sources_are_exact_pinned_unchanged_versions(self):
        for filename, expected in (("local-muse-tcp.bt", collector.PROBE_SHA256),
                                   ("local-muse-tcp-session.py", collector.HELPER_SHA256)):
            self.assertEqual(hashlib.sha256((HERE / filename).read_bytes()).hexdigest(),
                             expected)
        self.assertIn(b"kprobe:tcp_sendmsg /pid == $1/",
                      (HERE / "local-muse-tcp.bt").read_bytes())

    def test_arm_requires_native_four_probe_notice_begin_and_new_owned_session_link(self):
        live_trace = PROBE_TRACE.replace(PROBE_END, b"")
        for evidence in ((live_trace, ATTACHED),
                         (ATTACHED + live_trace, b""),
                         (ATTACHING + live_trace, ATTACHED)):
            proof, count = collector.source_arm_evidence(
                *evidence, PID, 11434, BASE, ARMED,
                LINKS_BASE, LINKS_ARMED, TRACER_PID)
            self.assertTrue(proof)
            self.assertEqual(count, 1)
        for out, err, before, after, pid in (
                (live_trace, b"", BASE, ARMED, PID),
                (live_trace, ATTACHING, BASE, ARMED, PID),
                (live_trace, b"Attached 3 probes\n", BASE, ARMED, PID),
                (live_trace, ATTACHED + ATTACHED, BASE, ARMED, PID),
                (live_trace, ATTACHED + b"Lost 3 events\n", BASE, ARMED, PID),
                (live_trace, ATTACHED, BASE, BASE, PID),
                (live_trace, ATTACHED, BASE, ARMED, PID + 1),
                (live_trace, ATTACHED, BASE, {**BASE, 93: ("kprobe", "unrelated_send"),
                                              94: ("kprobe", "unrelated_send")}, PID),
                (PROBE_TRACE, ATTACHED, BASE, ARMED, PID),
                (b"TCPREADY 1139 22\n" + ATTEMPT, ATTACHED, BASE, ARMED, PID),
                (b"PRIVATE_MODEL_RESPONSE\n" + PROBE_TRACE, ATTACHED, BASE, ARMED, PID),
        ):
            with self.subTest(error=err, pid=pid):
                proof, _ = collector.source_arm_evidence(
                    out, err, pid, 11434, before, after,
                    LINKS_BASE, LINKS_ARMED, TRACER_PID)
                self.assertFalse(proof)

    def test_one_session_program_proves_entry_and_return_without_two_ids(self):
        # bpftrace 0.27's kprobe_session compiles paired source clauses into
        # ONE BPF_TRACE_KPROBE_SESSION program; the link is kprobe_multi.
        # Program ID 93 and link ID 101 are both absent in the baseline.
        proof, count = collector.source_arm_evidence(
            PROBE_START, ATTACHED, PID, 11434, BASE, ARMED,
            LINKS_BASE, LINKS_ARMED, TRACER_PID)
        self.assertTrue(proof)
        self.assertEqual(count, 1)
        self.assertEqual(collector.new_kprobes(BASE, ARMED), {93})
        self.assertEqual(collector.session_link_ids(
            LINKS_BASE, LINKS_ARMED, {93}, TRACER_PID), {101})
        self.assertEqual(collector.numeric_arm_line(PID, 11434, count),
                         "TCPARMED 1139 11434 4 1 0\n")

    def test_session_admission_rejects_unrelated_stale_or_unlinked_program(self):
        variants = [
            ("none", BASE, LINKS_ARMED, BASE),
            ("unrelated", {**BASE, 93: ("kprobe", "unrelated")}, LINKS_ARMED, BASE),
            ("prefix-lookalike", {**BASE, 93: ("kprobe", "kprobe_tcp_send_bad")},
             LINKS_ARMED, BASE),
            ("wrong-type", {**BASE, 93: ("tracepoint", "kprobe_tcp_send")},
             LINKS_ARMED, BASE),
            ("stale-id", ARMED, LINKS_ARMED, ARMED),
            ("two-unrelated", {**BASE, 93: ("kprobe", "other_a"),
                               94: ("kprobe", "other_b")}, LINKS_ARMED, BASE),
            ("entry-and-return-without-session-link",
             {**BASE, 93: ("kprobe", "kprobe_tcp_send"),
              94: ("kprobe", "kretprobe_tcp_s")}, LINKS_BASE, BASE),
            ("entry-and-return-programs-despite-session-link",
             {**ARMED, 94: ("kprobe", "kretprobe_tcp_s")}, LINKS_ARMED, BASE),
            ("missing-link", ARMED, LINKS_BASE, BASE),
            ("stale-link", ARMED, LINKS_ARMED, BASE),
        ]
        for label, programs, links, programs_before in variants:
            with self.subTest(label=label):
                base_links = links if label == "stale-link" else LINKS_BASE
                proof, _ = collector.source_arm_evidence(
                    PROBE_START, ATTACHED, PID, 11434,
                    programs_before, programs,
                    base_links, links, TRACER_PID)
                self.assertFalse(proof)

    def test_session_link_must_identify_exact_hook_owner_and_session_shape(self):
        good = LINKS_ARMED[101]
        incorrect = [
            {"prog_id": 91},
            {"type": "perf_event"},
            {"func_cnt": 2},
            {"funcs": [{"func": "tcp_v4_sendmsg"}]},
            {"funcs": []},
            {"retprobe": True},
            {"retprobe": None},
            {"missed": 1},
            {"pids": []},
            {"pids": [{"pid": TRACER_PID + 1, "comm": "bpftrace"}]},
            {"pids": [{"pid": TRACER_PID, "comm": "not-bpftrace"}]},
            {"pids": None},
        ]
        for bad in incorrect:
            with self.subTest(bad=bad):
                link = {**good, **bad}
                after = {**LINKS_BASE, 101: link}
                self.assertEqual(collector.session_link_ids(
                    LINKS_BASE, after, {93}, TRACER_PID), set())
                self.assertFalse(collector.source_arm_evidence(
                    PROBE_START, ATTACHED, PID, 11434, BASE, ARMED,
                    LINKS_BASE, after, TRACER_PID)[0])
        # Duplicate links for the same ID are not unique attachment proof.
        duplicate = {**LINKS_ARMED, 102: {**good, "id": 102}}
        self.assertFalse(collector.source_arm_evidence(
            PROBE_START, ATTACHED, PID, 11434, BASE, ARMED,
            LINKS_BASE, duplicate, TRACER_PID)[0])

    def test_link_snapshot_parser_is_bounded_and_rejects_ambiguous_ids(self):
        with patch.object(collector.subprocess, "run", return_value=SimpleNamespace(
                stdout=json.dumps([LINKS_BASE[100], LINKS_ARMED[101]]).encode())) as run:
            self.assertEqual(collector.link_inventory("bpftool", 1), LINKS_ARMED)
            self.assertEqual(run.call_args.args[0], ["bpftool", "-j", "link", "show"])
            self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        for body in (b"not-json", b"{}", b'[{"id":1,"type":"kprobe_multi"}]',
                     b'[{"id":1,"type":"kprobe_multi","prog_id":2},'
                     b'{"id":1,"type":"kprobe_multi","prog_id":3}]'):
            with self.subTest(body=body), patch.object(
                    collector.subprocess, "run",
                    return_value=SimpleNamespace(stdout=body)):
                with self.assertRaises((ValueError, json.JSONDecodeError)):
                    collector.link_inventory("bpftool", 1)

    def test_prearm_refuses_duplicate_ready_and_malformed_or_wrong_pid_meta(self):
        valid_meta = ATTEMPT
        proof, _ = collector.source_arm_evidence(
            PROBE_START + valid_meta, ATTACHED, PID, 11434, BASE, ARMED,
            LINKS_BASE, LINKS_ARMED, TRACER_PID)
        self.assertTrue(proof)
        for extra in (PROBE_START,
                      b"TCPREADY 1140 11434\n",
                      b"TCPMETA not-a-valid-row\n",
                      ATTEMPT.replace(b" 1139 ", b" 1140 "),
                      ATTEMPT.replace(b" 11434 ", b" 11433 "),
                      b"TCPSUMMARY 0 0 0\n"):
            with self.subTest(extra=extra):
                proof, _ = collector.source_arm_evidence(
                    PROBE_START + extra, ATTACHED, PID, 11434, BASE, ARMED,
                    LINKS_BASE, LINKS_ARMED, TRACER_PID)
                self.assertFalse(proof)

    def test_live_warning_fragments_wait_for_complete_lines_and_final_eof_is_strict(self):
        fragment = ATTACHED + b"WARNING: Return value disc"
        # The old whole-buffer classifier treats a fragmented benign warning
        # as an unknown warning while bpftrace is still writing to the pipe.
        self.assertTrue(collector.classify_source_output(b"", fragment)[1])
        cleaned, strict, notices, pending = collector.classify_live_output(
            PROBE_START, fragment)
        self.assertEqual(cleaned, PROBE_START)
        self.assertEqual(strict, b"")
        self.assertEqual(notices, 1)
        self.assertTrue(pending)
        self.assertFalse(collector.source_arm_evidence(
            PROBE_START, fragment, PID, 11434, BASE, ARMED,
            LINKS_BASE, LINKS_ARMED, TRACER_PID)[0])
        completed = ATTACHED + b"WARNING: Return value discarded.\n"
        self.assertTrue(collector.source_arm_evidence(
            PROBE_START, completed, PID, 11434, BASE, ARMED,
            LINKS_BASE, LINKS_ARMED, TRACER_PID)[0])

        # END warning requires the adjacent exact helper line. Its completed
        # first line alone must not cause an early abort during pipe assembly.
        end_warning = (b"/run/local-muse-ebpf/one-run/local-muse-tcp.bt:68:3-14: "
                       b"WARNING: Success\n")
        _, strict, _, pending = collector.classify_live_output(
            PROBE_START, ATTACHED + end_warning)
        self.assertEqual(strict, b"")
        self.assertTrue(pending)
        self.assertTrue(collector.classify_source_output(
            PROBE_START, ATTACHED + end_warning)[1])
        _, strict, _, pending = collector.classify_live_output(
            PROBE_START, ATTACHED + end_warning +
            b"Additional Info - helper: map_lookup_percpu_elem, retcode: 0\n")
        self.assertEqual(strict, b"")
        self.assertFalse(pending)

        # A completed unknown/error warning may never be ignored in live mode.
        _, strict, _, pending = collector.classify_live_output(
            PROBE_START, ATTACHED + b"ERROR: verifier rejected program\n")
        self.assertTrue(strict)
        self.assertFalse(pending)

    def test_readiness_requires_terminated_stdout_line_and_no_pending_error(self):
        for stdout, stderr in ((PROBE_START.rstrip(b"\n"), ATTACHED),
                               (PROBE_START, ATTACHED + b"ERROR: verifier"),
                               (PROBE_START + b"TCPMETA partial", ATTACHED)):
            with self.subTest(stdout=stdout, stderr=stderr):
                self.assertFalse(collector.source_arm_evidence(
                    stdout, stderr, PID, 11434, BASE, ARMED,
                    LINKS_BASE, LINKS_ARMED, TRACER_PID)[0])

    def test_read_only_program_inventory_rejects_missing_ambiguous_or_malformed(self):
        with patch.object(collector.subprocess, "run", return_value=SimpleNamespace(
                stdout=json.dumps([{"id": 1, "type": "kprobe", "name": "kprobe_tcp_send"},
                                   {"id": 2, "type": "tracepoint", "name": "other"}]).encode())) as run:
            self.assertEqual(collector.program_inventory("bpftool", 1),
                             {1: ("kprobe", "kprobe_tcp_send"), 2: ("tracepoint", "other")})
            self.assertEqual(run.call_args.args[0], ["bpftool", "-j", "prog", "show"])
            self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        for body in (b"not-json", b"{}", b'[{"id":1,"type":"kprobe","name":"n"},{"id":1,"type":"kprobe","name":"n"}]',
                     b'[{"id":1,"type":"not-kprobe"},42]'):
            with patch.object(collector.subprocess, "run", return_value=SimpleNamespace(stdout=body)):
                with self.assertRaises((ValueError, json.JSONDecodeError)):
                    collector.program_inventory("bpftool", 1)

    def test_exact_validated_compiler_and_end_warnings_are_benign_only_in_context(self):
        live = PROBE_TRACE.replace(PROBE_END, b"")
        warning = (b"/run/local-muse-ebpf/one-run/local-muse-tcp.bt:35:7-27: "
                   b"WARNING: Unnecessary cast: expression is already of type uint64\n"
                   b"    (uint64)arg0\n"
                   b"        ^^^^^\n")
        warning2 = b"WARNING: Return value discarded.\n"
        end = (b"/run/local-muse-ebpf/one-run/local-muse-tcp.bt:68:3-14: "
               b"WARNING: Success\n"
               b"Additional Info - helper: map_lookup_percpu_elem, retcode: 0\n")
        for source, diagnostics in ((live, warning + ATTACHED),
                                    (warning + live, ATTACHED + warning2),
                                    (live, ATTACHED + warning2 + warning)):
            proved, count = collector.source_arm_evidence(
                source, diagnostics, PID, 11434, BASE, ARMED,
                LINKS_BASE, LINKS_ARMED, TRACER_PID)
            self.assertTrue(proved)
            self.assertEqual(count, 1)
        clean, strict_stderr, notices = collector.classify_source_output(
            warning + PROBE_TRACE + end, ATTACHED + warning2)
        self.assertEqual(clean, PROBE_TRACE)
        self.assertEqual(strict_stderr, b"")
        self.assertEqual(notices, 1)
        rows, terminal, complete = supervisor.summarize_trace(
            clean, strict_stderr, PID, 11434, 1000, True, 0, True)
        self.assertTrue(complete)
        self.assertTrue(terminal.startswith("TCPSESSION complete "))
        for poisoned in (
            b"WARNING: Unknown compile behavior\n",
            b"/tmp/attacker/local-muse-tcp.bt:68:1-3: WARNING: Success\n",
            b"/run/local-muse-ebpf/one-run/local-muse-tcp.bt:68:1-3: WARNING: Success\n",
            b"Additional Info - helper: map_lookup_percpu_elem, retcode: 0\n",
            b"Lost 1 events\n",
            warning + b"    ERROR: verifier rejected program\n",
            warning + b"    WARNING: malicious unknown warning\n",
        ):
            with self.subTest(poisoned=poisoned):
                ok, _ = collector.source_arm_evidence(
                    live, ATTACHED + poisoned, PID, 11434, BASE, ARMED,
                    LINKS_BASE, LINKS_ARMED, TRACER_PID)
                self.assertFalse(ok)

    def test_numeric_readiness_never_exposes_kernel_pointer(self):
        line = collector.numeric_arm_line(PID, 11434, 1, 0)
        self.assertRegex(line, r"^TCPARMED (?:\d+ ?)+\n$")
        self.assertNotIn("12345", line)
        self.assertEqual(line.split(), ["TCPARMED", "1139", "11434", "4", "1", "0"])
        with self.assertRaises(ValueError):
            collector.numeric_arm_line(PID, 11434, -2, 0)

    def test_root_audit_keeps_exact_child_stream_hashes_but_no_socket_pointer(self):
        result = io.StringIO()
        with contextlib.redirect_stderr(result):
            collector.emit_content_free_audit(
                PROBE_TRACE, ATTACHED, PID, BASE, ARMED, -signal.SIGINT,
                True, True, False, True, True, False, False, 'none')
        lines = result.getvalue()
        self.assertIn("KERNEL_AUDIT_NATIVE_ATTACHED_FOUR_COUNT=1\n", lines)
        self.assertIn("KERNEL_AUDIT_MATCHING_BEGIN_COUNT=1\n", lines)
        self.assertIn("KERNEL_AUDIT_NEW_TARGET_PROGRAM_COUNT=1\n", lines)
        self.assertIn("KERNEL_AUDIT_READY_FIFO_WRITTEN=1\n", lines)
        self.assertIn("KERNEL_AUDIT_CONTROL_STOP_RECEIVED=1\n", lines)
        self.assertIn("KERNEL_AUDIT_TRACER_EXIT=-2\n", lines)
        self.assertIn("KERNEL_AUDIT_BPF_STDOUT_SHA256=" +
                      hashlib.sha256(PROBE_TRACE).hexdigest(), lines)
        self.assertIn("KERNEL_AUDIT_BPF_STDERR_SHA256=" +
                      hashlib.sha256(ATTACHED).hexdigest(), lines)
        self.assertNotIn("12345", lines)  # private raw socket pointer
        self.assertNotIn("TCPMETA ", lines)

    def test_raw_pointer_private_and_loss_missing_end_never_complete(self):
        sanitized, stderr, count = collector.classify_source_output(ATTACHED + PROBE_TRACE, b"")
        self.assertEqual(count, 1)
        self.assertEqual(sanitized, PROBE_TRACE)
        self.assertEqual(stderr, b"")
        cases = ((b"", True), (b"Lost 3 events\n", False),
                 (b"unexpected warning\n", False))
        for stderr, expected in cases:
            lines, status, completed = supervisor.summarize_trace(
                PROBE_TRACE, stderr, PID, 11434, 900, True, 0, True,
                socket_key=b"fixture-key")
            self.assertEqual(completed, expected)
            self.assertEqual(len(lines), 2)
            self.assertNotIn("12345", "\n".join(lines))
            self.assertTrue(status.startswith("TCPSESSION complete " if expected
                                              else "TCPSESSION partial "))
        _, _, completed = supervisor.summarize_trace(
            PROBE_TRACE.replace(PROBE_END, b""), b"", PID, 11434, 900, True, 0, True)
        self.assertFalse(completed)

    def test_a_nonreading_fifo_has_deadline_and_cannot_block_root_shutdown(self):
        with patch.object(collector.os, "set_blocking", return_value=None, create=True), \
                patch.object(collector.os, "write", side_effect=BlockingIOError), \
                patch.object(collector.select, "select", return_value=([], [], [])), \
                patch.object(collector.time, "monotonic", side_effect=[0, 0.05, 0.11]):
            with self.assertRaises(TimeoutError):
                collector.nonblocking_write(11, b"X" * (2 * 1024 * 1024), 0.1)

    def capture_fake(self, output=PROBE_TRACE, errors=ATTACHED,
                     inventories=None, identity_replaced=False, attach_timeout=2,
                     control_command=b"STOP\n", link_snapshots=None,
                     inventory_audit_fd=None, bpftool_identity=None):
        fake = FakeTracer(output, errors)
        ready_reader, ready_writer = os.pipe()
        output_reader, output_writer = os.pipe()
        control_reader, control_writer = os.pipe()
        ready_result = []
        stdout_result = []
        actual_read = os.read

        def capture_output(fd, value, _deadline):
            if fd == ready_writer:
                ready_result.append(value)
            elif fd == output_writer:
                stdout_result.append(value)
            else:
                raise AssertionError("Unexpected output FD")

        class SyntheticSelector:
            def __init__(self):
                self.registered = {}

            def register(self, stream, _events):
                self.registered[stream] = True

            def unregister(self, stream):
                del self.registered[stream]

            def get_map(self):
                return self.registered

            def select(self, timeout):
                picked = [stream for stream in self.registered if
                          stream != control_reader or control_command is not None and any(
                              row.startswith("TCPARMED ") for row in ready_result)]
                if not picked:
                    time.sleep(min(timeout, 0.01))
                return [(SimpleNamespace(fileobj=stream), 0) for stream in picked]

            def close(self):
                self.registered.clear()

        def fake_read(fd, count):
            if fd == control_reader:
                return control_command
            return actual_read(fd, count)

        arm_evidence = collector.source_arm_evidence

        def simulated_live_arm(out, err, pid, port, before, after,
                               before_links, after_links, tracer_pid):
            # The fake process preloads its END trailer. On real Linux END only
            # becomes readable *after* SIGINT/STOP, not while checking READY.
            return arm_evidence(out.replace(PROBE_END, b""), err,
                                pid, port, before, after, before_links,
                                after_links, tracer_pid)
        inventory_reads = 0

        def fake_inventory(*_args):
            nonlocal inventory_reads
            idx = inventory_reads
            inventory_reads += 1
            if inventories:
                return inventories[min(idx, len(inventories) - 1)]
            if idx == 0:
                return BASE
            return ARMED if fake.poll() is None else BASE
        link_reads = 0

        def fake_links(*_args):
            nonlocal link_reads
            idx = link_reads
            link_reads += 1
            if link_snapshots is not None:
                return link_snapshots[min(idx, len(link_snapshots) - 1)]
            if link_reads == 1:
                return LINKS_BASE
            return LINKS_ARMED if fake.poll() is None else LINKS_BASE
        stable = (18134, "84217", "/usr/local/bin/ollama", 991)
        state = {"identity_reads": 0}

        def read_identity(_pid, _port):
            state["identity_reads"] += 1
            if identity_replaced and state["identity_reads"] > 1:
                return (18135, *stable[1:])
            return stable

        helper = SimpleNamespace(
            read_identity=read_identity,
            graceful_shutdown_at=lambda start, seconds: start + 1.35,
            request_stop=lambda _child, how=signal.SIGINT: fake.interrupt(how),
            child_pdeathsig=lambda _parent: None,
            summarize_trace=supervisor.summarize_trace,
        )
        try:
            with patch.object(collector.subprocess, "Popen", return_value=fake), \
                    patch.object(collector, "program_inventory",
                                 side_effect=fake_inventory), \
                    patch.object(collector, "link_inventory",
                                 side_effect=fake_links), \
                    patch.object(collector.os, "set_blocking", return_value=None, create=True), \
                    patch.object(collector.os, "read", side_effect=fake_read), \
                    patch.object(collector.selectors, "DefaultSelector", SyntheticSelector), \
                    patch.object(collector, "source_arm_evidence", side_effect=simulated_live_arm), \
                    patch.object(collector, "nonblocking_write", side_effect=capture_output):
                code = collector.run_capture(PID, 3, ready_writer, control_reader, helper, "probe",
                                             "tracer", "bpftool", attach_timeout,
                                             stdout_fd=output_writer,
                                             inventory_audit_fd=inventory_audit_fd,
                                             bpftool_identity=bpftool_identity)
        finally:
            os.close(output_writer)
            os.close(control_reader)
            os.close(control_writer)
            try:
                os.close(ready_writer)
            except OSError:
                pass
            os.close(ready_reader)
            os.close(output_reader)
        ready = ready_result[0]
        result = stdout_result[0]
        return code, ready, result, fake

    def test_complete_fake_session_arms_before_final_legacy_import_stream(self):
        code, ready, result, fake = self.capture_fake()
        self.assertEqual(code, 0)
        self.assertEqual(ready, "TCPARMED 1139 11434 4 1 0\n")
        self.assertNotIn("TCPREADY", result)
        self.assertNotIn("Attached", result)
        self.assertNotIn("12345", result)
        self.assertEqual(result.splitlines()[-1].split()[:2], ["TCPSESSION", "complete"])
        self.assertEqual(fake.signals, [signal.SIGINT])

    def test_short_pinned_mode_logs_matcher_without_changing_readiness(self):
        # End-to-end synthetic capture path with program/link inventories
        # mocked in memory. No actual BPF program, root action or tool spawn.
        with tempfile.TemporaryFile(mode="w+b") as output:
            code, ready, result, _ = self.capture_fake(
                inventory_audit_fd=output.fileno(),
                bpftool_identity={"binarySha256":
                                  collector.FIXED_DIAGNOSTIC_BPFT_SHA256})
            output.seek(0)
            records = [json.loads(line) for line in output]
        self.assertEqual(code, 0)
        self.assertEqual(ready, "TCPARMED 1139 11434 4 1 0\n")
        self.assertIn("TCPSESSION complete ", result)
        self.assertTrue(records)
        self.assertTrue(all(row["kind"] == "matcher" for row in records))
        self.assertEqual(records[0]["targetProgramMatchCount"], 1)
        self.assertEqual(records[0]["validSessionLinkMatchCount"], 1)
        self.assertEqual(records[0]["programCandidates"][0]["nameClass"], "SESSION")
        self.assertEqual(records[0]["linkCandidates"][0]["targetClass"], "TCP_SENDMSG")

        # The non-pinned collection path never gains persistent object detail.
        with tempfile.TemporaryFile(mode="w+b") as output:
            code, ready, _, _ = self.capture_fake(
                inventory_audit_fd=output.fileno(), bpftool_identity=None)
            output.seek(0)
            self.assertEqual(output.read(), b"")
        self.assertEqual(code, 0)
        self.assertEqual(ready, "TCPARMED 1139 11434 4 1 0\n")

    def test_missing_attach_or_reused_pid_aborts_and_terminal_is_partial(self):
        for opts in ({"errors": b"", "attach_timeout": 0.15},
                     {"identity_replaced": True},
                     {"link_snapshots": [LINKS_BASE, LINKS_BASE],
                      "attach_timeout": 0.15}):
            with self.subTest(opts=opts):
                code, ready, result, fake = self.capture_fake(**opts)
                self.assertEqual(code, 1)
                self.assertEqual(ready, "TCPABORT 1 2\n")
                self.assertEqual(result.splitlines()[-1].split()[:2],
                                 ["TCPSESSION", "partial"])
                self.assertIn(signal.SIGINT, fake.signals)

    def test_invalid_stop_control_never_seals_an_armed_session(self):
        code, ready, output, fake = self.capture_fake(control_command=b"RUN-AGAIN\n")
        self.assertEqual(code, 1)
        self.assertTrue(ready.startswith("TCPARMED "))
        self.assertEqual(output.splitlines()[-1].split()[:2], ["TCPSESSION", "partial"])
        self.assertEqual(fake.signals, [signal.SIGINT])

    def test_scheduled_timeout_without_authenticated_stop_never_seals(self):
        code, ready, output, fake = self.capture_fake(control_command=None)
        self.assertEqual(code, 1)
        self.assertTrue(ready.startswith("TCPARMED "))
        self.assertEqual(output.splitlines()[-1].split()[:2],
                         ["TCPSESSION", "partial"])
        self.assertEqual(fake.signals, [signal.SIGINT])

    def test_kernel_programs_still_loaded_after_tracer_exit_fail_cleanup(self):
        code, ready, output, fake = self.capture_fake(inventories=[BASE, ARMED, ARMED])
        self.assertEqual(code, 1)
        self.assertTrue(ready.startswith("TCPARMED "))
        self.assertEqual(output.splitlines()[-1].split()[:2],
                         ["TCPSESSION", "partial"])


if __name__ == "__main__":
    unittest.main()
