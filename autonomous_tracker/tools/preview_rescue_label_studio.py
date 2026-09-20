"""Launch a deterministic synthetic UI fixture, never an accuracy benchmark."""

from __future__ import annotations

import json
import tkinter as tk
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, LabelFrame
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import FrameReader
from tracker.rescue.observations import Observation
from tracker.rescue.scoring import save_evaluation, score_saved_run


def main() -> None:
    directory = Path("diagnostics") / f"synthetic-label-ui-{uuid4().hex[:8]}"
    directory.mkdir(parents=True, exist_ok=False)
    video = directory / "synthetic-shapes-not-rescue-footage.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"MJPG"), 10, (960, 540))
    if not writer.isOpened():
        raise RuntimeError("could not create synthetic fixture video")
    labels = []
    records = []
    try:
        for index in range(12):
            frame = np.full((540, 960, 3), (35, 25, 15), dtype=np.uint8)
            cv2.putText(
                frame,
                "SYNTHETIC UI TEST / NOT RESCUE ACCURACY",
                (25, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (220, 230, 240),
                2,
            )
            objects, observations = [], []
            if index < 8:
                box = (100.0 + index * 8, 180.0, 220.0 + index * 8, 360.0)
                cv2.rectangle(frame, (round(box[0]), 180), (round(box[2]), 360), (70, 170, 245), -1)
                objects.append(TruthObject(label="test-shape", bbox_xyxy=box, object_id="shape-1"))
                if index != 3:
                    observations.append(
                        Observation("synthetic", "test-shape", 0.8, box, 1 if index < 5 else 2)
                    )
            if index in {1, 8}:
                observations.append(
                    Observation("synthetic", "test-shape", 0.6, (500.0, 200.0, 620.0, 350.0), 9)
                )
            writer.write(frame)
            labels.append(LabelFrame(frame_index=index, objects=objects, reviewed=True))
            records.append(
                {
                    "schema_version": 1,
                    "frame_index": index,
                    "source_time_s": index / 10,
                    "read_process_encode_ms": 15 + index,
                    "observations": [asdict(obs) for obs in observations],
                }
            )
    finally:
        writer.release()
    reader = FrameReader(video)
    document = AnnotationDocument(
        source=reader.source,
        classes=["test-shape"],
        frames=labels,
        incident_id="SYNTHETIC-UI-TEST-NOT-A-BENCHMARK",
        split="unassigned",
    )
    session = AnnotationSession(document, directory / "project.json")
    session.save()
    run = directory / "synthetic-run"
    run.mkdir()
    metadata = {
        "schema_version": 1,
        "status": "completed",
        "frames_reviewed": len(records),
        "source_video_sha256": reader.source.sha256,
        "image_dimensions": [960, 540],
        "model_settings": {"synthetic_fixture_not_yolo": True},
        "timing_note": "Synthetic fixture timings, not measured performance",
    }
    (run / "summary.json").write_text(json.dumps(metadata), encoding="utf-8")
    (run / "frames.jsonl").write_text("\n".join(map(json.dumps, records)) + "\n", encoding="utf-8")
    result = score_saved_run(run, document)
    output = save_evaluation(directory / "evaluations", document, result)
    print(f"Synthetic UI fixture: {directory.resolve()}", flush=True)
    root = tk.Tk()
    app = AnnotationApp(root, reader, session)
    app.add_result(result, str(output.resolve()))
    app.tabs.select(1)
    root.mainloop()
    reader.close()


if __name__ == "__main__":
    main()
