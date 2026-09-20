"""Optional FastAPI WebSocket telemetry isolated from the control loop."""

from __future__ import annotations

import asyncio
import contextlib
import importlib
from collections.abc import AsyncIterator
from typing import Any


class TelemetryHub:
    """Fan out latest-only telemetry to bounded subscriber queues."""

    def __init__(self, subscriber_queue_size: int = 2) -> None:
        self._queue_size = subscriber_queue_size
        self._subscribers: set[asyncio.Queue[dict[str, object]]] = set()

    def publish(self, payload: dict[str, object]) -> None:
        """Publish without blocking, dropping stale subscriber data first."""
        for queue in tuple(self._subscribers):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(payload.copy())

    @contextlib.asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[dict[str, object]]]:
        """Register one bounded subscriber for the context lifetime."""
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(self._queue_size)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)


def create_app(hub: TelemetryHub) -> Any:
    """Create a FastAPI app when the telemetry extra is installed."""
    try:
        fastapi = importlib.import_module("fastapi")
    except ImportError as exc:
        raise RuntimeError("install the telemetry extra to run the WebSocket server") from exc
    app = fastapi.FastAPI(title="Educational Tracker Telemetry")

    async def health() -> dict[str, bool]:
        return {"healthy": True}

    async def websocket_endpoint(websocket: Any) -> None:
        await websocket.accept()
        async with hub.subscribe() as queue:
            while True:
                await websocket.send_json(await queue.get())

    app.add_api_route("/health", health, methods=["GET"])
    app.add_api_websocket_route("/ws", websocket_endpoint)
    return app
