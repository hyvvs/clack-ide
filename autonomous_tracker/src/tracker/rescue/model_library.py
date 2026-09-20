from __future__ import annotations

import hashlib
import shutil
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import yaml
from pydantic import Field, model_validator

from tracker.rescue.config import DetectorSettings, RescueConfig, ReviewModel, load_rescue_config
from tracker.rescue.media import file_sha256
from tracker.rescue.state_store import StateStore


class ModelVersion(ReviewModel):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    name: str = Field(min_length=1, max_length=100)
    created_utc: str
    config: RescueConfig
    config_sha256: str
    training_result: str = ""
    managed_directory: str = ""
    source_videos: list[str] = Field(default_factory=list)
    training_mode: str = ""


class ModelCatalog(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    versions: list[ModelVersion] = Field(default_factory=list, max_length=500)
    active_id: str | None = None
    history: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_ids(self) -> ModelCatalog:
        ids = {item.id for item in self.versions}
        if len(ids) != len(self.versions):
            raise ValueError("Duplicate model version IDs.")
        if (self.active_id is not None and self.active_id not in ids) or set(self.history) - ids:
            raise ValueError("Model selection refers to an unknown version.")
        return self


def pin_config(path: Path, workspace: Path) -> RescueConfig:
    config = load_rescue_config(path)
    for model in config.models:
        weights = Path(model.weights)
        if not weights.is_absolute():
            weights = workspace / weights
        if not weights.is_file() or weights.suffix.casefold() != ".pt":
            raise ValueError(f"Choose trusted local .pt weights: {weights}")
        digest = file_sha256(weights)
        if model.weights_sha256 is not None and model.weights_sha256 != digest:
            raise ValueError(f"Weights changed for {model.name}; checksum mismatch.")
        model.weights = str(weights.resolve())
        model.weights_sha256 = digest
    return config


def verify_weights(config: RescueConfig) -> None:
    for model in config.models:
        if not Path(model.weights).is_absolute() or model.weights_sha256 is None:
            raise ValueError("Model version must use checksum-pinned absolute local weights.")
        if file_sha256(Path(model.weights)) != model.weights_sha256:
            raise ValueError(
                f"Weights missing or changed for {model.name}. Re-import the intended version."
            )


class ModelLibrary:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.resolve()
        self.directory = self.workspace / ".studio" / "models"
        self.store = StateStore(self.directory / "catalog.json")
        self.catalog = ModelCatalog()
        self.reload()

    def reload(self) -> None:
        payload = self.store.read()
        self.catalog = (
            ModelCatalog() if payload is None else ModelCatalog.model_validate_json(payload)
        )

    def get(self, identity: str) -> ModelVersion:
        result = next(
            (version for version in self.catalog.versions if version.id == identity), None
        )
        if result is None:
            raise ValueError("Select a registered model version.")
        return result

    def config_path(self, identity: str) -> Path:
        version = self.get(identity)
        path = self.directory / version.id / "review.yaml"
        config = load_rescue_config(path)
        digest = hashlib.sha256(config.model_dump_json().encode("utf-8")).hexdigest()
        if digest != version.config_sha256:
            raise ValueError("Registered model config changed. Re-import it as a new version.")
        return path

    def register(
        self, name: str, config_path: Path, training_result: Path | None = None
    ) -> ModelVersion:
        return self._register(name, pin_config(config_path, self.workspace), training_result)

    def register_weights(self, name: str, weights: Path, *, managed: bool = False) -> ModelVersion:
        if not weights.is_file() or weights.suffix.casefold() != ".pt":
            raise ValueError("Choose trusted local .pt detection weights.")
        digest = file_sha256(weights)
        from ultralytics import YOLO  # type: ignore[attr-defined]

        model = YOLO(str(weights.resolve()))
        if model.task != "detect":
            raise ValueError("The guided workflow requires detection weights.")
        classes = sorted(str(label).casefold() for label in model.names.values())
        if file_sha256(weights) != digest:
            raise ValueError("Weights changed while importing.")
        config = RescueConfig(
            models=[
                DetectorSettings(
                    name="observation",
                    weights=str(weights.resolve()),
                    weights_sha256=digest,
                    classes=classes,
                    device="cpu",
                )
            ],
            review_classes=classes,
        )
        directory: Path | None = None
        if managed:
            existing = next(
                (
                    v
                    for v in self.catalog.versions
                    if v.managed_directory
                    and len(v.config.models) == 1
                    and v.config.models[0].weights_sha256 == digest
                ),
                None,
            )
            if existing is not None:
                return existing
            directory = self.workspace / "models/studio" / uuid4().hex
            directory.mkdir(parents=True, exist_ok=False)
            target = directory / "model.pt"
            with weights.open("rb") as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            if file_sha256(target) != digest:
                raise ValueError("Model changed while saving its managed copy.")
            config.models[0].weights = str(target)
        return self._register(name, config, managed_directory=str(directory) if directory else "")

    def _register(
        self,
        name: str,
        config: RescueConfig,
        training_result: Path | None = None,
        *,
        managed_directory: str = "",
        created_utc: str = "",
        source_videos: list[str] | None = None,
        training_mode: str = "",
    ) -> ModelVersion:
        name = name.strip()
        if not name or len(name) > 100 or any(ord(char) < 32 for char in name):
            raise ValueError("Use a version name of 1-100 characters, without control characters.")
        digest = hashlib.sha256(config.model_dump_json().encode("utf-8")).hexdigest()
        existing = next(
            (version for version in self.catalog.versions if version.config_sha256 == digest), None
        )
        if existing is not None:
            return existing
        version = ModelVersion(
            id=uuid4().hex,
            name=name,
            created_utc=created_utc or datetime.now(UTC).isoformat(),
            config=config,
            config_sha256=digest,
            training_result=str(training_result.resolve()) if training_result else "",
            managed_directory=managed_directory,
            source_videos=source_videos or [],
            training_mode=training_mode,
        )
        directory = self.directory / version.id
        directory.mkdir(parents=True, exist_ok=False)
        with (directory / "review.yaml").open("x", encoding="utf-8") as stream:
            yaml.safe_dump(config.model_dump(mode="json"), stream, sort_keys=False)
        updated = self.catalog.model_copy(deep=True)
        updated.versions.append(version)
        self.store.save(updated)
        self.catalog = updated
        return version

    def rename(self, identity: str, name: str) -> None:
        name = name.strip()
        if not name or len(name) > 100 or any(ord(char) < 32 for char in name):
            raise ValueError("Use a version name of 1-100 characters, without control characters.")
        self.get(identity)
        updated = self.catalog.model_copy(deep=True)
        next(version for version in updated.versions if version.id == identity).name = name
        self.store.save(updated)
        self.catalog = updated

    def activate(self, identity: str) -> Path:
        path = self.config_path(identity)
        verify_weights(self.get(identity).config)
        updated = self.catalog.model_copy(deep=True)
        if updated.active_id == identity:
            return path
        if updated.active_id is not None:
            updated.history = [*updated.history[-99:], updated.active_id]
        updated.active_id = identity
        self.store.save(updated)
        self.catalog = updated
        return path

    def rollback(self) -> Path:
        if not self.catalog.history:
            raise ValueError("No previously active observation model is available.")
        return self.activate(self.catalog.history[-1])

    def active_path(self) -> Path | None:
        return None if self.catalog.active_id is None else self.config_path(self.catalog.active_id)
