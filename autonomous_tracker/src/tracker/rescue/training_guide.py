"""Plain-language planning for the saved-label training workflow."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.config import load_rescue_config
from tracker.rescue.dataset_audit import normalize_incident
from tracker.rescue.library import is_live_project, read_json
from tracker.rescue.model_library import ModelLibrary

PURPOSES = {
    "unassigned": "Choose a purpose",
    "training": "Teach the model",
    "validation": "Check its progress",
    "test": "Keep for final test",
}


@dataclass(frozen=True)
class SavedVideo:
    path: Path
    document: AnnotationDocument

    @property
    def title(self) -> str:
        return Path(self.document.source.path).name

    @property
    def reviewed(self) -> int:
        return sum(frame.reviewed for frame in self.document.frames)

    @property
    def lineage(self) -> set[str]:
        return {self.document.source.sha256, *self.document.source_ancestors}


@dataclass(frozen=True)
class SetupIssue:
    message: str
    action: str
    path: Path | None = None


@dataclass(frozen=True)
class StartingModel:
    name: str
    weights: Path
    sha256: str | None


def starting_models(workspace: Path) -> list[StartingModel]:
    library = ModelLibrary(workspace)
    models = []
    versions = sorted(
        reversed(library.catalog.versions),
        key=lambda version: version.id != library.catalog.active_id,
    )
    for version in versions:
        library.config_path(version.id)
        for model in version.config.models:
            models.append(
                StartingModel(
                    version.name
                    if len(version.config.models) == 1
                    else f"{version.name} / {model.name}",
                    Path(model.weights),
                    model.weights_sha256,
                )
            )
    config_path = workspace / "configs" / "rescue_fire_review.yaml"
    if config_path.is_file():
        for model in load_rescue_config(config_path).models:
            path = Path(model.weights)
            if not path.is_absolute():
                path = workspace / path
            if not any(saved.weights.resolve() == path.resolve() for saved in models):
                models.append(
                    StartingModel(f"Workspace starter / {model.name}", path, model.weights_sha256)
                )
    return models


def load_saved_video(path: Path) -> SavedVideo:
    path = path.resolve()
    if not is_live_project(path):
        raise ValueError(
            "This is a backup or an exported copy. Choose the saved video in the library."
        )
    try:
        return SavedVideo(path, AnnotationDocument.model_validate(read_json(path)))
    except ValueError as exc:
        raise ValueError(f"{path.name} is not a saved labeling project.") from exc


def workspace_for(project: Path) -> Path:
    for parent in project.resolve().parents:
        if (parent / "annotations").is_dir() and (parent / "configs").is_dir():
            return parent
    return Path.cwd()


def discover_saved_videos(workspace: Path, selected: list[Path]) -> list[SavedVideo]:
    """Read labels only, never hash/decode every video just to populate a picker."""
    candidates = set(selected)
    candidates.update((workspace / "annotations").glob("*.json"))
    candidates.update((workspace / "annotations/corrections").glob("*/labels.json"))
    candidates.update((workspace / "data").glob("**/projects/*.json"))
    for root in (workspace / "annotations", workspace / "data"):
        candidates.update(root.glob("**/clips/clip-*/clip.json"))
    for parent in {path.parent for path in selected}:
        candidates.update(parent.glob("*.json"))
    videos = []
    for path in sorted({path.resolve() for path in candidates}):
        try:
            videos.append(load_saved_video(path))
        except (OSError, ValueError, TypeError):
            continue
    return videos


def suggested_group(video: SavedVideo, videos: list[SavedVideo]) -> str:
    if video.document.incident_id.strip():
        return video.document.incident_id
    for other in videos:
        if video.lineage & other.lineage and other.document.incident_id.strip():
            return other.document.incident_id
    digest = (
        sorted(video.document.source_ancestors)[0]
        if video.document.source_ancestors
        else (video.document.source.sha256)
    )
    return f"recording-{digest[:12]}"


def assign_purpose(
    video: SavedVideo, videos: list[SavedVideo], purpose: str, group: str
) -> AnnotationDocument:
    if purpose not in {"training", "validation", "test"}:
        raise ValueError("Choose whether this video teaches the model or checks it.")
    if not normalize_incident(group):
        raise ValueError("Give this recording a name, or use the suggested name.")
    for other in videos:
        if other.path == video.path:
            continue
        related = bool(video.lineage & other.lineage) or (
            normalize_incident(other.document.incident_id) == normalize_incident(group)
        )
        if related and other.document.split not in {"unassigned", purpose}:
            raise ValueError(
                f"{other.title} is from the same recording or event and is set to "
                f"'{PURPOSES[other.document.split]}'. Keep related footage in that same purpose, "
                "or use a genuinely different recording for the check."
            )
    payload = video.document.model_dump()
    payload.update(incident_id=group.strip(), split=purpose)
    return AnnotationDocument.model_validate(payload)


def setup_issues(videos: list[SavedVideo]) -> list[SetupIssue]:
    issues: list[SetupIssue] = []
    if not videos:
        return [SetupIssue("Add a labeled video to get started.", "videos")]
    scope = set(videos[0].document.classes)
    purposes: Counter[str] = Counter()
    examples: Counter[str] = Counter()
    for index, video in enumerate(videos):
        doc = video.document
        if not Path(doc.source.path).is_file():
            issues.append(
                SetupIssue(
                    f"{video.title}: the original video file is missing. "
                    "Relocate it before preparing data.",
                    "videos",
                    video.path,
                )
            )
        if not video.reviewed:
            issues.append(
                SetupIssue(
                    f"{video.title}: no frames approved yet. "
                    "Review your boxes in Label video first.",
                    "review",
                    video.path,
                )
            )
        if not normalize_incident(doc.incident_id) or doc.split == "unassigned":
            issues.append(
                SetupIssue(
                    f"{video.title}: choose 'Teach the model' or 'Check its progress'.",
                    "purpose",
                    video.path,
                )
            )
        else:
            purposes[doc.split] += video.reviewed
        if set(doc.classes) != scope:
            issues.append(
                SetupIssue(
                    f"{video.title}: its tag list differs. Match the tag lists, "
                    "then review any changed projects again.",
                    "tags",
                    video.path,
                )
            )
        for other in videos[:index]:
            if doc.source.sha256 == other.document.source.sha256:
                issues.append(
                    SetupIssue(
                        f"{video.title}: this same video is included twice. "
                        "Remove one labeling project from this selection.",
                        "videos",
                        video.path,
                    )
                )
            related = bool(video.lineage & other.lineage) or (
                bool(normalize_incident(doc.incident_id))
                and normalize_incident(doc.incident_id)
                == normalize_incident(other.document.incident_id)
            )
            if (
                related
                and doc.split != other.document.split
                and "unassigned" not in {doc.split, other.document.split}
            ):
                issues.append(
                    SetupIssue(
                        f"{video.title} and {other.title} share a recording or event. "
                        "They cannot be used on opposite sides of the check.",
                        "purpose",
                        video.path,
                    )
                )
        if doc.split == "training":
            examples.update(
                obj.label for frame in doc.frames if frame.reviewed for obj in frame.objects
            )
    if not purposes["training"]:
        issues.append(
            SetupIssue("Choose at least one approved video to teach the model.", "videos")
        )
    if not purposes["validation"]:
        issues.append(
            SetupIssue(
                "Add a different, approved recording to check progress. "
                "A second cut or copy of the teaching video does not count.",
                "videos",
            )
        )
    missing = scope - examples.keys()
    if purposes["training"] and missing:
        issues.append(
            SetupIssue(
                "The teaching videos have no approved examples for: "
                + ", ".join(sorted(missing))
                + ". Add and review examples, or remove unused tags intentionally.",
                "review",
            )
        )
    return issues
