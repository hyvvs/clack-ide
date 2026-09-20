"""Run one-button practice training and preview in a private runtime, with hidden windows."""

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
from tracker.rescue.training_data import verify_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    args = parser.parse_args()
    directory = args.output.resolve() / f"quick-runtime-qa-{uuid4().hex[:8]}"
    (directory / "annotations").mkdir(parents=True, exist_ok=False)
    (directory / "configs").mkdir()
    video = directory / "synthetic.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"FFV1"), 10, (96, 96))
    assert writer.isOpened()
    for index in range(4):
        frame = np.full((96, 96, 3), 30 + index, dtype=np.uint8)
        cv2.rectangle(frame, (20, 20), (60, 60), (20, 180, 220), -1)
        writer.write(frame)
    writer.release()
    reader = FrameReader(video)
    doc = AnnotationDocument(
        source=reader.source,
        classes=["marker", "unused category"],
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
    session = AnnotationSession(doc, directory / "annotations" / "synthetic.json")
    session.save()
    labels_hash, video_hash, weights_hash = (
        file_sha256(session.path),
        file_sha256(video),
        file_sha256(args.weights),
    )
    root = tk.Tk()
    root.withdraw()
    errors: list[str] = []
    confirmations: list[object] = []
    root.report_callback_exception = lambda kind, value, trace: errors.append(str(value))
    original_toplevel = tk.Toplevel.__init__

    def hidden(window, *args, **kwargs):
        original_toplevel(window, *args, **kwargs)
        window.withdraw()

    def confirm(*args, **kwargs):
        confirmations.append(args)
        return True

    try:
        with (
            patch.object(tk.Toplevel, "__init__", hidden),
            patch("tkinter.messagebox.askyesno", side_effect=confirm),
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
            panel = app.training_panel
            panel.weights.set(str(args.weights.resolve()))
            panel.epochs.set("1")
            panel.image_size.set("64")
            panel.batch.set("2")
            panel.refresh()
            assert panel.views.select() == str(panel.quick)
            assert "unused category" in panel.quick.summary.get()
            panel.quick.train_button.invoke()
            assert panel.quick.busy

            def finish() -> None:
                deadline = time.monotonic() + 120
                while panel.busy and time.monotonic() < deadline:
                    root.update()
                    time.sleep(0.01)
                assert not panel.busy, panel.log.get("1.0", "end")
                assert not errors, errors

            finish()
            assert len(confirmations) == 1
            result = Path(panel.saved_state.quick_result)
            payload = json.loads(result.read_bytes())
            assert payload["training_mode"] == "practice"
            assert payload["checkpoint_selection"] == "last_epoch"
            assert not payload["independently_tested"]
            library = ModelLibrary(directory)
            (saved,) = library.catalog.versions
            assert saved.name == "synthetic - Version 1"
            assert saved.training_result == str(result)
            assert library.catalog.active_id is None
            assert Path(saved.config.models[0].weights).is_relative_to(directory / "models/studio")
            assert file_sha256(Path(saved.config.models[0].weights)) == file_sha256(
                Path(payload["best_weights"])
            )
            assert panel.quick.shelf.selected().id == saved.id
            assert panel.quick.rename_button.instate(["!disabled"])
            assert panel.quick.folder_button.instate(["!disabled"])
            request = json.loads((result.parent / "request.json").read_bytes())
            data = Path(request["data"])
            assert verify_dataset(data)["frames"] == {"train": 3}
            assert not (data.parent / "images/val").exists()
            panel.quick.try_button.invoke()
            assert panel.quick.busy
            finish()
            preview = panel.quick.preview_window
            assert preview is not None and preview.state() == "withdrawn"
            root.update_idletasks()
            assert preview.photo is not None
            preview.restart()
            preview.toggle()
            root.update()
            preview.destroy()
            assert labels_hash == file_sha256(session.path)
            assert video_hash == file_sha256(video)
            assert weights_hash == file_sha256(args.weights)
            report = {
                "status": "passed",
                "synthetic_only": True,
                "all_windows_hidden": True,
                "one_training_confirmation": len(confirmations) == 1,
                "no_file_or_folder_dialogs": True,
                "single_video_without_recording_or_split_setup": True,
                "unused_tag_did_not_block": True,
                "labels_reviews_source_and_baseline_unchanged": True,
                "validation_partition_created": False,
                "training_result": str(result),
                "preview": panel.saved_state.quick_preview,
                "preview_opened_and_played": True,
                "automatically_saved_in_my_models": True,
                "managed_weights": saved.config.models[0].weights,
                "model_name": saved.name,
                "default_model_unchanged": True,
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
