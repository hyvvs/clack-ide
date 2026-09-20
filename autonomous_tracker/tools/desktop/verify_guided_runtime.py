"""Exercise the guided training UI in an isolated runtime with hidden synthetic projects."""

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
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, LabelFrame
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.training_data import verify_dataset
from tracker.rescue.training_guide import suggested_group
from tracker.rescue.training_guide_ui import PurposeDialog


def create_project(directory: Path, name: str, shade: int) -> Path:
    video = directory / f"{name}.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"FFV1"), 10, (160, 100))
    assert writer.isOpened()
    for index in range(4):
        frame = np.full((100, 160, 3), shade + index, dtype=np.uint8)
        cv2.rectangle(frame, (20, 20), (60, 60), (10, 180, 220), -1)
        writer.write(frame)
    writer.release()
    reader = FrameReader(video)
    try:
        document = AnnotationDocument(
            source=reader.source,
            classes=["marker"],
            frames=[
                LabelFrame(
                    frame_index=index,
                    reviewed=index < 3,
                    objects=[]
                    if index == 1
                    else [TruthObject(label="marker", bbox_xyxy=(20, 20, 60, 60))],
                )
                for index in range(4)
            ],
        )
        session = AnnotationSession(document, directory / "annotations" / f"{name}.json")
        session.save()
        return session.path
    finally:
        reader.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    directory = args.output.resolve() / f"guided-runtime-qa-{uuid4().hex[:8]}"
    (directory / "annotations").mkdir(parents=True, exist_ok=False)
    (directory / "configs").mkdir()
    first = create_project(directory, "synthetic-teach", 30)
    second = create_project(directory, "synthetic-check", 80)
    reader = FrameReader(directory / "synthetic-teach.avi")
    session = AnnotationSession.open(first, reader.source)
    original_frames = [frame.model_dump_json() for frame in session.document.frames]
    original_source_hash = file_sha256(Path(session.document.source.path))
    root = tk.Tk()
    root.withdraw()
    errors = []
    root.report_callback_exception = lambda kind, value, trace: errors.append(str(value))
    original_toplevel = tk.Toplevel.__init__

    def hidden(window, *args, **kwargs):
        original_toplevel(window, *args, **kwargs)
        window.withdraw()

    try:
        with (
            patch.object(tk.Toplevel, "__init__", hidden),
            patch(
                "tkinter.messagebox.showerror", side_effect=lambda *a, **k: errors.append(str(a))
            ),
            patch(
                "tkinter.filedialog.askopenfilenames", side_effect=AssertionError("No JSON picker")
            ),
            patch(
                "tkinter.filedialog.askdirectory", side_effect=AssertionError("No output picker")
            ),
        ):
            app = AnnotationApp(root, reader, session)
            panel = app.training_panel
            panel.refresh()
            assert panel.views.select() == str(panel.quick)
            panel.guide.choose_purpose("training")
            dialog = panel.guide.dialog
            assert isinstance(dialog, PurposeDialog) and dialog.state() == "withdrawn"
            assert dialog.recording.get().startswith("recording-")
            root.update_idletasks()
            dialog_requested_size = (dialog.winfo_reqwidth(), dialog.winfo_reqheight())
            dialog.save()
            root.update()
            assert app.split.get() == "training"
            panel.add_projects()
            picker = panel.picker
            assert picker is not None and picker.state() == "withdrawn"
            deadline = time.monotonic() + 10
            while picker.scanning and time.monotonic() < deadline:
                root.update()
                time.sleep(0.01)
            assert not picker.scanning
            key = next(key for key, video in picker.rows.items() if video.path == second)
            picker.table.selection_set(key)
            picker.accept()
            root.update()
            video = next(video for video in panel.guide.videos if video.path == second)
            assert not panel.set_purpose(
                second, "validation", suggested_group(video, panel.guide.videos)
            )
            root.update()
            panel.guide.checks()
            assert not panel.guide.issues
            panel.guide.prepare_button.invoke()
            deadline = time.monotonic() + 20
            while panel.export_busy and time.monotonic() < deadline:
                root.update()
                time.sleep(0.01)
            assert not panel.export_busy and not errors
            assert panel.guide.step == 2 and panel.process is None
            data = Path(panel.dataset.get())
            assert verify_dataset(data)["frames"] == {"train": 3, "val": 3}
            assert original_frames == [frame.model_dump_json() for frame in session.document.frames]
            assert original_source_hash == file_sha256(Path(session.document.source.path))
            session.replace_frame(0, [])
            panel.guide.navigate(1)
            assert not panel.export_is_current
            assert panel.guide.start_button.instate(["disabled"])
            assert root.state() == "withdrawn"
            report = {
                "status": "passed",
                "note": "Synthetic shapes only. No user data or real model training used here.",
                "default_guided_view": True,
                "saved_video_picker": True,
                "no_json_or_output_dialogs": True,
                "purpose_preserves_labels": True,
                "real_dataset_export": str(data),
                "stale_data_blocks_training": True,
                "all_windows_hidden": True,
                "purpose_dialog_requested_size": dialog_requested_size,
                "application_module": str(
                    Path(__import__(AnnotationApp.__module__, fromlist=["x"]).__file__).resolve()
                ),
            }
            receipt = directory / "verification.json"
            receipt.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(receipt, flush=True)
    finally:
        for callback in root.tk.call("after", "info"):
            root.tk.call("after", "cancel", callback)
        root.destroy()
        reader.close()


if __name__ == "__main__":
    main()
