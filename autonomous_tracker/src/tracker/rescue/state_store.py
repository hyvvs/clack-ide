from __future__ import annotations

import hashlib
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from tracker.rescue.config import ReviewModel
from tracker.rescue.media import file_sha256


@contextmanager
def file_lease(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if sys.platform == "win32":
            import msvcrt

            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise ValueError(
                    f"Another worker holds {path.name}. Wait for it to finish."
                ) from exc
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise ValueError(
                    f"Another worker holds {path.name}. Wait for it to finish."
                ) from exc
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


class StateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.digest: str | None = None

    def read(self) -> bytes | None:
        if not self.path.exists():
            self.digest = None
            return None
        if self.path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError(f"State file exceeds 16 MiB: {self.path.name}")
        payload = self.path.read_bytes()
        self.digest = hashlib.sha256(payload).hexdigest()
        return payload

    def save(self, state: ReviewModel) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_name(f".{self.path.name}.lock")
        temporary = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        try:
            with file_lease(lock):
                current = file_sha256(self.path) if self.path.exists() else None
                if current != self.digest:
                    raise ValueError(
                        f"{self.path.name} changed in another window. Reload before editing."
                    )
                payload = (state.model_dump_json(indent=2) + "\n").encode("utf-8")
                with temporary.open("xb") as output:
                    output.write(payload)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.path)
                self.digest = hashlib.sha256(payload).hexdigest()
        finally:
            temporary.unlink(missing_ok=True)


class WorkCancelled(Exception):
    pass
