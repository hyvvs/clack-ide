from __future__ import annotations

import json
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.managed_models import model_available, save_trained_model, sync_trained_models
from tracker.rescue.media import file_sha256
from tracker.rescue.model_library import ModelLibrary, verify_weights
from tracker.rescue.training_guide import starting_models
from tracker.rescue.training_workflow import load_training_state


def test_added_model_files_are_copied_once_without_changing_source(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ultralytics

    monkeypatch.setattr(
        ultralytics, "YOLO", lambda _: SimpleNamespace(task="detect", names={0: "fire"})
    )
    original = tmp_path / "downloaded.pt"
    original.write_bytes(b"trusted fixture")
    library = ModelLibrary(tmp_path)
    model = library.register_weights("Fire starter", original, managed=True)
    assert model.managed_directory
    assert Path(model.config.models[0].weights).read_bytes() == original.read_bytes()
    assert library.register_weights("Repeated import", original, managed=True).id == model.id
    original.unlink()
    verify_weights(model.config)
    assert len(library.catalog.versions) == 1 and library.catalog.active_id is None


def completed_run(workspace: Path, token: str = "one", status: str = "completed") -> Path:
    root = workspace / "annotations/training" / f"rescue-train-20260913-100000-{token}"
    root.mkdir(parents=True)
    weights = root / "last.pt"
    weights.write_bytes(token.encode())
    (root / "best.pt").write_bytes(b"not the chosen checkpoint")
    config = root / "review.yaml"
    config.write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "name": "trained",
                        "weights": str(weights),
                        "weights_sha256": file_sha256(weights),
                        "classes": ["fire"],
                    }
                ],
                "review_classes": ["fire"],
            }
        )
    )
    (root / "project.json").write_text(json.dumps({"source": {"path": "wildfire.mp4"}}))
    (root / "manifest.json").write_text(json.dumps({"projects": [{"snapshot": "project.json"}]}))
    (root / "request.json").write_text(json.dumps({"data": str(root / "data.yaml")}))
    result = root / "result.json"
    result.write_text(
        json.dumps(
            {
                "status": status,
                "best_weights": str(weights),
                "review_config": str(config),
                "training_mode": "practice",
            }
        )
    )
    return result


def finish(studio: AnnotationApp) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        studio.root.update()
        if not studio.training_panel.quick.library_busy:
            return
        time.sleep(0.01)
    pytest.fail("Model discovery did not finish")


def test_discovery_manages_chosen_weights_and_is_idempotent(tmp_path: Path) -> None:
    result = completed_run(tmp_path)
    before = {p: p.read_bytes() for p in result.parent.iterdir() if p.is_file()}
    synced = sync_trained_models(tmp_path)
    assert not synced.warnings
    (version,) = synced.library.catalog.versions
    assert version.name == "wildfire - Version 1"
    assert version.source_videos == ["wildfire.mp4"]
    assert version.training_mode == "practice"
    assert version.created_utc.startswith("2026-09-13T10:00:00")
    managed = Path(version.config.models[0].weights)
    assert managed.is_relative_to(tmp_path / "models/studio")
    assert managed.name == "model.pt" and managed.read_bytes() == b"one"
    assert synced.library.catalog.active_id is None
    assert all(path.read_bytes() == value for path, value in before.items())
    assert save_trained_model(tmp_path, result).id == version.id
    assert len(sync_trained_models(tmp_path).library.catalog.versions) == 1
    assert len(list((tmp_path / "models/studio").iterdir())) == 1
    assert starting_models(tmp_path)[0].name == version.name


def test_managed_model_survives_missing_original_and_never_replaces_default(tmp_path: Path) -> None:
    result = completed_run(tmp_path)
    one = save_trained_model(tmp_path, result)
    library = ModelLibrary(tmp_path)
    library.activate(one.id)
    two = save_trained_model(tmp_path, completed_run(tmp_path, "two"))
    assert two.name == "wildfire - Version 2"
    assert ModelLibrary(tmp_path).catalog.active_id == one.id
    (result.parent / "last.pt").unlink()
    (result.parent / "review.yaml").unlink()
    verify_weights(one.config)
    assert model_available(one)
    assert len(sync_trained_models(tmp_path).library.catalog.versions) == 2
    Path(two.config.models[0].weights).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="changed"):
        ModelLibrary(tmp_path).activate(two.id)
    assert ModelLibrary(tmp_path).catalog.active_id == one.id


def test_discovery_skips_failed_qa_and_bad_records_without_hiding_good_models(
    tmp_path: Path,
) -> None:
    good = completed_run(tmp_path)
    completed_run(tmp_path, "failed", status="failed")
    broken = completed_run(tmp_path, "broken")
    (broken.parent / "last.pt").write_bytes(b"changed")
    completed_run(tmp_path / "diagnostics", "qa")
    synced = sync_trained_models(tmp_path)
    assert len(synced.library.catalog.versions) == 1
    assert synced.library.catalog.versions[0].training_result == str(good)
    assert len(synced.warnings) == 1


def test_manual_registered_training_not_duplicated_and_names_preserved(tmp_path: Path) -> None:
    result = completed_run(tmp_path)
    library = ModelLibrary(tmp_path)
    original = library.register("My chosen name", result.parent / "review.yaml", result)
    synced = sync_trained_models(tmp_path)
    assert [(v.id, v.name) for v in synced.library.catalog.versions] == [
        (original.id, original.name)
    ]


def test_my_models_ui_recovers_selects_renames_and_reopens_folder_without_file_picker(
    studio: AnnotationApp,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    quick = studio.training_panel.quick
    first = completed_run(quick.workspace)
    second = completed_run(quick.workspace, "two")
    before = studio.session.path.read_bytes()
    monkeypatch.setattr("tkinter.filedialog.askopenfilename", lambda **k: pytest.fail("no picker"))
    quick.refresh_models()
    finish(studio)
    assert len(quick.shelf.table.get_children()) == 2
    library = ModelLibrary(quick.workspace)
    version = next(v for v in library.catalog.versions if v.training_result == str(second))
    quick.shelf.table.selection_set(version.id)
    quick.select_model()
    assert quick.try_button.instate(["!disabled"])
    assert quick.retrain_button.instate(["!disabled"])
    assert load_training_state(studio.session.path).quick_model_id == version.id
    assert "wildfire" in quick.result_label.get()
    assert library.catalog.active_id is None
    monkeypatch.setattr("tkinter.simpledialog.askstring", lambda *a, **k: "My improved fire model")
    quick.rename_button.invoke()
    assert ModelLibrary(quick.workspace).get(version.id).name == "My improved fire model"
    opened = []
    monkeypatch.setattr("os.startfile", lambda path: opened.append(Path(path)))
    quick.folder_button.invoke()
    assert opened == [Path(version.managed_directory)]
    assert studio.session.path.read_bytes() == before and first.is_file()
    quick.refresh_models()
    finish(studio)
    assert quick.shelf.selected().id == version.id
    assert "My improved fire model" in quick.result_label.get()


def test_preview_and_retraining_use_the_selected_model_not_the_latest_run(
    studio: AnnotationApp,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    quick = studio.training_panel.quick
    result = completed_run(quick.workspace)
    completed_run(quick.workspace, "newer")
    quick.refresh_models()
    finish(studio)
    version = next(
        v
        for v in ModelLibrary(quick.workspace).catalog.versions
        if v.training_result == str(result)
    )
    quick.shelf.table.selection_set(version.id)
    quick.select_model()
    invoked = []
    monkeypatch.setattr(quick, "train", lambda: invoked.append(studio.training_panel.weights.get()))
    quick.retrain_button.invoke()
    assert invoked == [version.config.models[0].weights]
    jobs = []

    def capture(*args, **kwargs):
        jobs.append(args)
        raise ValueError("captured launch")

    monkeypatch.setattr("tracker.rescue.quick_training_ui.DesktopJob", capture)
    monkeypatch.setattr(studio.training_panel, "error", lambda _: None)
    quick.try_button.invoke()
    args = jobs[0][2]
    assert args[args.index("--config") + 1] == str(
        ModelLibrary(quick.workspace).config_path(version.id)
    )
    assert Path(args[args.index("--output") + 1]).is_relative_to(Path(version.managed_directory))
    assert quick.preview_model_id == version.id
    studio.training_panel.saved_state.quick_preview = "some-existing-preview.mp4"
    studio.training_panel.saved_state.quick_preview_model_id = "different-model"
    quick.update_buttons()
    assert quick.replay_button.instate(["disabled"])
