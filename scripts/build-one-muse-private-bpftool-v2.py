#!/usr/bin/env python3
"""Reproducible offline-only private-bpftool production bundle.

Never touches the accepted standalone sources, installed root files,
network, sudo, kernel collector, inference, or the frozen evaluator.
All output is versioned under scripts/one-muse-private-bpftool-v2/.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / "one-muse-private-bpftool-v2"
VERSION = "private-bpftool-v2-20261112"
BEFORE = {
    "local-muse-one-root.sh":
        "69ad979c5f5cd73cdc3ba5e4e29bafea4dbd278055e27dc6028b2d36fd682137",
    "local-muse-one-ebpf.py":
        "eed450245218a9cbf02bacdbe4d08c5dc071636e5ca61904aac5f7a4e72c24df",
    "local-muse-tcp-session.py":
        "d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf",
    "local-muse-tcp.bt":
        "e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0",
    "one-muse-narrow-root.py":
        "551de3b1b2895b06f5bafd19b569fb41ab2170990bbb74a39d41014532ab223b",
    "one-muse-narrow-sudoers":
        "5c009fffbfe7c2ebb5cf720a0cd31e44f46559477af0f1b5c0b6f7646e096268",
}
PRIVATE = {
    "path": "/opt/clack/diagnostic-tools/bpftool-678d538",
    "sha256": "0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0",
    "buildId": "7f530859f49ede16767f9f4eb8551a6ac85aa25d",
    "provenancePinSha256":
        "215855a87f21ecd219cb642a392fa4cb8e716a58b9f1b811f4b8e91e876ff197",
    "version": "7.8.1",
    "libbpfVersion": "1.9",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(data, old, new):
    before, after = old.encode("ascii"), new.encode("ascii")
    if data.count(before) != 1:
        raise ValueError("Approved production asset patch no longer unique")
    return data.replace(before, after, 1)


def main():
    original = {}
    for name, sha in BEFORE.items():
        raw = (ROOT / name).read_bytes()
        if digest(raw) != sha:
            raise ValueError("Accepted pre-change hash mismatched: " + name)
        original[name] = raw

    shell = replace_once(original["local-muse-one-root.sh"],
                         "fixed_bpftool_mode=normal",
                         "fixed_bpftool_mode=fixed")
    source = original["local-muse-one-ebpf.py"]
    source = replace_once(
        source,
        "if args.fixed_diagnostic_bpftool and args.seconds > 20:\n"
        "        parser.error(\"Pinned bpftool selection is short diagnostic-only\")",
        "if args.fixed_diagnostic_bpftool and 20 < args.seconds < MAX_SECONDS:\n"
        "        parser.error(\"Private bpftool requires approved short or production mode\")\n"
        "    if args.seconds == MAX_SECONDS and not args.fixed_diagnostic_bpftool:\n"
        "        parser.error(\"PRIVATE_BPFTOOL_QUALIFICATION_FAILED\")")
    source = replace_once(
        source,
        'bpftool, bpftool_identity = qualified_diagnostic_bpftool()',
        'try:\n'
        '                bpftool, bpftool_identity = qualified_diagnostic_bpftool()\n'
        '            except (OSError, ValueError, KeyError, subprocess.SubprocessError):\n'
        '                print("KERNEL_AUDIT_PRIVATE_BPFTOOL_QUALIFICATION_FAILED=1",\n'
        '                      file=sys.stderr, flush=True)\n'
        '                raise')
    source = replace_once(
        source,
        "if args.fixed_diagnostic_bpftool else None)\n"
        "        if resource is None:",
        "if args.fixed_diagnostic_bpftool and args.seconds <= 20 else None)\n"
        "        if resource is None:")
    source = replace_once(
        source,
        "args.fixed_diagnostic_bpftool and\n"
        "                               not args.capture_live_link_abort))",
        "args.fixed_diagnostic_bpftool and\n"
        "                               args.seconds <= 20 and\n"
        "                               not args.capture_live_link_abort))")
    newer = {
        "local-muse-one-root.sh": shell,
        "local-muse-one-ebpf.py": source,
    }
    wrapper = original["one-muse-narrow-root.py"]
    for name in ("local-muse-one-root.sh", "local-muse-one-ebpf.py"):
        wrapper = replace_once(wrapper, BEFORE[name], digest(newer[name]))
    newer["one-muse-narrow-root.py"] = wrapper
    new_wrapper_hash = digest(wrapper)
    policy = original["one-muse-narrow-sudoers"]
    if policy.count(BEFORE["one-muse-narrow-root.py"].encode("ascii")) != 2:
        raise ValueError("Exactly two pinned sudo commands required")
    policy = policy.replace(BEFORE["one-muse-narrow-root.py"].encode("ascii"),
                            new_wrapper_hash.encode("ascii"))
    newer["one-muse-narrow-sudoers"] = policy

    manifest = {
        "schemaVersion": 1,
        "version": VERSION,
        "acceptedPrivateBpftool": PRIVATE,
        "oldSha256": BEFORE,
        "newSha256": {name: digest(newer[name]) for name in newer},
        "unchangedSha256": {name: BEFORE[name] for name in (
            "local-muse-tcp-session.py", "local-muse-tcp.bt")},
        "rootWrapperPath": "/usr/local/libexec/clack-one-muse-root",
        "narrowSudoersPath": "/etc/sudoers.d/90-clack-one-muse-root",
    }
    newer["manifest.json"] = (json.dumps(manifest, sort_keys=True, indent=2)
                               + "\n").encode("ascii")
    DEST.mkdir(mode=0o700, parents=False, exist_ok=True)
    for name, blob in newer.items():
        target = DEST / name
        if target.exists() and target.read_bytes() != blob:
            raise ValueError("Existing versioned production asset differs: " + name)
        if not target.exists():
            target.write_bytes(blob)
    print("ROOT_REPIN_VERSION=" + VERSION)
    for name, blob in newer.items():
        print("REPIn_SHA256_" + name + "=" + digest(blob))


if __name__ == "__main__":
    main()
