from __future__ import annotations

import io
from urllib.request import Request, urlopen


class RangeArchive(io.RawIOBase):
    """Bounded seekable HTTPS reads for selecting files from a public ZIP archive."""

    def __init__(self, url: str, size: int, budget_bytes: int = 200_000_000) -> None:
        super().__init__()
        if not url.startswith("https://") or size <= 0 or budget_bytes <= 0:
            raise ValueError("HTTPS, positive archive size and a byte budget are required")
        self.url = url
        self.size = size
        self.budget_bytes = budget_bytes
        self.downloaded_bytes = 0
        self.position = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if self.closed:
            raise ValueError("archive is closed")
        if whence not in {io.SEEK_SET, io.SEEK_CUR, io.SEEK_END}:
            raise ValueError("invalid seek mode")
        base = 0 if whence == io.SEEK_SET else self.position if whence == io.SEEK_CUR else self.size
        position = base + offset
        if position < 0:
            raise ValueError("cannot seek before archive start")
        self.position = position
        return position

    def read(self, size: int = -1) -> bytes:
        if self.closed:
            raise ValueError("archive is closed")
        remaining = max(0, self.size - self.position)
        wanted = remaining if size < 0 else min(size, remaining)
        if wanted == 0:
            return b""
        if wanted > 16 * 1024 * 1024 or self.downloaded_bytes + wanted > self.budget_bytes:
            raise ValueError("archive read would exceed the configured download budget")
        end = self.position + wanted - 1
        request = Request(
            self.url,
            headers={"Range": f"bytes={self.position}-{end}", "Accept-Encoding": "identity"},
        )
        with urlopen(request, timeout=30) as response:
            expected = f"bytes {self.position}-{end}/{self.size}"
            if response.status != 206 or response.headers.get("Content-Range") != expected:
                raise ValueError("server did not return the exact requested archive byte range")
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise ValueError("compressed HTTP responses cannot be used for ZIP byte ranges")
            result = bytes(response.read(wanted + 1))
        self.downloaded_bytes += len(result)
        if len(result) != wanted:
            raise ValueError("archive byte range is truncated or has excess data")
        self.position += wanted
        return result
