from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from pydantic import Field, model_validator

from tracker.rescue.config import ReviewModel
from tracker.rescue.observations import Observation, Point


class ReviewRegion(ReviewModel):
    name: str = Field(min_length=1)
    frame_index: int = Field(ge=0)
    polygon_normalized: list[Point] = Field(min_length=3, max_length=32)

    @model_validator(mode="after")
    def validate_polygon(self) -> ReviewRegion:
        if any(value < 0 or value > 1 for point in self.polygon_normalized for value in point):
            raise ValueError("region vertices must be normalized between zero and one")
        points = np.asarray(self.polygon_normalized, dtype=np.float32)
        if cv2.contourArea(points) <= 1e-6 or not cv2.isContourConvex(points):
            raise ValueError("review region must be a nonzero, convex polygon")
        return self


class RegionFile(ReviewModel):
    regions: list[ReviewRegion]


def load_regions(path: Path | None) -> list[ReviewRegion]:
    if path is None:
        return []
    return RegionFile.model_validate(json.loads(path.read_text(encoding="utf-8"))).regions


def review_regions(
    regions: list[ReviewRegion],
    frame_index: int,
    observations: list[Observation],
    width: int,
    height: int,
    unsupported_classes: list[str],
) -> list[dict[str, object]]:
    """Review operator-marked polygons on their exact frame only."""
    reviews: list[dict[str, object]] = []
    for region in regions:
        if region.frame_index != frame_index:
            continue
        contour = np.rint(np.asarray(region.polygon_normalized) * [width - 1, height - 1]).astype(
            np.int32
        )
        region_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(region_mask, [contour], 1)
        overlaps: list[str] = []
        for observation in observations:
            observation_mask = np.zeros_like(region_mask)
            if len(observation.polygon) >= 3:
                points = np.rint(observation.polygon).astype(np.int32)
                cv2.fillPoly(observation_mask, [points], 1)
            else:
                x1, y1, x2, y2 = map(round, observation.bbox_xyxy)
                cv2.rectangle(observation_mask, (x1, y1), (x2, y2), 1, -1)
            if np.any(region_mask & observation_mask):
                overlaps.append(observation.label)
        reviews.append(
            {
                "name": region.name,
                "frame_index": frame_index,
                "polygon_normalized": region.polygon_normalized,
                "status": "observation_overlap" if overlaps else "unverified",
                "overlapping_labels": sorted(set(overlaps)),
                "unsupported_review_classes": unsupported_classes,
                "approved_for_delivery": False,
                "note": (
                    "Image-space review only. Terrain, clearance, location and delivery "
                    "suitability remain unverified."
                ),
            }
        )
    return reviews
