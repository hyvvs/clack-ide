from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import pytest
from test_rescue_model_library_batch import model_config
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import home as home

from tracker.rescue.batch import read_batch
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.model_library_ui import ModelLibraryWindow
from tracker.rescue.studio_home import StudioHome


def pump(root: Any, busy: Any) -> None:
    deadline = time.monotonic() + 10
    while busy() and time.monotonic() < deadline:
        root.update()
        time.sleep(0.01)
    assert not busy()


def test_model_library_gui_explicit_activation_rollback_and_cleanup(
    home: StudioHome, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = ModelLibrary(home.workspace)
    one = library.register("One", model_config(home.workspace))
    two = library.register("Two", model_config(home.workspace, "two"))
    library.activate(one.id)
    monkeypatch.setattr(
        "tracker.rescue.model_library_ui.messagebox.askyesno", lambda *a, **kw: True
    )
    home.open_models()
    window = home.model_window
    assert window is not None
    pump(home.root, lambda: window.busy)
    window.table.selection_set(two.id)
    window.technical.set(True)
    window.details()
    assert "Local weight references" in window.info.get("1.0", "end")
    assert ModelLibrary(home.workspace).catalog.active_id == one.id
    window.activate()
    pump(home.root, lambda: window.busy)
    assert home.config == library.config_path(two.id)
    window.rollback()
    pump(home.root, lambda: window.busy)
    assert home.config == library.config_path(one.id)
    callback = window.after_id
    window.close()
    assert callback not in home.root.tk.call("after", "info")


def test_batch_gui_prepares_without_running_and_resumes_saved_manifest(
    home: StudioHome, monkeypatch: pytest.MonkeyPatch
) -> None:
    home.activate_model(model_config(home.workspace))
    monkeypatch.setattr("tracker.rescue.batch_ui.messagebox.askyesno", lambda *a, **kw: True)
    before = {
        path: path.read_bytes()
        for item in home.library.items
        for path in [project.path for project in item.projects]
    }
    home.open_batches()
    window = home.batch_window
    assert window is not None
    window.create()
    pump(home.root, lambda: window.busy)
    assert window.path is not None and window.job is None
    assert read_batch(window.path).status == "pending"
    path, callback = window.path, window.after_id
    window.close()
    assert callback not in home.root.tk.call("after", "info")
    home.open_batches()
    assert home.batch_window is not None and home.batch_window.path == path
    assert all(source.read_bytes() == contents for source, contents in before.items())


def test_corrupt_active_model_fails_closed_and_empty_window_is_not_left_open(
    home: StudioHome,
) -> None:
    library = ModelLibrary(home.workspace)
    version = library.register("One", model_config(home.workspace))
    library.activate(version.id)
    library.config_path(version.id).write_text("models: []")
    restored = StudioHome(home.root, home.workspace)
    assert "Saved active model unavailable" in restored.model_label.get()
    with pytest.raises(ValueError, match="Explicitly select"):
        restored.require_model_config()
    restored.activate_model(model_config(home.workspace, "recovered"))
    assert restored.require_model_config().name == "recovered.yaml"
    library.store.path.write_text("invalid JSON")
    children = home.root.winfo_children()
    with pytest.raises(ValueError):
        ModelLibraryWindow(home.root, home.workspace, lambda _: None, lambda _: None)
    assert home.root.winfo_children() == children


def test_new_project_handoff_keeps_predictions_and_training_choice(
    home: StudioHome, monkeypatch: pytest.MonkeyPatch
) -> None:
    launches: list[tuple[Path, list[str]]] = []
    monkeypatch.setattr(home, "launch_editor", lambda path, args: launches.append((path, args)))
    project = home.library.items[0].projects[0].path
    video, run = home.library.items[0].video, home.workspace / "recognition-run"
    home.events.put(("created", (video, project, True, run, True)))
    home.poll()
    assert launches == [
        (
            project,
            [
                "--video",
                str(video),
                "--project",
                str(project),
                "--suggestions",
                str(run),
                "--training",
            ],
        )
    ]
