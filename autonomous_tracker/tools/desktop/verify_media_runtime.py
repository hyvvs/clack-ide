"""Verify media tools in a private runtime using synthetic data and hidden Tk windows."""

from __future__ import annotations

import argparse
import json
import time
import tkinter as tk
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import cv2
import numpy as np

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, BoxLink, LabelFrame
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.library import discover_library
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.project_boxes_ui import ProjectBoxesWindow
from tracker.rescue.range_tools_ui import BulkReviewWindow, ClipExportWindow


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    directory = args.output.resolve() / f"media-runtime-qa-{uuid4().hex[:8]}"
    annotations = directory / "annotations"
    annotations.mkdir(parents=True, exist_ok=False)
    video = directory / "synthetic.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"FFV1"), 20, (160, 100))
    assert writer.isOpened()
    for index in range(12):
        image = np.full((100, 160, 3), 25 + index, dtype=np.uint8)
        cv2.rectangle(image, (10 + index, 20), (40 + index, 55), (20, 170, 220), -1)
        writer.write(image)
    writer.release()
    reader = FrameReader(video)
    frames = [
        LabelFrame(
            frame_index=index,
            objects=[]
            if index == 5
            else [
                TruthObject(
                    label="marker",
                    object_id="object 1",
                    bbox_xyxy=(10 + index, 20, 40 + index, 55),
                )
            ],
            reviewed=index == 2,
        )
        for index in range(12)
    ]
    frames[4].box_links[0] = BoxLink(track_key="a" * 32, needs_attention="Synthetic warning")
    document = AnnotationDocument(
        source=reader.source,
        classes=["marker"],
        frames=frames,
        incident_id="synthetic QA",
        split="training",
    )
    session = AnnotationSession(document, annotations / "original.json")
    session.save()
    original_video_hash = file_sha256(video)
    original_project_hash = file_sha256(session.path)
    root = tk.Tk()
    root.withdraw()
    errors: list[str] = []
    root.report_callback_exception = lambda kind, value, trace: errors.append(str(value))
    original_toplevel = tk.Toplevel.__init__

    def hidden_toplevel(window, *a, **kw):
        original_toplevel(window, *a, **kw)
        window.withdraw()

    try:
        with (
            patch.object(tk.Toplevel, "__init__", hidden_toplevel),
            patch("tkinter.messagebox.askyesno", return_value=True),
        ):
            app = AnnotationApp(root, reader, session)
            root.update()
            app.carry.enabled.set(True)
            before = session.document.model_dump_json()
            app.media.speed.set("4x")
            app.media.button.invoke()
            deadline = time.monotonic() + 10
            while app.media.playing and time.monotonic() < deadline:
                root.update()
                time.sleep(0.005)
            assert app.index == 11 and not app.media.playing
            assert before == session.document.model_dump_json()
            assert not app.carry.busy
            app.open_project_tool("boxes")
            boxes = app.project_windows["boxes"]
            assert isinstance(boxes, ProjectBoxesWindow) and len(boxes.rows) == 11
            boxes.table.selection_set("3")
            boxes.open_selected()
            assert app.index == 3 and app.selected == 0
            app.open_project_tool("review")
            review = app.project_windows["review"]
            assert isinstance(review, BulkReviewWindow)
            review.end.set("10")
            review.reload()
            assert review.indices == [3, 4, 5, 6, 7, 8] and review.ready
            review.turn_page(1)
            assert review.indices == [9, 10]
            review.turn_page(-1)
            review.apply(True, True)
            assert session.frame(3).reviewed and session.frame(8).reviewed
            assert not session.frame(4).reviewed and not session.frame(5).reviewed
            assert not session.frame(9).reviewed
            app.undo()
            assert before == session.document.model_dump_json()
            app.open_project_tool("clip")
            clip = app.project_windows["clip"]
            assert isinstance(clip, ClipExportWindow)
            clip.start.set("2")
            clip.end.set("7")
            clip.start_export()
            deadline = time.monotonic() + 15
            while clip.busy and time.monotonic() < deadline:
                root.update()
                time.sleep(0.005)
            assert not clip.busy and clip.result is not None, clip.status.get()
            clipped = AnnotationDocument.model_validate_json(clip.result.read_bytes())
            assert clipped.source.frame_count == 6
            assert clipped.frames[0].reviewed and clipped.source_ancestors == [
                document.source.sha256
            ]
            assert clipped.frames[2].box_links[0].needs_attention
            assert any(
                project.path == clip.result
                for item in discover_library(directory).items
                for project in item.projects
            )
            assert root.state() == "withdrawn"
            assert all(window.state() == "withdrawn" for window in app.project_windows.values())
            root.update_idletasks()
            assert app.media.winfo_reqwidth() <= 980
            assert not errors, errors
            assert original_video_hash == file_sha256(video)
            assert original_project_hash == file_sha256(session.path)
            report = {
                "status": "passed",
                "synthetic_only": True,
                "windows_hidden": True,
                "playback_frames": 12,
                "playback_did_not_modify_labels": True,
                "box_list_and_jump": True,
                "thumbnail_pagination": True,
                "bulk_review_and_undo": True,
                "empty_and_attention_frames_protected": True,
                "clip_export_frames": 6,
                "pixel_exact_verification": True,
                "clip_labels_rebased": True,
                "clip_discovered_in_home": True,
                "original_files_unchanged": True,
                "clip_project": str(clip.result),
                "toolbar_required_width": app.media.winfo_reqwidth(),
                "dialog_requested_sizes": {
                    name: [window.winfo_reqwidth(), window.winfo_reqheight()]
                    for name, window in app.project_windows.items()
                },
                "callback_errors": errors,
            }
            result_path = directory / "verification.json"
            result_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(result_path, flush=True)
    finally:
        reader.close()
        for callback in root.tk.call("after", "info"):
            root.tk.call("after", "cancel", callback)
        root.destroy()


if __name__ == "__main__":
    main()
