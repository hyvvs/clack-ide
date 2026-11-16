#!/usr/bin/env python3
"""Print per-file SHA-256 evidence for the one pinned llama.cpp Windows CPU ZIP.

This audit reads its input only. It does not extract, install, or execute files.
"""

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path


ARCHIVE_NAME = "llama-b12248-bin-win-cpu-x64.zip"
ARCHIVE_SHA256 = "bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181"
REQUIRED_FILES = {
    "llama-server.exe": "106ad878b697cccdc601b83a483c9649489c7c7fd3043e08cf7e292039a9cd8a",
    "LICENSE-LLVM-OpenMP": "fdad1758a9e1f9d5a81e18879b3406772115edc92c24bfa36b70c654f325e8e4",
}


def stream_sha256(source):
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def inspect_archive(archive):
    if archive.name != ARCHIVE_NAME:
        raise ValueError(f"expected {ARCHIVE_NAME}, found {archive.name}")
    with archive.open("rb") as source:
        archive_sha256 = stream_sha256(source)
    if archive_sha256 != ARCHIVE_SHA256:
        raise ValueError(f"unapproved archive SHA-256: {archive_sha256}")

    entries = []
    seen = set()
    with zipfile.ZipFile(archive, "r") as bundle:
        for info in bundle.infolist():
            if info.is_dir():
                continue
            name = info.filename
            parts = name.split("/")
            if (
                not parts
                or name.startswith("/")
                or name.endswith("/")
                or "\\" in name
                or (len(name) >= 2 and name[1] == ":")
                or any(part in ("", ".", "..") for part in parts)
                or name in seen
            ):
                raise ValueError(f"unsafe or duplicate ZIP entry: {name!r}")
            seen.add(name)
            with bundle.open(info, "r") as source:
                digest = stream_sha256(source)
            entries.append({"path": name, "size": info.file_size, "sha256": digest})

    measured = {entry["path"]: entry["sha256"] for entry in entries}
    for name, expected in REQUIRED_FILES.items():
        if measured.get(name) != expected:
            raise ValueError(f"required ZIP entry has unexpected digest: {name}")
    return {
        "upstream": "ggml-org/llama.cpp",
        "tag": "b12248",
        "source_commit": "3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8",
        "archive": ARCHIVE_NAME,
        "archive_sha256": archive_sha256,
        "files": sorted(entries, key=lambda entry: entry["path"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Local copy of the approved ZIP")
    args = parser.parse_args()
    try:
        report = inspect_archive(args.archive)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.error(str(exc))
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
