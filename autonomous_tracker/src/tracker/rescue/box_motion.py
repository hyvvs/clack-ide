from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.rescue.observations import Box


def _flow_box(
    previous: NDArray[np.uint8], current: NDArray[np.uint8], coordinates: Box
) -> tuple[Box | None, float, str]:
    box = np.array(coordinates, dtype=np.float64)
    height, width = previous.shape
    margin = max(16, min(128, round(float(np.linalg.norm(box[2:] - box[:2])))))
    left, top = max(0, int(box[0]) - margin), max(0, int(box[1]) - margin)
    right, bottom = min(width, int(box[2]) + margin), min(height, int(box[3]) + margin)
    previous, current = previous[top:bottom, left:right], current[top:bottom, left:right]
    mask = np.zeros_like(previous)
    local = box - np.array([left, top, left, top])
    x1, y1, x2, y2 = np.rint(local).astype(int)
    mask[y1:y2, x1:x2] = 255
    points = cv2.goodFeaturesToTrack(previous, 100, 0.01, 3, mask=mask)
    if points is None or len(points) < 6:
        return None, 0, "Too little texture inside the box."
    following, valid, _ = cv2.calcOpticalFlowPyrLK(previous, current, points, points.copy())
    if following is None or valid is None:
        return None, 0, "Optical flow failed."
    backward, back_valid, _ = cv2.calcOpticalFlowPyrLK(
        current, previous, following, following.copy()
    )
    if backward is None or back_valid is None:
        return None, 0, "Backward motion check failed."
    good = (
        (valid.ravel() == 1)
        & (back_valid.ravel() == 1)
        & (np.linalg.norm(points.reshape(-1, 2) - backward.reshape(-1, 2), axis=1) < 1.5)
    )
    if int(good.sum()) < 6:
        return None, 0, "Motion inconsistent or object occluded."
    transform, inliers = cv2.estimateAffinePartial2D(
        points[good], following[good], method=cv2.RANSAC, ransacReprojThreshold=2
    )
    support = 0.0 if inliers is None else float(inliers.sum() / len(points))
    if transform is None or not np.isfinite(transform).all() or support < 0.6:
        return None, support, "Too few points agree on the motion."
    scale = float(np.hypot(transform[0, 0], transform[0, 1]))
    center = np.r_[(local[:2] + local[2:]) / 2, 1] @ transform.T + [left, top]
    half = (box[2:] - box[:2]) * scale / 2
    updated = np.r_[center - half, center + half]
    displacement = float(np.linalg.norm((updated[:2] + updated[2:] - box[:2] - box[2:]) / 2))
    if not 0.8 <= scale <= 1.25 or displacement > max(
        15, float(np.linalg.norm(box[2:] - box[:2])) * 0.5
    ):
        return None, support, "Abrupt scale or position change."
    if updated[0] < 0 or updated[1] < 0 or updated[2] > width or updated[3] > height:
        return None, support, "Box reached the image edge."
    if updated[2] - updated[0] < 2 or updated[3] - updated[1] < 2:
        return None, support, "Box became too small."
    return (float(updated[0]), float(updated[1]), float(updated[2]), float(updated[3])), support, ""


def _crop(image: NDArray[np.uint8], box: Box) -> NDArray[np.uint8]:
    x1, y1, x2, y2 = np.rint(box).astype(int)
    return image[y1:y2, x1:x2]


def _similarity(first: NDArray[np.uint8], second: NDArray[np.uint8]) -> float:
    if not first.size or not second.size:
        return 0.0
    a = cv2.resize(first, (48, 48)).astype(np.float32)
    b = cv2.resize(second, (48, 48)).astype(np.float32)
    a -= a.mean()
    b -= b.mean()
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    return 0.0 if norm < 1 else float(np.sum(a * b) / norm)


def _template_box(
    previous: NDArray[np.uint8], current: NDArray[np.uint8], box: Box
) -> tuple[Box | None, float, str]:
    height, width = previous.shape
    x1, y1, x2, y2 = box
    pad = max(2, round(min(x2 - x1, y2 - y1) * 0.12))
    px, py = (
        min(pad, int(x1), width - int(np.ceil(x2))),
        min(pad, int(y1), height - int(np.ceil(y2))),
    )
    patch = _crop(previous, (x1 - px, y1 - py, x2 + px, y2 + py))
    if not patch.size or min(patch.shape) < 5 or float(patch.std()) < 5:
        return None, 0.0, "Too little texture or boundary contrast inside the box."
    radius = max(16, min(128, round(float(np.hypot(x2 - x1, y2 - y1)))))
    left, top = max(0, int(x1) - radius - px), max(0, int(y1) - radius - py)
    right, bottom = min(width, int(x2) + radius + px), min(height, int(y2) + radius + py)
    search = current[top:bottom, left:right]
    candidates: list[tuple[float, Box, float]] = []
    for scale in (1.0, 0.9, 1.1):
        template = cv2.resize(patch, None, fx=scale, fy=scale)
        h, w = template.shape
        if h > search.shape[0] or w > search.shape[1]:
            continue
        response = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED)
        _, best, _, location = cv2.minMaxLoc(response)
        mx, my = location
        response[max(0, my - h // 3) : my + h // 3 + 1, max(0, mx - w // 3) : mx + w // 3 + 1] = -1
        second = float(response.max())
        coordinates = (
            left + mx + px * scale,
            top + my + py * scale,
            left + mx + (px + x2 - x1) * scale,
            top + my + (py + y2 - y1) * scale,
        )
        candidates.append((best, coordinates, best - second))
    if not candidates:
        return None, 0.0, "Box reached the image edge."
    score, coordinates, separation = max(candidates, key=lambda item: item[0])
    if score < 0.82 or separation < 0.06:
        return None, max(0.0, score), "Appearance is missing or ambiguous; correct the next frame."
    if not (
        0 <= coordinates[0] < coordinates[2] <= width
        and 0 <= coordinates[1] < coordinates[3] <= height
    ):
        return None, score, "Box reached the image edge."
    return coordinates, score, ""


class BoxMotionTracker:
    """Local flow with appearance fallback and a fixed reference to limit range drift."""

    def __init__(self, image: NDArray[np.uint8], box: Box) -> None:
        self.previous, self.box = image, box
        self.anchor = _crop(image, box).copy()

    def advance(self, current: NDArray[np.uint8]) -> tuple[Box | None, float, str]:
        if current.shape != self.previous.shape:
            return None, 0.0, "Image dimensions changed."
        coordinates, support, reason = _flow_box(self.previous, current, self.box)
        if (
            coordinates is not None
            and float(self.anchor.std()) >= 5
            and _similarity(self.anchor, _crop(current, coordinates)) < 0.55
        ):
            coordinates, reason = None, "Appearance no longer matches the corrected box."
        if coordinates is None:
            coordinates, support, fallback = _template_box(self.previous, current, self.box)
            if coordinates is None:
                return None, support, fallback or reason
            if (
                float(self.anchor.std()) >= 5
                and _similarity(self.anchor, _crop(current, coordinates)) < 0.55
            ):
                return None, support, "Appearance drifted from the corrected box."
        self.previous, self.box = current, coordinates
        return coordinates, support, ""


def advance_box(
    previous: NDArray[np.uint8], current: NDArray[np.uint8], coordinates: Box
) -> tuple[Box | None, float, str]:
    return BoxMotionTracker(previous, coordinates).advance(current)
