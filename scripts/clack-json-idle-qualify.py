#!/usr/bin/env python3
"""Root-side IDLE-ONLY private bpftool comparison, no BPF attachment.

The administrator wrapper runs this file only from a root-owned, hash-pinned
snapshot. Never export raw BPF JSON or stderr; print finite numeric receipts.
"""
import hashlib
import json
import resource
import subprocess
import sys

FIXED = "/opt/clack/diagnostic-tools/bpftool-678d538"
PACKAGED = "/usr/bin/bpftool"
VERSION = "7.8.1"
LIBBPF = "1.9"


def command(path, *args):
    child = subprocess.run(
        [path, *args], input=None, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=3, check=False)
    if (child.returncode != 0 or child.stderr or
            not 0 < len(child.stdout) < 4_194_304):
        raise ValueError("idle command failed, aborted, or exceeded bounds")
    try:
        return json.loads(child.stdout)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("non-JSON idle output") from exc


def snapshot(path, kind):
    rows = command(path, "-j", kind, "show")
    if (not isinstance(rows, list) or
            any(not isinstance(row, dict) or
                type(row.get("id")) is not int or row["id"] <= 0 or
                not isinstance(row.get("type"), str) for row in rows)):
        raise ValueError("unrecognized idle program or link schema")
    keys = ("id", "type", "prog_id") if kind == "link" else ("id", "type", "name")
    records = sorted(tuple(row.get(key) for key in keys) for row in rows)
    value = json.dumps(records, separators=(",", ":")).encode("ascii")
    return len(rows), hashlib.sha256(value).hexdigest()


def qualify(fixed=FIXED, packaged=PACKAGED):
    details = command(fixed, "-j", "version")
    if (not isinstance(details, dict) or
            details.get("version") != VERSION or
            details.get("libbpf_version") != LIBBPF or
            not isinstance(details.get("features"), dict) or
            details["features"].get("skeletons") is not True):
        raise ValueError("private version/libbpf/owner skeleton mismatch")
    output = []
    for kind in ("prog", "link"):
        actual, baseline = snapshot(fixed, kind), snapshot(packaged, kind)
        if actual != baseline:
            raise ValueError("idle semantics mismatch")
        output.extend((
            "CLACK_JSON_IDLE_%s_COUNT=%d" % (kind.upper(), actual[0]),
            "CLACK_JSON_IDLE_%s_SHA256=%s" % (kind.upper(), actual[1]),
            "CLACK_JSON_IDLE_%s_COMPARE=PASS" % kind.upper(),
        ))
    output.extend((
        "CLACK_JSON_IDLE_VERSION=7_8_1",
        "CLACK_JSON_IDLE_LIBBPF=1_9",
        "CLACK_JSON_IDLE_OWNER_SKELETON=PASS",
    ))
    return output


def main():
    if len(sys.argv) != 1:
        return 1
    try:
        # The new renderer is not yet live-qualified; even a failed *idle*
        # inspection must never leave a raw core on the diagnostic host.
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        for row in qualify():
            print(row)
    except (ValueError, subprocess.TimeoutExpired, OSError, UnicodeError):
        # Never copy stdout/stderr from either child or exception details.
        print("CLACK_JSON_IDLE=FAIL", file=sys.stderr)
        return 1
    print("CLACK_JSON_IDLE=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
