from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4


def python_command(module: str, arguments: list[str]) -> list[str]:
    executable = Path(sys.executable)
    if executable.name.lower() == "pythonw.exe":
        executable = executable.with_name("python.exe")
    return [str(executable), "-u", "-m", module, *arguments]


class DesktopJob:
    def __init__(
        self, workspace: Path, module: str, arguments: list[str], *, stoppable: bool = False
    ) -> None:
        directory = workspace / "diagnostics" / "studio"
        directory.mkdir(parents=True, exist_ok=True)
        identity = uuid4().hex[:12]
        self.log_path = directory / f"{identity}.log"
        self.stop_file = directory / f"{identity}.stop"
        self.log: BinaryIO = self.log_path.open("xb")
        self.offset = 0
        if stoppable:
            arguments = [*arguments, "--stop-file", str(self.stop_file)]
        try:
            self.process = subprocess.Popen(
                python_command(module, arguments),
                cwd=workspace,
                stdin=subprocess.DEVNULL,
                stdout=self.log,
                stderr=subprocess.STDOUT,
                shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
        except Exception:
            self.log.close()
            raise

    def read(self) -> str:
        with self.log_path.open("rb") as stream:
            stream.seek(self.offset)
            chunk = stream.read(65536)
            self.offset = stream.tell()
        return chunk.decode("utf-8", errors="replace")

    def poll(self) -> int | None:
        code = self.process.poll()
        if code is not None:
            self.log.close()
        return code

    def stop(self) -> None:
        self.stop_file.touch(exist_ok=True)
