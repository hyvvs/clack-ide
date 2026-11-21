"""Offline-only normalized session matcher diagnostics; no BPF, root, or SSH."""

import importlib.util
import json
import tempfile
from pathlib import Path
import unittest


HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "local_muse_predicate_collector", HERE / "local-muse-one-ebpf.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

TRACER = 55123
PROGRAMS_BASE = {
    91: ("kprobe", "other_trace"),
    92: ("tracepoint", "other_point"),
}
PROGRAMS_LIVE = {**PROGRAMS_BASE, 93: ("kprobe", "kprobe_tcp_send")}
LINKS_BASE = {100: {"id": 100, "type": "cgroup", "prog_id": 91}}
LINKS_LIVE = {**LINKS_BASE, 101: {
    "id": 101, "type": "kprobe_multi", "prog_id": 93,
    "retprobe": False, "func_cnt": 1, "missed": 0,
    "funcs": [{"func": "tcp_sendmsg"}],
    "pids": [{"pid": TRACER, "comm": "bpftrace"}],
}}


class PredicateDiagnosticTests(unittest.TestCase):
    def inspect(self, programs=None, links=None, baseline_programs=None,
                baseline_links=None, tracer=TRACER):
        programs = PROGRAMS_LIVE if programs is None else programs
        links = LINKS_LIVE if links is None else links
        baseline_programs = (PROGRAMS_BASE if baseline_programs is None
                             else baseline_programs)
        baseline_links = LINKS_BASE if baseline_links is None else baseline_links
        report = collector.matcher_inventory_diagnostic(
            baseline_programs, programs, baseline_links, links, tracer)
        matched = collector.new_kprobes(baseline_programs, programs)
        strict_links = collector.session_link_ids(
            baseline_links, links, matched, tracer)
        self.assertEqual(report["targetProgramMatchCount"], len(matched))
        self.assertEqual(report["validSessionLinkMatchCount"], len(strict_links))
        self.assertLess(len(json.dumps(report).encode()), collector.MAX_PREDICATE_RECORD)
        return report

    def test_01_valid_single_session_and_actual_strict_gate(self):
        report = self.inspect()
        self.assertEqual(report["freshProgramCount"], 1)
        self.assertEqual(report["freshLinkCount"], 1)
        self.assertEqual(report["uniqueTargetProgram"], "PASS")
        self.assertEqual(report["uniqueSessionLink"], "PASS")
        self.assertEqual(report["completeLinkCandidateCount"], 1)
        self.assertTrue(all(v == "PASS" for v in
                            report["programCandidates"][0]["predicates"].values()))
        self.assertTrue(all(v == "PASS" for v in
                            report["linkCandidates"][0]["predicates"].values()))
        self.assertTrue(collector.source_arm_evidence(
            b"TCPREADY 1139 11434\n", b"Attached 4 probes\n",
            1139, 11434, PROGRAMS_BASE, PROGRAMS_LIVE,
            LINKS_BASE, LINKS_LIVE, TRACER)[0])

    def test_02_wrong_program_name(self):
        report = self.inspect(programs={
            **PROGRAMS_BASE, 93: ("kprobe", "sensitive_unknown_name")})
        self.assertEqual(report["programCandidates"][0]["predicates"]["name_exact"],
                         "FAIL")
        self.assertEqual(report["programCandidates"][0]["nameClass"], "OTHER")
        self.assertEqual(report["targetProgramMatchCount"], 0)
        self.assertEqual(report["validSessionLinkMatchCount"], 0)

        # bpftool can expand a 15-character name from BTF. This is a
        # documented possible shape, NOT a proven match from the live run.
        full = self.inspect(programs={
            **PROGRAMS_BASE, 93: ("kprobe", "kprobe_tcp_sendmsg")})
        self.assertEqual(full["programCandidates"][0]["nameClass"],
                         "SESSION_FULL_BTF")
        self.assertEqual(full["programCandidates"][0]["predicates"]["name_exact"],
                         "FAIL")
        self.assertEqual(full["targetProgramMatchCount"], 0)

    def test_03_wrong_program_type(self):
        report = self.inspect(programs={
            **PROGRAMS_BASE, 93: ("tracepoint", "kprobe_tcp_send")})
        self.assertEqual(report["programCandidates"][0]["predicates"]["type_kprobe"],
                         "FAIL")
        self.assertEqual(report["programCandidates"][0]["typeClass"], "tracepoint")
        self.assertEqual(report["validSessionLinkMatchCount"], 0)

    def test_04_wrong_link_type(self):
        report = self.inspect(links={**LINKS_BASE, 101: {
            **LINKS_LIVE[101], "type": "perf_event"}})
        self.assertEqual(report["linkCandidates"][0]["predicates"]["type_kprobe_multi"],
                         "FAIL")
        self.assertEqual(report["linkCandidates"][0]["typeClass"], "perf_event")
        self.assertEqual(report["validSessionLinkMatchCount"], 0)

    def test_05_wrong_linked_program_id(self):
        report = self.inspect(links={**LINKS_BASE, 101: {
            **LINKS_LIVE[101], "prog_id": 91}})
        self.assertEqual(
            report["linkCandidates"][0]["predicates"]["linked_program_matches"],
            "FAIL")
        self.assertEqual(report["linkCandidates"][0]["linkedProgramId"], 91)
        self.assertEqual(report["validSessionLinkMatchCount"], 0)

    def test_06_missing_target_function_metadata(self):
        report = self.inspect(links={**LINKS_BASE, 101: {
            k: v for k, v in LINKS_LIVE[101].items() if k != "funcs"}})
        link = report["linkCandidates"][0]
        self.assertEqual(link["targetClass"], "MISSING")
        self.assertEqual(link["funcsShape"], "MISSING")
        self.assertEqual(link["predicates"]["funcs_list"], "FAIL")
        self.assertEqual(link["predicates"]["target_tcp_sendmsg"], "FAIL")
        self.assertEqual(report["validSessionLinkMatchCount"], 0)

    def test_07_wrong_owner_pid_vs_wrong_comm(self):
        for owner, failed in (
            ({"pid": TRACER + 1, "comm": "bpftrace"}, "owner_pid_present"),
            ({"pid": TRACER, "comm": "other_sensitive"}, "owner_pid_and_comm"),
        ):
            with self.subTest(owner=failed):
                report = self.inspect(links={**LINKS_BASE, 101: {
                    **LINKS_LIVE[101], "pids": [owner]}})
                self.assertEqual(report["linkCandidates"][0]["predicates"][failed],
                                 "FAIL")
                self.assertEqual(report["validSessionLinkMatchCount"], 0)

    def test_08_bpftrace_session_is_one_program_not_two(self):
        report = self.inspect()
        self.assertEqual(report["targetProgramMatchCount"], 1)
        self.assertEqual(report["validSessionLinkMatchCount"], 1)
        separate = {**PROGRAMS_LIVE, 94: ("kprobe", "kretprobe_tcp_s")}
        mixed = self.inspect(programs=separate)
        self.assertEqual(mixed["separateReturnMatchCount"], 1)
        self.assertFalse(collector.source_arm_evidence(
            b"TCPREADY 1139 11434\n", b"Attached 4 probes\n",
            1139, 11434, PROGRAMS_BASE, separate,
            LINKS_BASE, LINKS_LIVE, TRACER)[0])

    def test_09_no_new_objects_is_distinct_from_failed_matches(self):
        report = self.inspect(programs=PROGRAMS_BASE, links=LINKS_BASE)
        self.assertEqual(report["freshProgramCount"], 0)
        self.assertEqual(report["freshLinkCount"], 0)
        self.assertEqual(report["programCandidates"], [])
        self.assertEqual(report["linkCandidates"], [])
        self.assertEqual(report["uniqueTargetProgram"], "FAIL")
        self.assertEqual(report["uniqueSessionLink"], "FAIL")
        stale = self.inspect(baseline_programs=PROGRAMS_LIVE,
                             baseline_links=LINKS_LIVE)
        self.assertEqual(stale["freshProgramCount"], 0)
        self.assertEqual(stale["freshLinkCount"], 0)
        self.assertEqual(stale["programCandidates"][0]["predicates"]["fresh"], "FAIL")
        self.assertEqual(stale["linkCandidates"][0]["predicates"]["fresh"], "FAIL")

    def test_10_schema_aliases_do_not_elevate_to_proof_or_leak(self):
        row = {
            k: v for k, v in LINKS_LIVE[101].items()
            if k not in ("funcs", "pids", "retprobe")
        }
        row.update({
            "functions": ["very_private_tcp_string 0xdeadbeef"],
            "owners": [{"pid": TRACER, "comm": "private_owner"}],
            "unknown": "PASSWORD_ABC",
        })
        report = self.inspect(links={**LINKS_BASE, 101: row})
        link = report["linkCandidates"][0]
        for name in ("retprobe_false", "funcs_list", "pids_list",
                     "target_tcp_sendmsg", "owner_pid_and_comm"):
            self.assertEqual(link["predicates"][name], "FAIL")
        rendered = json.dumps(report)
        for secret in ("very_private_tcp_string", "0xdeadbeef", "private_owner",
                       "PASSWORD_ABC", '"functions":', '"owners":'):
            self.assertNotIn(secret, rendered)
        self.assertEqual(report["validSessionLinkMatchCount"], 0)

    def test_other_strict_predicates_and_duplicate_link_are_diagnostic(self):
        for key, bad, predicate in (
            ("retprobe", True, "retprobe_false"),
            ("retprobe", 0, "retprobe_false"),
            ("func_cnt", 2, "func_cnt_one"),
            ("func_cnt", True, "func_cnt_one"),
            ("missed", 1, "missed_zero"),
            ("funcs", [{"func": "wrong_kernel_function"}], "target_tcp_sendmsg"),
            ("pids", [], "pids_nonempty"),
        ):
            with self.subTest(key=key, bad=bad):
                report = self.inspect(links={**LINKS_BASE, 101: {
                    **LINKS_LIVE[101], key: bad}})
                self.assertEqual(
                    report["linkCandidates"][0]["predicates"][predicate], "FAIL")
                self.assertEqual(report["validSessionLinkMatchCount"], 0)
        doubled = self.inspect(links={**LINKS_LIVE, 102: {
            **LINKS_LIVE[101], "id": 102}})
        self.assertEqual(doubled["completeLinkCandidateCount"], 2)
        self.assertEqual(doubled["uniqueSessionLink"], "FAIL")
        self.assertEqual(doubled["validSessionLinkMatchCount"], 0)

    def test_malformed_schema_is_rejected_before_diagnostics(self):
        for parser, records in (
            (collector.parse_program_inventory,
             [{"id": 93, "type": 3, "name": "kprobe_tcp_send"}]),
            (collector.parse_program_inventory,
             [{"id": True, "type": "kprobe", "name": "kprobe_tcp_send"}]),
            (collector.parse_link_inventory,
             [{"id": 101, "type": "kprobe_multi", "prog_id": None}]),
            (collector.parse_link_inventory,
             [{"id": 101, "type": "kprobe_multi", "prog_id": True}]),
        ):
            with self.subTest(records=records):
                with self.assertRaises(ValueError):
                    parser(records)

    def test_consumed_run_shape_is_not_a_readiness_proof(self):
        """Represent the 13 active normalized samples, not their redacted names.

        The indexed name is a source-supported *hypothesis*, not the literal
        name retained by the real audit (which was classified OTHER).
        No kernel, bpftool, bpftrace or root tool is executed here.
        """
        old_progs = {n: ("tracepoint", "old") for n in range(1, 46)}
        live_progs = {**old_progs,
                      157: ("kprobe", "kprobe_tcp_sendmsg_1"),
                      155: ("raw_tracepoint", "other"),
                      158: ("perf_event", "other"),
                      159: ("raw_tracepoint", "other")}
        old_links = {n: {"id": n, "type": "cgroup", "prog_id": 1}
                     for n in range(1, 4)}
        live_links = {**old_links,
                      11: {"id": 11, "type": "kprobe_multi", "prog_id": 157,
                           "retprobe": False, "func_cnt": 1, "missed": 0,
                           "funcs": []},
                      10: {"id": 10, "type": "perf_event", "prog_id": 158}}
        report = self.inspect(programs=live_progs, links=live_links,
                              baseline_programs=old_progs,
                              baseline_links=old_links)
        self.assertEqual(tuple(report[k] for k in (
            "baselineProgramCount", "liveProgramCount", "freshProgramCount",
            "baselineLinkCount", "liveLinkCount", "freshLinkCount")),
            (45, 49, 4, 3, 5, 2))
        self.assertFalse(report["programCandidatesTruncated"])
        self.assertFalse(report["linkCandidatesTruncated"])
        prog = next(row for row in report["programCandidates"] if row["id"] == 157)
        link = next(row for row in report["linkCandidates"] if row["id"] == 11)
        self.assertEqual(prog["typeClass"], "kprobe")
        self.assertEqual(prog["nameClass"], "OTHER")
        self.assertEqual(prog["predicates"]["name_exact"], "FAIL")
        self.assertEqual(link["linkedProgramId"], 157)
        self.assertEqual(link["typeClass"], "kprobe_multi")
        self.assertEqual(link["funcsShape"], "LIST")
        self.assertEqual(link["ownersShape"], "MISSING")
        for key in ("fresh", "type_kprobe_multi", "retprobe_false",
                    "func_cnt_one", "missed_zero", "funcs_list"):
            self.assertEqual(link["predicates"][key], "PASS", key)
        for key in ("funcs_one", "target_tcp_sendmsg", "pids_list",
                    "owner_pid_present", "owner_pid_and_comm"):
            self.assertEqual(link["predicates"][key], "FAIL", key)
        self.assertEqual(report["targetProgramMatchCount"], 0)
        self.assertEqual(report["validSessionLinkMatchCount"], 0)
        self.assertFalse(collector.source_arm_evidence(
            b"TCPREADY 1139 11434\n", b"Attached 4 probes\n", 1139,
            11434, old_progs, live_progs, old_links, live_links, TRACER)[0])

    def test_conditional_function_and_owner_metadata_fail_independently(self):
        """Fixing a displayed name cannot replace target or ownership proof."""
        for variation, bad in (
            ({"funcs": []}, "target_tcp_sendmsg"),
            ({"pids": None}, "pids_list"),
            ({"funcs": [{"func": "not_tcp_sendmsg"}]}, "target_tcp_sendmsg"),
            ({"pids": [{"pid": TRACER + 1, "comm": "bpftrace"}]},
             "owner_pid_and_comm"),
            ({"pids": [{"pid": TRACER, "comm": "not_bpftrace"}]},
             "owner_pid_and_comm"),
        ):
            with self.subTest(variation=variation):
                links = {**LINKS_BASE, 101: {**LINKS_LIVE[101], **variation}}
                report = self.inspect(links=links)
                candidate = report["linkCandidates"][0]
                self.assertEqual(candidate["predicates"][bad], "FAIL")
                self.assertEqual(report["validSessionLinkMatchCount"], 0)
                self.assertFalse(collector.source_arm_evidence(
                    b"TCPREADY 1139 11434\n", b"Attached 4 probes\n",
                    1139, 11434, PROGRAMS_BASE, PROGRAMS_LIVE,
                    LINKS_BASE, links, TRACER)[0])

    def test_unrelated_and_ambiguous_programs_never_rescue_session(self):
        unrelated = {**PROGRAMS_BASE, 93: ("kprobe", "kprobe_tcp_send_untrusted")}
        links = {**LINKS_BASE, 101: LINKS_LIVE[101]}
        self.assertEqual(self.inspect(programs=unrelated, links=links)[
            "validSessionLinkMatchCount"], 0)

        # An extra matching *program* is ambiguous even if only one link
        # points at the first candidate; a single matching program is required.
        ambiguous = {**PROGRAMS_LIVE, 94: ("kprobe", "kprobe_tcp_send")}
        self.assertEqual(self.inspect(programs=ambiguous)[
            "targetProgramMatchCount"], 2)
        self.assertEqual(self.inspect(programs=ambiguous)[
            "validSessionLinkMatchCount"], 0)
        self.assertFalse(collector.source_arm_evidence(
            b"TCPREADY 1139 11434\n", b"Attached 4 probes\n", 1139,
            11434, PROGRAMS_BASE, ambiguous, LINKS_BASE, LINKS_LIVE, TRACER)[0])

        # Stale identical-looking links cannot supply this session's proof.
        self.assertEqual(self.inspect(baseline_links=LINKS_LIVE)[
            "validSessionLinkMatchCount"], 0)

    def test_bounded_counts_and_candidate_selection(self):
        many = {**PROGRAMS_LIVE, **{
            i: ("kprobe", "SECRET_%d" % i) for i in range(200, 290)}}
        report = self.inspect(programs=many)
        self.assertEqual(report["freshProgramCount"], 91)
        self.assertTrue(report["programCandidatesTruncated"])
        self.assertEqual(len(report["programCandidates"]),
                         collector.MAX_PREDICATE_CANDIDATES)
        self.assertEqual(report["programCandidates"][0]["id"], 93)
        self.assertNotIn("SECRET_", json.dumps(report))

    def test_audit_samples_bounded_and_not_counted_as_inventory_invocations(self):
        with tempfile.TemporaryFile(mode="w+b") as file:
            audit = collector.InventoryAudit(file.fileno(), {
                "binarySha256": collector.FIXED_DIAGNOSTIC_BPFT_SHA256})
            audit.record({"kind": "prog", "phase": "baseline", "result": "pass"})
            audit.record({"kind": "link", "phase": "live", "result": "pass"})
            for _ in range(100):
                audit.record_matcher(self.inspect())
            self.assertEqual(audit.invocations, 2)
            self.assertEqual(audit.matcher_samples, collector.MAX_PREDICATE_SAMPLES)
            file.seek(0)
            rows = [json.loads(line) for line in file]
            self.assertEqual(len(rows), 2 + collector.MAX_PREDICATE_SAMPLES)
            self.assertEqual([r["invocation"] for r in rows[:3]], [1, 2, 2])
            self.assertEqual(rows[2]["kind"], "matcher")
            self.assertEqual(rows[-1]["sample"], collector.MAX_PREDICATE_SAMPLES)
            self.assertLess(audit.bytes_written, collector.MAX_INVENTORY_AUDIT)


if __name__ == "__main__":
    unittest.main()
