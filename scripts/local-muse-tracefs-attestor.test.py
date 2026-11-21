"""Offline-only tracefs creation/FD proof tests. Never installs kernel probes."""

import importlib.util
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch


HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "clack_tracefs_attestor", HERE / "local-muse-tracefs-attestor.py")
att = importlib.util.module_from_spec(spec)
spec.loader.exec_module(att)

PID = 55123
START = 401020
LINK_ID = 101
PROG_ID = 93
PROG_FD = 7
LINK_FD = 9
ADDRESS = 0xffffffff81234567
RUN = "muse-one-" + "a" * 24


def events():
    return [
        {"kind": "enter", "tid": PID, "prog_fd": PROG_FD,
         "attach_type": att.SESSION_ATTACH, "flags": 0, "count": 1},
        {"kind": "lookup", "tid": PID, "count": 1,
         "target": "TCP_SENDMSG"},
        {"kind": "lookret", "tid": PID, "result": 0},
        {"kind": "leave", "tid": PID, "returned_fd": LINK_FD},
    ]


class FakeKernel:
    def __init__(self):
        self.fd_reads = 0
        self.start_ticks = START
        self.link_fdinfo = {"link_type": "kprobe_multi",
                            "link_id": LINK_ID, "prog_id": PROG_ID}
        self.program_fdinfo = {"prog_type": 2, "prog_id": PROG_ID}
        self.link = {"type": 8, "id": LINK_ID, "prog_id": PROG_ID,
                     "count": 1, "flags": 0, "missed": 0}
        self.program = {"type": 2, "id": PROG_ID}
        self.stale = False

    def pid_start(self, pid):
        return self.start_ticks if pid == PID else -1

    def fdinfo(self, pid, fd):
        self.fd_reads += 1
        if self.stale and self.fd_reads >= 3:
            return {}
        if pid != PID:
            raise att.AttestationError("FDINFO_UNAVAILABLE")
        if fd == LINK_FD:
            return dict(self.link_fdinfo)
        if fd == PROG_FD:
            return dict(self.program_fdinfo)
        raise att.AttestationError("FDINFO_UNAVAILABLE")

    def link_info(self, pid, fd):
        if pid != PID or fd != LINK_FD:
            raise att.AttestationError("BPF_INFO_UNAVAILABLE")
        return dict(self.link)

    def prog_info(self, pid, fd):
        if pid != PID or fd != PROG_FD:
            raise att.AttestationError("BPF_INFO_UNAVAILABLE")
        return dict(self.program)

    def target_address(self):
        return self.target


class TrustProofTests(unittest.TestCase):
    def reject(self, e, kernel=None):
        with self.assertRaises(att.AttestationError):
            att.verify_normalized(e, PID, START, LINK_ID, PROG_ID,
                                  kernel or FakeKernel())

    def test_session_accepted_with_all_three_kernel_proofs(self):
        proof = att.verify_normalized(events(), PID, START,
                                      LINK_ID, PROG_ID, FakeKernel())
        self.assertEqual(proof, {
            "result": "PASS", "session": "KPROBE_SESSION",
            "pid": PID, "link_id": LINK_ID, "program_id": PROG_ID,
            "target": "KERNEL_RESOLVED_TCP_SENDMSG", "owner_fd": LINK_FD,
        })

    def test_ordinary_kprobe_multi_rejected(self):
        e = events()
        e[0]["attach_type"] = att.ORDINARY_MULTI_ATTACH
        self.reject(e)

    def test_wrong_pid_and_missing_creation_rejected(self):
        e = events()
        e[0]["tid"] = PID + 1
        self.reject(e)
        e = events()
        e[1]["tid"] = PID + 1
        self.reject(e)
        e = events()
        e[2]["tid"] = PID + 1
        self.reject(e)
        self.reject([])

    def test_wrong_program_fd_and_id_rejected(self):
        e = events()
        e[0]["prog_fd"] = 15
        self.reject(e)
        k = FakeKernel()
        k.program_fdinfo["prog_id"] = 94
        self.reject(events(), k)
        k = FakeKernel()
        k.program["id"] = 94
        self.reject(events(), k)

    def test_wrong_link_id_and_program_join_rejected(self):
        k = FakeKernel()
        k.link_fdinfo["link_id"] = 102
        self.reject(events(), k)
        k = FakeKernel()
        k.link["id"] = 102
        self.reject(events(), k)
        k = FakeKernel()
        k.link["prog_id"] = 94
        self.reject(events(), k)
        e = events()
        e[3]["returned_fd"] = 10
        self.reject(e)

    def test_failed_creation_and_unpaired_or_duplicate_events(self):
        e = events()
        e[3]["returned_fd"] = -1
        self.reject(e)
        e = events()
        self.reject([e[3], e[0], e[1], e[2]])
        self.reject([e[0], e[0], e[1], e[2], e[3]])
        self.reject([e[0], e[1], e[2], e[3], e[3]])

    def test_wrong_target_or_multiple_lookup_symbols_rejected(self):
        e = events()
        e[1]["target"] = "OTHER"
        self.reject(e)
        e = events()
        e[1]["target"] = "tcp_sendmsg"
        self.reject(e)
        e = events()
        e[1]["count"] = 2
        self.reject(e)
        e = events()
        e[2]["result"] = -3
        self.reject(e)
        e = events()
        self.reject(e[:2] + e[1:])
        e = events()
        self.reject(e[:2] + [{"kind": "lookret", "tid": PID, "result": 0},
                              {"kind": "lookup", "tid": PID, "count": 1,
                               "target": "TCP_SENDMSG"}] + e[2:])
        k = FakeKernel()
        k.link["count"] = 2
        self.reject(events(), k)

    def test_fdinfo_missing_stale_fd_and_pid_reuse_rejected(self):
        k = FakeKernel()
        k.link_fdinfo.clear()
        self.reject(events(), k)
        k = FakeKernel()
        k.stale = True
        self.reject(events(), k)
        k = FakeKernel()
        k.start_ticks += 1
        self.reject(events(), k)

    def test_unsafe_or_missing_kernel_fields_rejected(self):
        for key in ("type", "id", "prog_id", "count", "missed", "flags"):
            with self.subTest(key=key):
                k = FakeKernel()
                del k.link[key]
                self.reject(events(), k)
        e = events()
        e[0]["flags"] = 1
        self.reject(e)
        e = events()
        e[0]["count"] = 2
        self.reject(e)
        k = FakeKernel()
        k.link["missed"] = 1
        self.reject(events(), k)

    def test_other_process_events_do_not_claim_verified_pid(self):
        e = [{"kind": "enter", "tid": PID + 1, "prog_fd": 6,
              "attach_type": att.SESSION_ATTACH, "flags": 0, "count": 1},
             {"kind": "lookup", "tid": PID + 1, "count": 1,
              "target": "TCP_SENDMSG"},
             {"kind": "lookret", "tid": PID + 1, "result": 0},
             {"kind": "leave", "tid": PID + 1, "returned_fd": 8}]
        proof = att.verify_normalized(e + events(), PID, START,
                                      LINK_ID, PROG_ID, FakeKernel())
        self.assertEqual(proof["result"], "PASS")
        self.reject(e)


class FakeTracefs(att.TracefsCreationAttestor):
    """Simulates tracefs virtual nodes under a temporary ordinary directory."""

    def __init__(self, path, mode="success"):
        (path / "instances").mkdir(exist_ok=True)
        (path / "kprobe_events").touch()
        super().__init__(RUN, 1, path)
        self.mode = mode
        self.unregistered = []

    def _mount_and_symbol_preflight(self):
        return None

    def _event_ctl(self, spec):
        if spec.startswith("-:"):
            self.unregistered.append(spec)
            return
        event = spec.split("/", 1)[1].split(" ", 1)[0]
        folder = self.instance / "events" / self.group / event
        folder.mkdir(parents=True, exist_ok=True)
        fields = ("progfd attach flags cnt" if event.startswith("enter_")
                  else "cnt sym" if event.startswith("lookup_")
                  else "result")
        (folder / "format").write_text(
            "field:int common_pid; offset:4; size:4; signed:1;\n" +
            "".join(("field:__data_loc char[] " if name == "sym"
                     else "field:u32 ") + name +
                    "; offset:8; size:4;\n"
                    for name in fields.split()))
        (folder / "enable").write_text("0\n")
        (self.instance / "trace_pipe").touch(exist_ok=True)
        (self.instance / "tracing_on").touch(exist_ok=True)

    def _check_loss(self):
        if self.mode == "loss":
            raise att.AttestationError("TRACEFS_EVENT_LOSS_OR_UNKNOWN")

    def _read_events(self):
        if self.mode == "timeout":
            self.failure = "TRACEFS_DEADLINE_EXCEEDED"
        else:
            self.stop_reader.wait()

    def _open_trace_pipe(self):
        return os.open(self.instance / "trace_pipe", os.O_RDONLY)

    def _destroy_instance(self):
        shutil.rmtree(self.instance)


class TracefsLifecycleTests(unittest.TestCase):
    def test_registration_only_checks_four_disabled_formats_then_cleans(self):
        with tempfile.TemporaryDirectory() as name:
            fs = FakeTracefs(Path(name))
            receipt = fs.check_registration_only()
            self.assertEqual(receipt["result"], "PASS")
            self.assertEqual(receipt["registered"], 4)
            self.assertEqual(receipt["bpf_objects_created"], 0)
            self.assertFalse(fs.instance.exists())
            self.assertEqual(len(fs.unregistered), 4)
            self.assertIsNone(fs.reader)
            self.assertIsNone(fs.read_fd)

    def test_registration_only_fails_closed_on_wrong_symbol_format(self):
        with tempfile.TemporaryDirectory() as name:
            class BrokenStringFormat(FakeTracefs):
                def _event_ctl(self, spec):
                    super()._event_ctl(spec)
                    if "lookup_" in spec and not spec.startswith("-:"):
                        event = spec.split("/", 1)[1].split(" ", 1)[0]
                        fmt = self.instance / "events" / self.group / event / "format"
                        fmt.write_text(fmt.read_text().replace(
                            "__data_loc char[] sym", "u32 sym"))
            fs = BrokenStringFormat(Path(name))
            with self.assertRaisesRegex(
                    att.AttestationError, "TRACEFS_KERNEL_STRING_FETCH_UNSUPPORTED"):
                fs.check_registration_only()
            self.assertFalse(fs.instance.exists())
            self.assertEqual(len(fs.unregistered), 3)

    def test_registration_only_does_not_accept_active_events(self):
        with tempfile.TemporaryDirectory() as name:
            class ActiveProbe(FakeTracefs):
                def _event_ctl(self, spec):
                    super()._event_ctl(spec)
                    if spec.startswith("p:") and "lookup_" in spec:
                        event = spec.split("/", 1)[1].split(" ", 1)[0]
                        enable = self.instance / "events" / self.group / event / "enable"
                        enable.write_text("1\n")
            fs = ActiveProbe(Path(name))
            with self.assertRaisesRegex(
                    att.AttestationError, "REGISTRATION_EVENT_NOT_DISABLED"):
                fs.check_registration_only()
            self.assertFalse(fs.instance.exists())

    def test_kptr_restrict_two_does_not_weaken_kernel_lookup_proof(self):
        with patch.object(att.Path, "read_text",
                          side_effect=AssertionError("no sysctl access")):
            self.assertEqual(att.verify_normalized(
                events(), PID, START, LINK_ID, PROG_ID,
                FakeKernel())["target"], "KERNEL_RESOLVED_TCP_SENDMSG")

    def test_scope_is_exact_and_events_are_numeric_only(self):
        group = "clack_muse_" + "a" * 24
        defs = att.trace_definitions(group)
        self.assertIn("progfd=+0($arg1):u32", defs[0])
        self.assertIn("attach=+8($arg1):u32", defs[0])
        self.assertIn("flags=+16($arg1):u32", defs[0])
        self.assertIn("cnt=+20($arg1):u32", defs[0])
        self.assertIn("result=$retval:s64", defs[1])
        self.assertEqual(len(defs), 4)
        self.assertIn("ftrace_lookup_symbols cnt=$arg2:u64", defs[2])
        self.assertIn("sym=+0(+0($arg1)):string", defs[2])
        self.assertIn("ftrace_lookup_symbols result=$retval:s64", defs[3])
        for fragment in ("+u0", "symstr", "$comm", "trace_printk",
                         "bpf_prog_load"):
            self.assertNotIn(fragment, " ".join(defs))
        with self.assertRaises(att.AttestationError):
            att.TracefsCreationAttestor("muse-one-bad")
        with self.assertRaises(att.AttestationError):
            att.TracefsCreationAttestor(RUN, 21)

    def test_trace_pipe_parser_discards_all_other_content(self):
        group = "clack_muse_" + "a" * 24
        suffix = "a" * 24
        src = (
            "trace-worker-55123 [004] d... 2001.123: " + group +
            ":enter_" + suffix + ": (bpf_kprobe_multi_link_attach+0x0/0x500) "
            "progfd=7 attach=56 flags=0 cnt=1")
        self.assertEqual(att.parse_trace_line(src, group), events()[0])
        # Linux trace_kprobe.c prints only the event name (not group name).
        src2 = src.replace(group + ":", "")
        self.assertEqual(att.parse_trace_line(src2, group), events()[0])
        ret = ("trace-worker-55123 [004] d... 2001.124: leave_" +
               suffix + ": (function+0x0/0x500) result=9")
        self.assertEqual(att.parse_trace_line(ret, group), events()[3])
        sym = ("trace-worker-55123 [004] d... 2001.124: lookup_" +
               suffix + ': (ftrace_lookup_symbols+0x0/0x500) '
               'cnt=1 sym="tcp_sendmsg"')
        self.assertEqual(att.parse_trace_line(sym, group), events()[1])
        lookup_ret = ("trace-worker-55123 [004] d... 2001.124: lookret_" +
                      suffix + ": (function+0x0/0x500) result=0")
        self.assertEqual(att.parse_trace_line(
            lookup_ret, group), events()[2])
        badsym = sym.replace("tcp_sendmsg", "udp_sendmsg")
        self.assertEqual(att.parse_trace_line(
            badsym, group)["target"], "OTHER")
        injected = sym.replace('"tcp_sendmsg"', '"tcp_sendmsg;secret"')
        self.assertEqual(att.parse_trace_line(
            injected, group)["target"], "OTHER")
        for text in ("private_payload", src + " attacker", src * 8):
            with self.assertRaises(att.AttestationError):
                att.parse_trace_line(text, group)

    def test_tracefs_cleanup_on_success(self):
        with tempfile.TemporaryDirectory() as name:
            fs = FakeTracefs(Path(name))
            fs.start()
            fs.events = events()
            self.assertEqual(fs.verify_and_close(
                PID, START, LINK_ID, PROG_ID, FakeKernel())["result"], "PASS")
            self.assertFalse(fs.instance.exists())
            self.assertEqual(len(fs.unregistered), 4)
            self.assertFalse(fs.enabled)

    def test_tracefs_cleanup_on_failure_and_timeout(self):
        for mode in ("failure", "timeout", "loss"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as name:
                fs = FakeTracefs(Path(name), mode=mode)
                fs.start()
                fs.events = events() if mode != "failure" else []
                with self.assertRaises(att.AttestationError):
                    fs.verify_and_close(PID, START, LINK_ID, PROG_ID,
                                        FakeKernel())
                self.assertFalse(fs.instance.exists())
                self.assertEqual(len(fs.unregistered), 4)

    def test_expired_deadline_never_emits_a_pass(self):
        with tempfile.TemporaryDirectory() as name:
            fs = FakeTracefs(Path(name))
            fs.start()
            fs.events = events()
            fs.deadline = 0.0
            with self.assertRaises(att.AttestationError):
                fs.verify_and_close(PID, START, LINK_ID, PROG_ID,
                                    FakeKernel())
            self.assertFalse(fs.instance.exists())
            self.assertEqual(len(fs.unregistered), 4)

    def test_preexisting_run_scoped_instance_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as name:
            fs = FakeTracefs(Path(name))
            fs.instance.mkdir()
            marker = fs.instance / "unrelated-owner-marker"
            marker.write_text("preserve")
            with self.assertRaises(att.AttestationError):
                fs.start()
            self.assertEqual(marker.read_text(), "preserve")
            self.assertEqual(fs.unregistered, [])

    def test_cleanup_error_fails_closed(self):
        with tempfile.TemporaryDirectory() as name:
            fs = FakeTracefs(Path(name))
            fs.start()
            fs.events = events()
            fs._destroy_instance = lambda: (_ for _ in ()).throw(
                OSError("injected cleanup error"))
            with self.assertRaisesRegex(att.AttestationError,
                                        "TRACEFS_CLEANUP_FAILED"):
                fs.verify_and_close(PID, START, LINK_ID, PROG_ID,
                                    FakeKernel())
            self.assertEqual(len(fs.unregistered), 4)
            self.assertTrue(fs.instance.exists())

    def test_no_new_bpf_programs_or_links_from_attestor(self):
        source = (HERE / "local-muse-tracefs-attestor.py").read_text()
        self.assertNotIn("BPF_PROG_LOAD", source)
        self.assertNotIn("BPF_LINK_CREATE", source)
        self.assertNotIn("bpf_link_create(", source)
        self.assertNotIn("bpftrace ", source)
        self.assertIn("BPF_OBJ_GET_INFO_BY_FD", source)
        self.assertIn("kprobe_events", source)
        self.assertNotIn("trace_printk", source)

    def test_pinned_uapi_constants_and_offsets(self):
        src = (HERE.parent / "src-tauri/target/clack-bpftool-fixed-source" /
               "libbpf/include/uapi/linux/bpf.h").read_text()
        enum = re.search(r"enum bpf_attach_type \{(.*?)\n\};", src, re.S)
        self.assertIsNotNone(enum)
        names = re.findall(r"^\s*(BPF_[A-Z0-9_]+)\s*(?:=[^,]+)?,",
                           enum.group(1), re.M)
        self.assertEqual(names.index("BPF_TRACE_KPROBE_SESSION"),
                         att.SESSION_ATTACH)
        self.assertEqual(names.index("BPF_TRACE_KPROBE_MULTI"),
                         att.ORDINARY_MULTI_ATTACH)
        self.assertEqual((att._LinkCreatePrefix.prog_fd.offset,
                          att._LinkCreatePrefix.attach_type.offset,
                          att._LinkCreatePrefix.kprobe_multi_flags.offset,
                          att._LinkCreatePrefix.kprobe_multi_cnt.offset),
                         (0, 8, 16, 20))
        self.assertIn("__u32\t\tattach_type;\t/* attach type */", src)
        self.assertIn("__u32\t\tprog_fd;\t/* eBPF program to attach */", src)


if __name__ == "__main__":
    unittest.main()
