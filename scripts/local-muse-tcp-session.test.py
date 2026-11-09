"""Offline-only tests: no bpftrace binary, privileges, sockets or inference."""
import importlib.util
from pathlib import Path
import signal
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("local-muse-tcp-session.py")
spec = importlib.util.spec_from_file_location("local_muse_tcp_session", SOURCE)
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)

PID = 1139
READY = b"TCPREADY 1139 11434\n"
ATTEMPT = b"TCPMETA attempt 100150000 1139 1140 12345 11434 43000 149 0 ollama\n"
RETURN = b"TCPMETA send 100180000 1139 1140 12345 11434 43000 149 149 ollama\n"
SUMMARY = b"TCPSUMMARY 1 1 0\n"


def audit(output=READY + ATTEMPT + RETURN + SUMMARY, errors=b"", stopped=True,
          exit_code=0, identity_ok=True):
    return session.summarize_trace(output, errors, PID, 11434, 1800000,
                                   stopped, exit_code, identity_ok, b"test-key")


class LocalMuseTcpOfflineTests(unittest.TestCase):
    def test_exact_pid_ipv4_loopback_and_no_ssh_probes(self):
        source = SOURCE.with_name("local-muse-tcp.bt").read_text()
        self.assertIn("kprobe:tcp_sendmsg /pid == $1/", source)
        self.assertIn("kretprobe:tcp_sendmsg /pid == $1 && @send_sk[tid]/", source)
        for predicate in ("skc_family == 2", "skc_num == $2",
                          "skc_rcv_saddr == 0x0100007f", "skc_daddr == 0x0100007f"):
            self.assertIn(predicate, source)
        self.assertNotIn("comm ==", source)
        self.assertNotIn("kprobe:tcp_recvmsg", source)
        self.assertIn("TCPREADY", source)
        self.assertIn("TCPSUMMARY", source)
        self.assertIn("@collision_total = count()", source)

    def test_listener_identity_exact_inode_port_ipv4_loopback(self):
        expected = " 0: 0100007F:2CAA 00000000:0000 0A 0 0 0 0 0 84217 0"
        other = " 1: 00000000:2CAA 00000000:0000 0A 0 0 0 0 0 84218 0"
        self.assertEqual(session.listener_inode([expected, other], {"84217", "84218"}, 11434), "84217")
        with self.assertRaises(ValueError):
            session.listener_inode([other], {"84218"}, 11434)
        with self.assertRaises(ValueError):
            session.listener_inode([expected], {"99999"}, 11434)
        with self.assertRaises(ValueError):
            session.listener_inode([expected, expected.replace("84217", "84219")],
                                   {"84217", "84219"}, 11434)

    def test_duration_enforced_and_not_extendable(self):
        for seconds in (0, -1, 1801, 999999):
            with self.assertRaises(ValueError):
                session.validate_scope(PID, 11434, seconds)
        for pid, port in ((0, 11434), (1139, 22), (1139, 11435)):
            with self.assertRaises(ValueError):
                session.validate_scope(pid, port, 1800)
        session.validate_scope(PID, 11434, 1800)
        self.assertFalse(session.deadline_reached(10.0, 1809.99, 1800))
        self.assertTrue(session.deadline_reached(10.0, 1810.0, 1800))
        self.assertTrue(session.deadline_reached(10.0, 1811.0, 1800))
        self.assertEqual(session.graceful_shutdown_at(10.0, 1800), 1805.0)
        self.assertEqual(session.graceful_shutdown_at(10.0, 4), 12.0)
        _, status, complete = session.summarize_trace(READY + ATTEMPT + RETURN + SUMMARY, b"",
            PID, 11434, 1800001, True, 0, True, b"test-key")
        self.assertFalse(complete)
        self.assertIn("partial", status)

    def test_valid_signed_return_and_pseudonymized_socket(self):
        rows, status, complete = audit()
        self.assertTrue(complete)
        self.assertEqual(status, "TCPSESSION complete 1 1 0 0 1800000")
        self.assertEqual(len(rows), 2)
        self.assertNotIn("12345", " ".join(rows))
        self.assertEqual(rows[0].split()[5], rows[1].split()[5])
        failed = RETURN.replace(b"149 149 ollama", b"149 -11 ollama")
        rows, status, complete = audit(READY + ATTEMPT + failed + SUMMARY)
        self.assertTrue(complete, "negative kernel returns are valid observed errors, not lost events")
        self.assertIn(" -11 ollama", rows[1])

    def test_loss_missing_summary_or_unpaired_write_must_fail(self):
        for trace, warnings in (
            (READY + ATTEMPT + RETURN, b""),
            (READY + ATTEMPT + SUMMARY.replace(b"1 1 0", b"1 0 0"), b""),
            (READY + ATTEMPT + RETURN + SUMMARY, b"Lost 3 events"),
            (READY + ATTEMPT + RETURN + SUMMARY, b"unexpected bpftrace error"),
            (READY + ATTEMPT + RETURN + SUMMARY.replace(b"1 1 0", b"2 1 0"), b""),
            (READY + ATTEMPT + RETURN + SUMMARY.replace(b"1 1 0", b"1 1 1"), b""),
            (ATTEMPT + RETURN + SUMMARY, b""),
            (READY.replace(b"1139", b"1140") + ATTEMPT + RETURN + SUMMARY, b""),
        ):
            with self.subTest(trace=trace[-30:], warnings=warnings):
                _, status, complete = audit(trace, warnings)
                self.assertFalse(complete)
                self.assertIn("TCPSESSION partial", status)
        _, status, _ = audit(READY + ATTEMPT + RETURN + SUMMARY, b"Lost 3 events")
        self.assertEqual(status.split()[5], "3")

    def test_malformed_or_out_of_scope_process_and_payload_rejected(self):
        for bad in (ATTEMPT.replace(b"1139 1140", b"1141 1140"),
                    ATTEMPT.replace(b"11434 43000", b"22 43000"),
                    b"PRIVATE_PROMPT password foo\n"):
            rows, status, complete = audit(READY + bad + RETURN + SUMMARY)
            self.assertFalse(complete)
            self.assertTrue(all("PRIVATE_PROMPT" not in row for row in rows))
            self.assertIn("partial", status)

    def test_shutdown_target_is_only_tracer_group_and_unexpected_exit_fails(self):
        class Tracer:
            pid = 55123
            @staticmethod
            def poll():
                return None
        with patch.object(session.os, "killpg", create=True) as kill:
            session.request_stop(Tracer(), signal.SIGINT)
            session.request_stop(Tracer(), getattr(signal, "SIGKILL", 9))
            self.assertEqual(kill.call_args_list[0].args, (55123, signal.SIGINT))
            self.assertEqual(kill.call_args_list[1].args, (55123, getattr(signal, "SIGKILL", 9)))
        for stopped, status_code, identity_ok in ((False, 0, True),
                                                  (True, 1, True), (True, 0, False)):
            _, status, complete = audit(stopped=stopped, exit_code=status_code,
                                        identity_ok=identity_ok)
            self.assertFalse(complete)
            self.assertTrue(status.startswith("TCPSESSION partial"))


if __name__ == "__main__":
    unittest.main()
