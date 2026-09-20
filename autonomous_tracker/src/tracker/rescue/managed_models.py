"""Recover completed training runs and preserve usable models in a managed library."""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from tracker.rescue.media import file_sha256
from tracker.rescue.model_library import ModelLibrary, ModelVersion, pin_config
from tracker.rescue.state_store import file_lease
from tracker.rescue.training_workflow import completed_training


def read_record(path: Path) -> dict[str, Any]:
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError(f"Record too large: {path.name}")
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError(f"Invalid record: {path.name}")
    return value


def training_description(result: Path) -> tuple[str, list[str]]:
    stamp = re.search(r"rescue-train-(\d{8}-\d{6})-", result.parent.name)
    created = (
        datetime.strptime(stamp[1], "%Y%m%d-%H%M%S").replace(tzinfo=UTC)
        if stamp
        else datetime.fromtimestamp(result.stat().st_mtime, UTC)
    )
    videos: list[str] = []
    try:
        request = read_record(result.parent / "request.json")
        data = Path(request["data"]).parent
        for project in read_record(data / "manifest.json")["projects"]:
            snapshot = (data / project["snapshot"]).resolve()
            if not snapshot.is_relative_to(data.resolve()):
                raise ValueError("Snapshot is outside its dataset.")
            name = Path(read_record(snapshot)["source"]["path"]).name
            if name not in videos:
                videos.append(name)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return created.isoformat(), videos


def save_trained_model(workspace: Path, result: Path) -> ModelVersion:
    result = result.resolve()
    with file_lease(workspace / ".studio/models/.managed.lock"):
        library = ModelLibrary(workspace)
        existing = next(
            (v for v in library.catalog.versions if v.training_result == str(result)), None
        )
        if existing is not None:
            return existing
        payload = completed_training(result)
        config = pin_config(Path(payload["review_config"]), workspace)
        if (
            len(config.models) != 1
            or Path(config.models[0].weights).resolve() != Path(payload["best_weights"]).resolve()
        ):
            raise ValueError("The training record and its selected model do not match.")
        created, videos = training_description(result)
        title = Path(videos[0]).stem if len(videos) == 1 else "My model"
        number = 1 + sum(v.source_videos == videos for v in library.catalog.versions)
        directory = workspace.resolve() / "models/studio" / uuid4().hex
        directory.mkdir(parents=True, exist_ok=False)
        model = config.models[0]
        target = directory / "model.pt"
        with Path(model.weights).open("rb") as source, target.open("xb") as destination:
            shutil.copyfileobj(source, destination)
        if file_sha256(target) != model.weights_sha256:
            raise ValueError("The model changed while saving. Original files are unchanged.")
        model.weights = str(target)
        config_path = directory / "review.yaml"
        with config_path.open("x", encoding="utf-8") as stream:
            yaml.safe_dump(config.model_dump(mode="json"), stream, sort_keys=False)
        with (directory / "training-record.json").open("x", encoding="utf-8") as stream:
            json.dump({**payload, "original_training_result": str(result)}, stream, indent=2)
        return library._register(
            f"{title[:65]} - Version {number}",
            config,
            result,
            managed_directory=str(directory),
            created_utc=created,
            source_videos=videos,
            training_mode=str(payload.get("training_mode", "")),
        )


@dataclass(frozen=True)
class ModelSync:
    library: ModelLibrary
    warnings: tuple[str, ...]


def sync_trained_models(workspace: Path, known: tuple[Path, ...] = ()) -> ModelSync:
    candidates = {path.resolve() for path in known if path.is_file()}
    warnings: list[str] = []
    visited = 0
    for base in (workspace / "annotations", workspace / "data", workspace / "training"):
        for directory, children, files in os.walk(base, followlinks=False):
            visited += 1
            children[:] = [
                name
                for name in children
                if name not in {"fit", "dataset", "images", "labels", "previews", ".studio"}
                and not (Path(directory) / name).is_symlink()
            ]
            if visited > 10000 or len(candidates) >= 500:
                warnings.append("Discovery limit reached. Existing models remain available.")
                break
            folder = Path(directory)
            if folder.name.startswith("rescue-train-") and "result.json" in files:
                candidates.add((folder / "result.json").resolve())
                children.clear()
    registered = {v.training_result for v in ModelLibrary(workspace).catalog.versions}
    for path in sorted(candidates):
        if str(path) in registered:
            continue
        try:
            if read_record(path).get("status") == "completed":
                save_trained_model(workspace, path)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            warnings.append(f"{path.parent.name}: {exc}")
    return ModelSync(ModelLibrary(workspace), tuple(warnings))


def model_folder(version: ModelVersion) -> Path:
    return (
        Path(version.managed_directory)
        if version.managed_directory
        else Path(version.config.models[0].weights).parent
    )


def model_available(version: ModelVersion) -> bool:
    return all(Path(model.weights).is_file() for model in version.config.models)


def model_date(version: ModelVersion) -> str:
    try:
        return datetime.fromisoformat(version.created_utc).astimezone().strftime("%d %b %Y, %H:%M")
    except ValueError:
        return "Unknown date"
