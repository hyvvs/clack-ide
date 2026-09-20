from __future__ import annotations

from dataclasses import dataclass

from tracker.rescue.observations import Box, Point


def corners(box: Box) -> tuple[Point, Point, Point, Point]:
    x1, y1, x2, y2 = box
    return (x1, y1), (x2, y1), (x2, y2), (x1, y2)


def hit_box(
    boxes: list[Box], point: Point, selected: int | None, radius: float
) -> tuple[int, str] | None:
    if selected is not None and 0 <= selected < len(boxes):
        for index, corner in enumerate(corners(boxes[selected])):
            if max(abs(point[0] - corner[0]), abs(point[1] - corner[1])) <= radius:
                return selected, str(index)
    for index in reversed(range(len(boxes))):
        x1, y1, x2, y2 = boxes[index]
        if x1 <= point[0] <= x2 and y1 <= point[1] <= y2:
            return index, "move"
    return None


@dataclass(frozen=True)
class BoxDrag:
    index: int
    action: str
    start: Point
    original: Box

    def update(self, point: Point, width: int, height: int) -> Box:
        x1, y1, x2, y2 = self.original
        if self.action == "move":
            dx = max(-x1, min(width - x2, point[0] - self.start[0]))
            dy = max(-y1, min(height - y2, point[1] - self.start[1]))
            return x1 + dx, y1 + dy, x2 + dx, y2 + dy
        opposite = corners(self.original)[(int(self.action) + 2) % 4]
        px, py = max(0.0, min(width, point[0])), max(0.0, min(height, point[1]))
        return (
            min(opposite[0], px),
            min(opposite[1], py),
            max(opposite[0], px),
            max(opposite[1], py),
        )
