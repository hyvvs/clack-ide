"""Check carry-forward workflows with a bundled runtime and the isolated multi-object QA clip."""

from __future__ import annotations

import argparse
import json
import sys
import time
import tkinter as tk
from pathlib import Path
from uuid import uuid4

import numpy as np

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession
from tracker.rescue.frame_tracking import merge_tracking, track_frames
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.tracking_labels import box_identity, box_state


def verify_hidden_controls(document: AnnotationDocument, output: Path) -> dict:
    root = tk.Tk()
    root.withdraw()
    errors: list[str] = []
    root.report_callback_exception = lambda kind, value, trace: errors.append(str(value))
    reader = FrameReader(Path(document.source.path))
    session = AnnotationSession(document.model_copy(deep=True), output / "ui-project.json")
    try:
        app = AnnotationApp(root, reader, session)
        app.carry.track_button.invoke()
        deadline = time.monotonic() + 10
        while app.carry.busy and time.monotonic() < deadline:
            root.update()
            time.sleep(0.01)
        assert not app.carry.busy and app.index == 1 and not errors
        assert all(box_state(session.frame(1), i) == "Tracked" for i in range(3))
        identities = [box_identity(session.frame(1), i) for i in range(3)]
        app.carry.enabled.set(True)
        app.carry.toggle()
        app.next_button.invoke()
        deadline = time.monotonic() + 10
        while app.carry.busy and time.monotonic() < deadline:
            root.update()
            time.sleep(0.01)
        assert not app.carry.busy and app.index == 2 and not errors
        assert identities == [box_identity(session.frame(2), i) for i in range(3)]
        assert not session.frame(2).reviewed and root.state() == "withdrawn"
        root.update_idletasks()
        assert app.carry.winfo_reqwidth() <= 1000
        session.save()
        return {
            "track_next": "passed",
            "auto_next": "passed",
            "ids_preserved": True,
            "carry_required_width": app.carry.winfo_reqwidth(),
            "windows_hidden": True,
        }
    finally:
        reader.close()
        for callback in root.tk.call("after", "info"):
            root.tk.call("after", "cancel", callback)
        root.destroy()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    original_hash = file_sha256(args.project)
    document = AnnotationDocument.model_validate_json(args.project.read_bytes())
    if document.source.frame_count != 85 or len(document.frames[0].objects) != 3:
        raise ValueError("Use the disposable three-object, 85-frame tracking QA fixture.")
    result = track_frames(document, 0, 84)
    assert len(result.proposals) == 252, result.stops
    np.testing.assert_allclose(
        [p.box.bbox_xyxy for p in result.proposals if p.frame_index == 84],
        [(104, 20, 136, 52), (116, 80, 148, 112), (50, 150, 82, 182)],
        atol=4,
    )
    tracked, changes = merge_tracking(document, result)
    assert changes.added == 252
    assert tracked.to_truth() == document.to_truth()
    output = args.output / f"tracking-runtime-qa-{uuid4().hex[:8]}"
    output.mkdir(parents=True, exist_ok=False)
    session = AnnotationSession(document, output / "project.json")
    session.replace_document(tracked)
    assert session.undo() and session.document == document
    session.replace_document(tracked)
    objects = session.frame(5).objects
    x1, y1, x2, y2 = objects[0].bbox_xyxy
    objects[0].bbox_xyxy = (x1 + 2, y1, x2 + 2, y2)
    session.replace_frame(5, objects, edited_index=0)
    corrected = session.frame(5).objects[0]
    preview = track_frames(session.document, 5, 84, [0], method="fixed")
    updated, changes = merge_tracking(session.document, preview)
    assert changes.replaced == 79 and not changes.added
    assert all(f.objects[0] == corrected for f in updated.frames if f.frame_index > 5)
    session.replace_document(updated)
    session.save()
    assert AnnotationSession.open(session.path, document.source).document == session.document
    session.replace_frame(7, session.frame(7).objects[1:])
    deletion = track_frames(session.document, 7, 84, method="fixed")
    deleted, changes = merge_tracking(session.document, deletion)
    assert changes.removed == 77
    assert all(len(f.objects) == 2 for f in deleted.frames if f.frame_index > 7)
    assert file_sha256(args.project) == original_hash
    report = {
        "status": "passed",
        "python": sys.executable,
        "isolated": sys.flags.isolated,
        "tracked_box_frames": 252,
        "corrected_box_frames": 79,
        "deleted_stale_box_frames": 77,
        "save_reopen_undo": "passed",
        "input_project_unchanged": True,
        "adjacent_ui": verify_hidden_controls(document, output),
        "note": "Synthetic workflow evidence only, not real-world tracking accuracy.",
    }
    with (output / "verification.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    print(f"Tracking runtime verified: {output / 'verification.json'}")


if __name__ == "__main__":
    main()
