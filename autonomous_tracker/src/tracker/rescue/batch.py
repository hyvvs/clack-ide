from __future__ import annotations

import json
import os
import subprocess
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

import yaml
from pydantic import Field, model_validator

from tracker.rescue.config import ReviewModel, load_rescue_config
from tracker.rescue.desktop_jobs import python_command
from tracker.rescue.media import FrameReader, VideoIdentity, file_sha256
from tracker.rescue.model_library import pin_config, verify_weights
from tracker.rescue.state_store import StateStore, file_lease


class BatchAttempt(ReviewModel):
    directory: str
    status: str = "running"
    error: str = ""


class BatchItem(ReviewModel):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    source: VideoIdentity
    status: Literal["pending", "running", "completed", "failed", "cancelled"] = "pending"
    frames_done: int = Field(default=0, ge=0)
    attempts: list[BatchAttempt] = Field(default_factory=list, max_length=100)
    error: str = ""
    run_directory: str = ""
    summary_sha256: str = ""
    predictions_sha256: str = ""


class BatchPlan(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    created_utc: str
    config_sha256: str
    status: Literal["pending", "running", "completed", "needs_attention", "cancelled"] = "pending"
    items: list[BatchItem] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_items(self) -> BatchPlan:
        if len({item.id for item in self.items}) != len(self.items) or len(
            {item.source.sha256 for item in self.items}
        ) != len(self.items):
            raise ValueError("Batch contains duplicate IDs or duplicate source videos.")
        return self


@contextmanager
def batch_lease(path: Path) -> Iterator[None]:
    with file_lease(path.with_name("worker.lock")):
        yield


def create_batch(videos: list[Path], config: Path, workspace: Path) -> Path:
    if not videos or len(videos) > 1000:
        raise ValueError("Choose 1-1000 videos for a batch.")
    pinned = pin_config(config, workspace)
    items = []
    seen: set[str] = set()
    for video in dict.fromkeys(path.resolve() for path in videos):
        reader = FrameReader(video)
        try:
            if reader.source.sha256 in seen:
                continue
            seen.add(reader.source.sha256)
            items.append(BatchItem(id=uuid4().hex, source=reader.source))
        finally:
            reader.close()
    directory = (
        workspace.resolve()
        / "diagnostics"
        / "rescue-batches"
        / f"batch-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    )
    directory.mkdir(parents=True, exist_ok=False)
    with (directory / "config.yaml").open("x", encoding="utf-8") as stream:
        yaml.safe_dump(pinned.model_dump(mode="json"), stream, sort_keys=False)
    path = directory / "batch.json"
    StateStore(path).save(
        BatchPlan(
            created_utc=datetime.now(UTC).isoformat(),
            config_sha256=file_sha256(directory / "config.yaml"),
            items=items,
        )
    )
    return path


def read_batch(path: Path) -> BatchPlan:
    payload = StateStore(path).read()
    if payload is None:
        raise ValueError("Batch manifest does not exist.")
    return BatchPlan.model_validate_json(payload)


def verify_completed(item: BatchItem, directory: Path) -> None:
    run = Path(item.run_directory).resolve()
    if not run.is_relative_to(directory.resolve()):
        raise ValueError("Batch result escapes its output directory.")
    if (
        file_sha256(run / "summary.json") != item.summary_sha256
        or file_sha256(run / "frames.jsonl") != item.predictions_sha256
    ):
        raise ValueError("Completed batch output changed or is missing.")


def run_batch(path: Path, stop_file: Path, *, retry: bool = False) -> None:
    path = path.resolve()
    with batch_lease(path):
        store = StateStore(path)
        payload = store.read()
        if payload is None:
            raise ValueError("Batch manifest is missing.")
        plan = BatchPlan.model_validate_json(payload)
        config_path = path.parent / "config.yaml"
        if file_sha256(config_path) != plan.config_sha256:
            raise ValueError("Batch model snapshot changed. Create a new batch.")
        verify_weights(load_rescue_config(config_path))
        for item in plan.items:
            if item.status == "running":
                item.status = "failed"
                item.error = "Previous worker was interrupted. Original attempts are retained."
                if item.attempts:
                    item.attempts[-1].status = "interrupted"
        plan.status = "running"
        store.save(plan)
        for item in plan.items:
            if stop_file.exists():
                break
            if item.status == "completed":
                try:
                    verify_completed(item, path.parent)
                    continue
                except (OSError, ValueError) as exc:
                    item.status, item.error = "failed", str(exc)
                    store.save(plan)
            if item.status != "pending" and not retry:
                continue
            try:
                if file_sha256(Path(item.source.path)) != item.source.sha256:
                    raise ValueError(
                        "Original video changed. Create a new batch for the new media."
                    )
                if len(item.attempts) >= 100:
                    raise ValueError("Attempt limit reached; create a new batch.")
                directory = path.parent / "items" / item.id / f"attempt-{uuid4().hex[:12]}"
                directory.mkdir(parents=True, exist_ok=False)
                attempt = BatchAttempt(directory=str(directory))
                item.attempts.append(attempt)
                item.status, item.error, item.frames_done = "running", "", 0
                store.save(plan)
                progress = directory / "progress.json"
                arguments = [
                    "--video",
                    item.source.path,
                    "--config",
                    str(config_path),
                    "--output",
                    str(directory),
                    "--stop-file",
                    str(stop_file),
                    "--progress-file",
                    str(progress),
                ]
                print(
                    f"Processing {Path(item.source.path).name}; log: {directory / 'inference.log'}",
                    flush=True,
                )
                with (directory / "inference.log").open("xb") as log:
                    process = subprocess.Popen(
                        python_command("tracker.cli.rescue_review", arguments),
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        stdin=subprocess.DEVNULL,
                        shell=False,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    )
                    try:
                        while process.poll() is None:
                            if progress.is_file():
                                try:
                                    count = int(json.loads(progress.read_bytes()).get("frames", 0))
                                except (ValueError, OSError):
                                    count = item.frames_done
                                if (
                                    0 <= count <= item.source.frame_count
                                    and count != item.frames_done
                                ):
                                    item.frames_done = count
                                    store.save(plan)
                            time.sleep(0.25)
                    except BaseException:
                        stop_file.touch(exist_ok=True)
                        try:
                            process.wait(timeout=30)
                        except subprocess.TimeoutExpired:
                            process.terminate()
                            process.wait(timeout=10)
                        raise
                if process.returncode != 0:
                    with (directory / "inference.log").open("rb") as stream:
                        stream.seek(max(0, stream.seek(0, os.SEEK_END) - 3500))
                        tail = stream.read(3500).decode("utf-8", errors="replace")
                    raise ValueError(f"Inference exited {process.returncode}. {tail}")
                summaries = list(directory.glob("review-*/summary.json"))
                if len(summaries) != 1:
                    raise ValueError("Expected exactly one inference result.")
                summary = json.loads(summaries[0].read_bytes())
                item.frames_done = summary["frames_reviewed"]
                if summary["status"] == "operator_stopped" or stop_file.exists():
                    item.status, item.error, attempt.status = (
                        "cancelled",
                        "Stopped by operator.",
                        "cancelled",
                    )
                elif (
                    summary["status"] != "completed"
                    or summary["source_video_sha256"] != item.source.sha256
                ):
                    raise ValueError("Inference did not produce a complete result for this video.")
                else:
                    if file_sha256(Path(item.source.path)) != item.source.sha256:
                        raise ValueError("Video changed while inference was running.")
                    item.status = "completed"
                    attempt.status = "completed"
                    item.run_directory = str(summaries[0].parent)
                    item.summary_sha256 = file_sha256(summaries[0])
                    item.predictions_sha256 = file_sha256(summaries[0].parent / "frames.jsonl")
            except (OSError, ValueError) as exc:
                item.status, item.error = "failed", str(exc)
                if item.attempts and item.attempts[-1].status == "running":
                    item.attempts[-1].status = "failed"
                    item.attempts[-1].error = str(exc)
                print(f"Failed {Path(item.source.path).name}: {exc}", flush=True)
            store.save(plan)
        plan.status = (
            "cancelled"
            if stop_file.exists()
            else "completed"
            if all(item.status == "completed" for item in plan.items)
            else "needs_attention"
        )
        store.save(plan)
        print(
            f"Batch {plan.status}. "
            f"Completed {sum(item.status == 'completed' for item in plan.items)}/{len(plan.items)}",
            flush=True,
        )
