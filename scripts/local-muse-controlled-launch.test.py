#!/usr/bin/env python3
"""Adversarial offline proof checks. No kernel, BPF, HTTP, or sudo actions."""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("clack_controlled_ebpf", HERE / "local-muse-one-ebpf.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

PID, LINK, PROG = 55123, 101, 93
IDENTITY = (32155, 9, 24)
BASE = {91: ("kprobe", "legacy"), 92: ("perf_event", "old")}
LIVE = {**BASE, PROG: ("kprobe", "unreliable_indexed_btf_name")}
LINK_BASE = {100: {"id": 100, "type": "cgroup", "prog_id": 91}}
LINK_LIVE = {**LINK_BASE, LINK: {
    "id": LINK, "type": "kprobe_multi", "prog_id": PROG,
    "retprobe": False, "func_cnt": 1, "missed": 0,
    "funcs": [],  # Actual historical run had unresolved function metadata.
    # Optional pids omitted, as on the actual host.
}}


class ControlledLaunchTests(unittest.TestCase):
    def test_exact_live_executable_argv_pid_birth_and_bytes(self):
        # Pure filesystem stand-in for procfs, requiring no root or real BPF.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / "bpftrace"
            binary.write_bytes(b"reviewed-pinned-bpftrace")
            probe = root / "local-muse-tcp.bt"
            probe.write_bytes(b"reviewed probe")
            proc = root / "proc" / str(PID)
            proc.mkdir(parents=True)
            (proc / "status").write_text("Name:\tbpftrace\nUid:\t0\t0\t0\t0\n",
                                         encoding="ascii")
            def stat_birth(ticks):
                (proc / "stat").write_text(
                    f"{PID} (bpftrace) " + " ".join(["S", *["0"] * 18, str(ticks)]) +
                    "\n", encoding="ascii")
            stat_birth(IDENTITY[0])
            expected = [os.fsencode(str(binary)), b"-B", b"line",
                        os.fsencode(str(probe)), b"1139", b"11434"]
            (proc / "cmdline").write_bytes(b"\0".join(expected) + b"\0")
            os.link(binary, proc / "exe")
            original_path = Path
            def fake_path(value):
                return root / "proc" if str(value) == "/proc" else original_path(value)
            with patch.object(collector, "Path", side_effect=fake_path), \
                 patch.object(collector, "PINNED_TRACER_PATH", binary), \
                 patch.object(collector, "PINNED_TRACER_SHA256",
                              hashlib.sha256(binary.read_bytes()).hexdigest()), \
                 patch.object(collector.os, "readlink", return_value=str(binary)), \
                 patch.object(collector, "verified_file", return_value=probe) as pin:
                confirmed = collector.tracer_process_identity(
                    PID, binary, probe, 1139, verify_bytes=True)
                self.assertEqual(confirmed[0], IDENTITY[0])
                pin.assert_called_with(probe, collector.PROBE_SHA256)
                stat_birth(IDENTITY[0] + 1)
                self.assertNotEqual(collector.tracer_process_identity(
                    PID, binary, probe, 1139), confirmed)
                stat_birth(IDENTITY[0])
                (proc / "cmdline").write_bytes(b"\0".join([*expected[:-1], b"443"]) + b"\0")
                with self.assertRaises(ValueError):
                    collector.tracer_process_identity(PID, binary, probe, 1139)
                (proc / "cmdline").write_bytes(b"\0".join(expected) + b"\0")
                (proc / "status").write_text("Uid:\t1000\t1000\t1000\t1000\n",
                                             encoding="ascii")
                with self.assertRaises(ValueError):
                    collector.tracer_process_identity(PID, binary, probe, 1139)
                (proc / "status").write_text("Uid:\t0\t0\t0\t0\n", encoding="ascii")
                binary.write_bytes(b"tampered")
                with self.assertRaises(ValueError):
                    collector.tracer_process_identity(
                        PID, binary, probe, 1139, verify_bytes=True)

    def qualify(self, programs=None, links=None, baseline=None, link_baseline=None,
                fd_rows=None, identity=IDENTITY):
        with patch.object(collector, "owned_bpf_link_fds",
                          return_value=fd_rows if fd_rows is not None
                          else [(LINK, PROG, "kprobe_multi")]) as owned:
            result = collector.controlled_session_objects(
                BASE if baseline is None else baseline,
                LIVE if programs is None else programs,
                LINK_BASE if link_baseline is None else link_baseline,
                LINK_LIVE if links is None else links,
                PID, identity, collector.PINNED_TRACER_PATH, "pinned-probe", 1139)
        if result != (set(), set()):
            self.assertEqual(owned.call_count, 1)
        return result

    def test_exact_host_representation_arms_only_with_owned_fd_join(self):
        self.assertEqual(self.qualify(), ({PROG}, {LINK}))
        self.assertEqual(self.qualify(fd_rows=[]), (set(), set()))
        self.assertEqual(self.qualify(fd_rows=[(LINK, PROG + 1, "kprobe_multi")]),
                         (set(), set()))
        self.assertEqual(self.qualify(fd_rows=[(LINK, PROG, "perf_event")]),
                         (set(), set()))
        self.assertEqual(self.qualify(fd_rows=[
            (LINK, PROG, "kprobe_multi"), (102, PROG, "kprobe_multi")]),
            (set(), set()))
        self.assertEqual(self.qualify(identity=None), (set(), set()))

    def test_wrong_program_and_link_identity_fail_closed(self):
        for label, programs, links, base, baseline in (
            ("no program", BASE, LINK_LIVE, None, None),
            ("stale program", LIVE, LINK_LIVE, LIVE, None),
            ("wrong program type", {**BASE, PROG: ("perf_event", "other")}, LINK_LIVE, None, None),
            ("extra return", {**LIVE, 94: ("kprobe", "return")}, LINK_LIVE, None, None),
            ("stale link", LIVE, LINK_LIVE, None, LINK_LIVE),
            ("no link", LIVE, LINK_BASE, None, None),
            ("extra multi link", LIVE, {**LINK_LIVE, 102: {**LINK_LIVE[LINK], "id": 102}},
             None, None),
        ):
            with self.subTest(label=label):
                self.assertEqual(self.qualify(programs, links, base, baseline), (set(), set()))

    def test_kernel_shape_and_explicit_contradictions_fail_closed(self):
        wrong = (
            {"prog_id": 91}, {"type": "tracing"}, {"retprobe": True},
            {"retprobe": None}, {"func_cnt": 2}, {"func_cnt": True},
            {"missed": 1}, {"missed": "0"},
            {"funcs": [{"func": "tcp_v4_sendmsg"}]},
            {"funcs": [{"func": "tcp_sendmsg"}, {"func": "other"}]},
            {"pids": [{"pid": PID + 1, "comm": "bpftrace"}]},
            {"pids": "forged"},
        )
        for changed in wrong:
            with self.subTest(changed=changed):
                links = {**LINK_BASE, LINK: {**LINK_LIVE[LINK], **changed}}
                self.assertEqual(self.qualify(links=links), (set(), set()))
        self.assertEqual(self.qualify(links={
            **LINK_BASE, LINK: {**LINK_LIVE[LINK], "pids": [{"pid": PID, "comm": "other"}]}}),
            ({PROG}, {LINK}))  # FD ownership supersedes mutable comm.

    def test_binary_pin_requires_digest_and_exact_version(self):
        fake_result = SimpleNamespace(returncode=0,
                                     stdout=collector.PINNED_TRACER_VERSION, stderr=b"")
        features = SimpleNamespace(returncode=0,
                                   stdout=b"Probe types\n  kprobe_multi: yes  uprobe_multi: yes\n"
                                          b"  kprobe_session: yes  iter: yes\n",
                                   stderr=b"")
        with patch.object(collector, "pinned_diagnostic_file",
                          return_value=collector.PINNED_TRACER_PATH) as pin, \
             patch.object(collector.platform, "uname",
                          return_value=SimpleNamespace(release=collector.PINNED_LAB_KERNEL)), \
             patch.object(collector.subprocess, "run",
                          side_effect=[fake_result, features]) as command:
            with patch.object(collector.Path, "stat",
                              return_value=SimpleNamespace(st_mode=0o755)):
                self.assertEqual(collector.qualified_tracer(), collector.PINNED_TRACER_PATH)
            self.assertEqual(pin.call_count, 2)
            self.assertEqual(command.call_count, 2)
            self.assertTrue(all(call.args[1] == collector.PINNED_TRACER_SHA256
                                for call in pin.call_args_list))
        for result in (SimpleNamespace(returncode=0, stdout=b"bpftrace v0.27\n", stderr=b""),
                       SimpleNamespace(returncode=0,
                                       stdout=collector.PINNED_TRACER_VERSION, stderr=b"warning"),
                       SimpleNamespace(returncode=1, stdout=b"", stderr=b"")):
            with patch.object(collector, "pinned_diagnostic_file",
                              return_value=collector.PINNED_TRACER_PATH), \
                 patch.object(collector.subprocess, "run", return_value=result), \
                 patch.object(collector.platform, "uname",
                              return_value=SimpleNamespace(release=collector.PINNED_LAB_KERNEL)), \
                 patch.object(collector.Path, "stat",
                              return_value=SimpleNamespace(st_mode=0o755)):
                with self.assertRaises(ValueError):
                    collector.qualified_tracer()
        for body in (b"kprobe_multi: yes kprobe_session: no\n",
                     b"kprobe_multi: no kprobe_session: yes\n",
                     b"kprobe_session: yes\n", b"kprobe_multi: yes\n",
                     b"kprobe_multi: yes kprobe_session: yes kprobe_session: yes\n"):
            with self.subTest(feature_report=body), \
                 patch.object(collector, "pinned_diagnostic_file",
                              return_value=collector.PINNED_TRACER_PATH), \
                 patch.object(collector.platform, "uname",
                              return_value=SimpleNamespace(release=collector.PINNED_LAB_KERNEL)), \
                 patch.object(collector.subprocess, "run", side_effect=[
                     fake_result, SimpleNamespace(returncode=0, stdout=body, stderr=b"")]), \
                 patch.object(collector.Path, "stat",
                              return_value=SimpleNamespace(st_mode=0o755)):
                with self.assertRaises(ValueError):
                    collector.qualified_tracer()
        with patch.object(collector.platform, "uname",
                          return_value=SimpleNamespace(release="unreviewed-kernel")):
            with self.assertRaises(ValueError):
                collector.qualified_tracer()

    def test_actual_fdinfo_parser_rejects_wrong_and_missing_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            proc = root / "proc" / str(PID)
            (proc / "fd").mkdir(parents=True)
            (proc / "fdinfo").mkdir()
            (proc / "fd" / "7").write_bytes(b"")
            info = proc / "fdinfo" / "7"
            valid_fdinfo = ("pos:\t0\nflags:\t02000000\n"
                            "link_type:\tkprobe_multi\nlink_id:\t101\nprog_id:\t93\n"
                            "kprobe_cnt:\t1\nmissed:\t0\n"
                            "cookie\t func\n0\t untrusted_redacted_symbol\n")
            info.write_text(valid_fdinfo, encoding="ascii")
            original_path = Path
            def fake_path(value):
                return root / "proc" if str(value) == "/proc" else original_path(value)
            with patch.object(collector, "Path", side_effect=fake_path), \
                 patch.object(collector, "tracer_process_identity", return_value=IDENTITY), \
                 patch.object(collector.os, "readlink") as fd_target:
                # bpf_link_prime() creates "bpf_link"; bpf_link_new_fd()
                # creates "bpf-link". Both kernel names are valid, but
                # neither may bypass the exact fdinfo owner/ID join.
                for name in ("anon_inode:bpf_link", "anon_inode:[bpf_link]",
                             "anon_inode:bpf-link", "anon_inode:[bpf-link]"):
                    with self.subTest(name=name):
                        fd_target.return_value = name
                        self.assertEqual(collector.owned_bpf_link_fds(
                            PID, IDENTITY, collector.PINNED_TRACER_PATH, "probe", 1139),
                            [(LINK, PROG, "kprobe_multi")])
                for name in ("anon_inode:bpf_link_other", "anon_inode:[bpf_map]",
                             "anon_inode:socket"):
                    with self.subTest(rejected=name):
                        fd_target.return_value = name
                        self.assertEqual(collector.owned_bpf_link_fds(
                            PID, IDENTITY, collector.PINNED_TRACER_PATH, "probe", 1139), [])
                fd_target.return_value = "anon_inode:bpf_link"
                for data in (
                    "link_type:\tkprobe_multi\nlink_id:\t101\n", # no prog
                    "link_type:\tkprobe_multi\nlink_id:\t101\nprog_id:\t0\n",
                    "link_type:\tkprobe_multi\nlink_id:\t101\nlink_id:\t102\nprog_id:\t93\n",
                    valid_fdinfo.replace("kprobe_cnt:\t1\n", ""),
                    valid_fdinfo.replace("missed:\t0\n", ""),
                    valid_fdinfo.replace("kprobe_cnt:\t1\n", "kprobe_cnt:\t2\n"),
                    valid_fdinfo.replace("missed:\t0\n", "missed:\t1\n"),
                    valid_fdinfo + "prog_id:\t94\n",
                ):
                    with self.subTest(data=data):
                        info.write_text(data, encoding="ascii")
                        with self.assertRaises(ValueError):
                            collector.owned_bpf_link_fds(
                                PID, IDENTITY, collector.PINNED_TRACER_PATH, "probe", 1139)
                with patch.object(collector, "tracer_process_identity",
                                  side_effect=[IDENTITY, (IDENTITY[0] + 1, *IDENTITY[1:])]):
                    with self.assertRaises(ValueError):
                        collector.owned_bpf_link_fds(
                            PID, IDENTITY, collector.PINNED_TRACER_PATH, "probe", 1139)


if __name__ == "__main__":
    unittest.main()
