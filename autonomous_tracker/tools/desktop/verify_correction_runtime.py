"""Exercise whole-video inference, correction and fine-tuning with hidden Studio windows."""

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
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.training_data import verify_dataset, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    args = parser.parse_args()
    directory = args.output.resolve() / f"correction-runtime-qa-{uuid4().hex[:8]}"
    (directory / "annotations").mkdir(parents=True, exist_ok=False)
    (directory / "configs").mkdir()
    video = directory / "synthetic-full-video.avi"
    count = 312
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"FFV1"), 24, (96, 96))
    assert writer.isOpened()
    for index in range(count):
        frame = np.full((96, 96, 3), 30 + index % 10, dtype=np.uint8)
        cv2.rectangle(frame, (20, 20), (60, 60), (20, 180, 220), -1)
        writer.write(frame)
    writer.release()
    reader = FrameReader(video)
    marker = TruthObject(label="marker", bbox_xyxy=(20, 20, 60, 60))
    session = AnnotationSession(
        AnnotationDocument(
            source=reader.source,
            classes=["marker"],
            frames=[
                LabelFrame(frame_index=index, reviewed=True, objects=[marker]) for index in range(3)
            ],
        ),
        directory / "annotations/full-video.json",
    )
    session.save()
    video_hash, weights_hash = file_sha256(video), file_sha256(args.weights)
    root = tk.Tk()
    root.withdraw()
    errors: list[str] = []
    root.report_callback_exception = lambda kind, value, trace: errors.append(str(value))
    original_toplevel = tk.Toplevel.__init__

    def hidden(window, *args, **kwargs):
        original_toplevel(window, *args, **kwargs)
        window.withdraw()

    app = None
    try:
        with (
            patch.object(tk.Toplevel, "__init__", hidden),
            patch("tkinter.messagebox.askyesno", return_value=True),
            patch("tkinter.messagebox.showinfo"),
            patch(
                "tkinter.messagebox.showerror", side_effect=lambda *a, **k: errors.append(str(a))
            ),
            patch(
                "tkinter.filedialog.askdirectory", side_effect=AssertionError("No folder picker")
            ),
            patch(
                "tkinter.filedialog.askopenfilename", side_effect=AssertionError("No file picker")
            ),
            patch(
                "tkinter.filedialog.askopenfilenames", side_effect=AssertionError("No file picker")
            ),
        ):
            app = AnnotationApp(root, reader, session)
            panel, quick = app.training_panel, app.training_panel.quick
            panel.weights.set(str(args.weights.resolve()))
            panel.epochs.set("1")
            panel.image_size.set("64")
            panel.batch.set("2")
            panel.refresh()

            def finish() -> None:
                deadline = time.monotonic() + 180
                while (
                    panel.busy or quick.library_busy or app.import_busy or app.pending_correction
                ) and time.monotonic() < deadline:
                    root.update()
                    time.sleep(0.01)
                assert not panel.busy and not app.import_busy, panel.log.get("1.0", "end")
                assert not errors, errors
                assert root.state() == "withdrawn"

            finish()
            quick.train_button.invoke()
            assert quick.busy
            finish()
            starting = quick.shelf.selected()
            assert starting is not None and starting.training_result
            starting_hash = file_sha256(Path(starting.config.models[0].weights))
            protected = [session.frame(index) for index in range(3)]
            print("QA: trained version ready; analyzing all 312 frames", flush=True)
            quick.analyze_button.invoke()
            assert quick.busy
            finish()
            run = Path(panel.saved_state.correction_run)
            metadata = json.loads((run / "summary.json").read_bytes())
            assert metadata["status"] == "completed" and metadata["frames_reviewed"] == count
            assert len(session.document.frames) == count
            assert [session.frame(index) for index in range(3)] == protected
            assert all(not session.frame(index).reviewed for index in range(3, count))
            assert app.correction_bar.winfo_manager() == "pack"
            assert app.tabs.select() == app.tabs.tabs()[0]
            assert app.suggestions is not None and len(app.suggestions.frames) == count
            assert panel.saved_state.correction_model_id == starting.id
            session.replace_frame(310, [marker], reviewed=True)
            session.replace_frame(311, [], reviewed=True)
            app.refresh()
            corrected = session.document.model_copy(deep=True)
            print(
                "QA: correcting late frames and training from the selected checkpoint", flush=True
            )
            app.train_corrections_button.invoke()
            assert quick.busy
            finish()
            updated = quick.shelf.selected()
            assert updated is not None and updated.id != starting.id
            result = Path(updated.training_result)
            request = json.loads((result.parent / "request.json").read_bytes())
            assert (
                Path(request["baseline"]).resolve()
                == Path(starting.config.models[0].weights).resolve()
            )
            assert verify_dataset(Path(request["data"]))["frames"] == {"train": 5}
            assert session.document == corrected
            print(
                "QA: re-analyzing with the updated model; checking correction protection",
                flush=True,
            )
            quick.analyze_button.invoke()
            assert quick.busy
            finish()
            assert session.frame(310) == next(f for f in corrected.frames if f.frame_index == 310)
            assert session.frame(311) == next(f for f in corrected.frames if f.frame_index == 311)
            assert len(session.document.frames) == count
            assert panel.saved_state.correction_model_id == updated.id
            assert file_sha256(Path(starting.config.models[0].weights)) == starting_hash
            assert file_sha256(video) == video_hash and file_sha256(args.weights) == weights_hash
            assert ModelLibrary(directory).catalog.active_id is None
            report = {
                "status": "passed",
                "synthetic_only_not_accuracy_evidence": True,
                "all_windows_hidden": True,
                "real_yolo_frames_per_run": count,
                "full_video_runs": 2,
                "real_training_runs": 2,
                "late_frame_corrections_included_in_training": True,
                "fine_tunes_selected_model_not_random_weights": True,
                "manual_and_reviewed_frames_protected_on_reanalysis": True,
                "automatically_saved_model_versions": [starting.name, updated.name],
                "original_video_and_models_unchanged": True,
                "no_file_or_folder_dialogs": True,
                "default_model_unchanged": True,
                "training_result": str(result),
                "application_module": str(
                    Path(__import__(AnnotationApp.__module__, fromlist=["x"]).__file__).resolve()
                ),
            }
            receipt = directory / "verification.json"
            write_json(receipt, report)
            print(receipt, flush=True)
    finally:
        if app is not None and app.training_panel.quick.job is not None:
            app.training_panel.quick.job.process.terminate()
            app.training_panel.quick.job.process.wait(timeout=20)
        for callback in root.tk.call("after", "info"):
            root.tk.call("after", "cancel", callback)
        root.destroy()
        reader.close()


if __name__ == "__main__":
    main()
