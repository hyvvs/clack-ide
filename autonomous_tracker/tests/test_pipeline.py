import asyncio

from tracker.pipeline import DropOldestQueue


def test_drop_oldest_queue_keeps_latest_data() -> None:
    async def run() -> tuple[int, int]:
        queue: DropOldestQueue[int] = DropOldestQueue(2)
        queue.put_latest(1)
        queue.put_latest(2)
        queue.put_latest(3)
        first = await queue.get()
        second = await queue.get()
        return first, second

    assert asyncio.run(run()) == (2, 3)
