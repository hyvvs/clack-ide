from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReviewModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DetectorSettings(ReviewModel):
    name: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9_-]+$")
    weights: str = Field(min_length=1)
    weights_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    classes: list[str] = Field(min_length=1)
    confidence: float = Field(default=0.35, gt=0.0, le=1.0)
    image_size: int = Field(default=640, ge=32)
    device: str | None = None
    tracker: Literal["bytetrack.yaml", "botsort.yaml"] = "botsort.yaml"

    @model_validator(mode="after")
    def validate_classes(self) -> DetectorSettings:
        names = [name.strip().casefold() for name in self.classes]
        if any(not name for name in names) or len(names) != len(set(names)):
            raise ValueError("model classes must be nonempty and unique")
        self.classes = names
        return self


class RescueConfig(ReviewModel):
    models: list[DetectorSettings] = Field(min_length=1)
    confirmation_frames: int = Field(default=3, ge=1)
    lost_after_s: float = Field(default=1.0, gt=0.0)
    history_length: int = Field(default=30, ge=1, le=300)
    freeze_warning_s: float = Field(default=2.0, gt=0.0)
    review_classes: list[str] = Field(
        default_factory=lambda: ["person", "fire", "smoke", "floodwater", "debris"]
    )

    @model_validator(mode="after")
    def validate_models(self) -> RescueConfig:
        names = [model.name for model in self.models]
        if len(names) != len(set(names)):
            raise ValueError("model names must be unique")
        self.review_classes = list(
            dict.fromkeys(name.strip().casefold() for name in self.review_classes)
        )
        if any(not name for name in self.review_classes):
            raise ValueError("review classes cannot be empty")
        return self


def load_rescue_config(path: Path) -> RescueConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return RescueConfig.model_validate(raw)
