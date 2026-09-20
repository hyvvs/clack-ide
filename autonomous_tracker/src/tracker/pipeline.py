"""Async primitives for bounded, stale-dropping real-time-ish pipelines."""

from __future__ import annotations

import asyncio
import contextlib


class DropOldestQueue[T]:
    """Bounded async queue that keeps the newest data instead of adding latency."""

    def __init__(self, maxsize: int) -> None:
        if maxsize < 1:
            raise ValueError("queue size must be positive")
        self._queue: asyncio.Queue[T] = asyncio.Queue(maxsize)
        self.dropped_count = 0

    def put_latest(self, item: T) -> None:
        """Insert immediately, discarding the oldest queued item if full."""
        if self._queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
                self.dropped_count += 1
        self._queue.put_nowait(item)

    async def get(self) -> T:
        """Wait for and return the next available item."""
        return await self._queue.get()

    def get_nowait(self) -> T:
        """Return the next item without waiting."""
        return self._queue.get_nowait()

    def qsize(self) -> int:
        """Return current bounded queue depth."""
        return self._queue.qsize()
