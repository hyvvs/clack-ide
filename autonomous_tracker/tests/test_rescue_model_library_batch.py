from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
import yaml
from test_rescue_training import make_project, make_run, read_doc

from tracker.cli.rescue_desktop import prepare_workspace
from tracker.rescue.batch import batch_lease, create_batch, read_batch, run_batch
from tracker.rescue.media import file_sha256
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.state_store import StateStore


def model_config(root: Path, name: str = "one", label: str = "fire") -> Path:
    weights = root / f"{name}.pt"
    weights.write_bytes(name.encode())
    path = root / f"{name}.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "models": [{"name": name, "weights": str(weights), "classes": [label]}],
                "review_classes": [label],
            }
        )
    )
    return path


def test_model_versions_selection_rollback_and_checksum_protection(tmp_path: Path) -> None:
    first, second = model_config(tmp_path), model_config(tmp_path, "two", "smoke")
    library = ModelLibrary(tmp_path)
    one = library.register("Fire baseline", first)
    two = library.register("Smoke baseline", second)
    assert library.active_path() is None
    assert library.register("Same version", first).id == one.id
    library.activate(one.id)
    library.activate(two.id)
    library.rename(two.id, "Smoke v2")
    reopened = ModelLibrary(tmp_path)
    assert reopened.get(two.id).name == "Smoke v2"
    assert reopened.catalog.active_id == two.id
    reopened.rollback()
    assert reopened.catalog.active_id == one.id
    Path(two.config.models[0].weights).write_bytes(b"changed")
    with pytest.raises(ValueError, match="changed"):
        reopened.activate(two.id)
    assert ModelLibrary(tmp_path).catalog.active_id == one.id


def test_model_registry_rejects_concurrent_writes(tmp_path: Path) -> None:
    config = model_config(tmp_path)
    first = ModelLibrary(tmp_path)
    second = ModelLibrary(tmp_path)
    one = first.register("one", config)
    with pytest.raises(ValueError, match="another window"):
        second.register("two", config)
    first.activate(one.id)
    path = first.active_path()
    assert path is not None
    path.write_text("models: []")
    with pytest.raises(ValueError):
        ModelLibrary(tmp_path).active_path()


def test_batch_deduplicates_pins_model_and_checks_lock(tmp_path: Path) -> None:
    project = make_project(tmp_path, "clip", "training")
    video = Path(read_doc(project).source.path)
    config = model_config(tmp_path)
    path = create_batch([video, video], config, tmp_path)
    assert len(read_batch(path).items) == 1
    config.write_text("changed")
    with batch_lease(path), pytest.raises(ValueError, match="Another worker"):
        run_batch(path, tmp_path / "stop", retry=True)
    assert read_batch(path).status == "pending"
    (path.parent / "config.yaml").write_text("changed")
    with pytest.raises(ValueError, match="snapshot changed"):
        run_batch(path, tmp_path / "stop", retry=True)


def test_batch_recovery_preserves_completed_and_failed_attempts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects = [
        make_project(tmp_path, "a", "training"),
        make_project(tmp_path, "b", "validation", 60),
    ]
    docs = {read_doc(path).source.path: read_doc(path) for path in projects}
    config = model_config(tmp_path)
    path = create_batch([Path(name) for name in docs], config, tmp_path)
    calls = []
    fail_second = True

    class FakeProcess:
        def __init__(self, args: list[str], **kwargs: Any) -> None:
            nonlocal fail_second
            video = args[args.index("--video") + 1]
            output = Path(args[args.index("--output") + 1])
            calls.append(video)
            self.returncode = 1 if video.endswith("b.avi") and fail_second else 0
            if self.returncode == 0:
                make_run(output / "review-fixture", docs[video])

        def poll(self) -> int:
            return self.returncode

    monkeypatch.setattr("tracker.rescue.batch.subprocess.Popen", FakeProcess)
    run_batch(path, tmp_path / "stop", retry=True)
    failed = read_batch(path)
    assert [item.status for item in failed.items] == ["completed", "failed"]
    first_hash = failed.items[0].predictions_sha256
    fail_second = False
    run_batch(path, tmp_path / "stop2", retry=True)
    completed = read_batch(path)
    assert completed.status == "completed"
    assert len(calls) == 3
    assert len(completed.items[0].attempts) == 1 and len(completed.items[1].attempts) == 2
    assert completed.items[0].predictions_sha256 == first_hash
    assert Path(completed.items[1].attempts[0].directory).is_dir()


def test_batch_stop_before_start_preserves_pending(tmp_path: Path) -> None:
    project = make_project(tmp_path, "clip", "training")
    path = create_batch([Path(read_doc(project).source.path)], model_config(tmp_path), tmp_path)
    stop = tmp_path / "stop"
    stop.touch()
    run_batch(path, stop, retry=True)
    assert read_batch(path).status == "cancelled"
    assert read_batch(path).items[0].status == "pending"


def test_batch_stop_during_inference_preserves_attempt_and_resumes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects = [
        make_project(tmp_path, "first", "training"),
        make_project(tmp_path, "second", "validation", 50),
    ]
    documents = {read_doc(path).source.path: read_doc(path) for path in projects}
    path = create_batch([Path(name) for name in documents], model_config(tmp_path), tmp_path)
    calls = []

    class InterruptedProcess:
        returncode = 0

        def __init__(self, args: list[str], **kwargs: Any) -> None:
            video = args[args.index("--video") + 1]
            output = Path(args[args.index("--output") + 1])
            run = make_run(output / "review-fixture", documents[video])
            calls.append(video)
            if len(calls) == 1:
                Path(args[args.index("--stop-file") + 1]).touch()
                summary = json.loads((run / "summary.json").read_bytes())
                summary.update(status="operator_stopped", frames_reviewed=2)
                (run / "summary.json").write_text(json.dumps(summary))

        def poll(self) -> int:
            return self.returncode

    monkeypatch.setattr("tracker.rescue.batch.subprocess.Popen", InterruptedProcess)
    run_batch(path, tmp_path / "stop-first", retry=True)
    stopped = read_batch(path)
    assert stopped.status == "cancelled"
    assert [item.status for item in stopped.items] == ["cancelled", "pending"]
    attempt = Path(stopped.items[0].attempts[0].directory)
    run_batch(path, tmp_path / "stop-resume", retry=True)
    resumed = read_batch(path)
    assert resumed.status == "completed" and len(calls) == 3
    assert [len(item.attempts) for item in resumed.items] == [2, 1]
    assert resumed.items[0].attempts[0].status == "cancelled" and attempt.is_dir()


def test_desktop_workspace_is_separate_from_installation(tmp_path: Path) -> None:
    installation = tmp_path / "app"
    installation.mkdir()
    with pytest.raises(ValueError, match="outside"):
        prepare_workspace(installation / "data", installation)
    workspace = prepare_workspace(tmp_path / "workspace", installation)
    assert all((workspace / name).is_dir() for name in ("data", "annotations", "models", "configs"))


@pytest.mark.skipif(
    os.environ.get("RESCUE_RUN_TRAINING_SMOKE") != "1", reason="opt-in real YOLO inference"
)
def test_real_batch_inference_resume_and_model_import(tmp_path: Path) -> None:
    weights = Path(__file__).resolve().parents[1] / "models/rescue-fire-smoke/best.pt"
    digest = file_sha256(weights)
    library = ModelLibrary(tmp_path)
    version = library.register_weights("Real baseline", weights)
    config = library.activate(version.id)
    projects = [
        make_project(tmp_path, "one", "training"),
        make_project(tmp_path, "two", "validation", 60),
    ]
    path = create_batch(
        [Path(read_doc(project).source.path) for project in projects], config, tmp_path
    )
    run_batch(path, tmp_path / "stop", retry=True)
    plan = read_batch(path)
    assert plan.status == "completed"
    assert all(item.frames_done == 4 for item in plan.items)
    run_batch(path, tmp_path / "stop2", retry=True)
    assert all(len(item.attempts) == 1 for item in read_batch(path).items)
    assert file_sha256(weights) == digest
    state = read_batch(path)
    state.items[1].status = "running"
    store = StateStore(path)
    store.read()
    store.save(state)
    run_batch(path, tmp_path / "stop3", retry=True)
    assert read_batch(path).status == "completed"
    assert len(read_batch(path).items[1].attempts) == 2
    payload = json.loads((Path(plan.items[0].run_directory) / "summary.json").read_bytes())
    assert payload["source_video_sha256"] == read_doc(projects[0]).source.sha256
