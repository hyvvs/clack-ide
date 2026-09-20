"""Managed, replayable handoff from full-video inference to editable labeling."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.media import FrameReader
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.suggestions import load_suggestions, merge_suggestions
from tracker.rescue.training_workflow import load_training_state, save_training_state


def prepare_correction_project(
    workspace: Path,
    video: Path,
    run: Path,
    model_id: str,
    stopped: Callable[[], bool] = lambda: False,
) -> Path:
    version = ModelLibrary(workspace).get(model_id)
    reader = FrameReader(video)
    try:
        directory = workspace / "annotations/corrections" / reader.source.sha256[:24]
        project = directory / "labels.json"
        session = AnnotationSession.open(
            project, reader.source, None if project.exists() else version.config.review_classes
        )
        suggestions = load_suggestions(run, session.document)
        unknown = set(suggestions.classes) - set(session.document.classes)
        if unknown:
            raise ValueError(
                "This video's saved correction project has different tags. "
                "Open it and add the missing tags before importing another run."
            )
        updated, _, _ = merge_suggestions(session.document, suggestions, refresh_machine=True)
        if stopped():
            raise ValueError("Analysis stopped before saving the correction project.")
        session.replace_document(updated)
        session.save()
        state = load_training_state(project)
        state.correction_model_id, state.correction_run = model_id, str(run.resolve())
        state.weights = version.config.models[0].weights
        save_training_state(project, state)
        return project
    finally:
        reader.close()


def complete_video_run(output: Path) -> Path:
    results = list(output.glob("review-*/summary.json"))
    if len(results) != 1:
        raise ValueError("The video analysis did not produce one completed run.")
    payload = json.loads(results[0].read_bytes())
    if payload.get("status") != "completed":
        raise ValueError("The full video was not completed. Original labels are unchanged.")
    return results[0].parent
