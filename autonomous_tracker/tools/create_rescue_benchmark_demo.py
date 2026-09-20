"""Create three synthetic clips and score fabricated detections; never field accuracy."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np

from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, LabelFrame
from tracker.rescue.benchmark import run_benchmark
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import FrameReader
from tracker.rescue.observations import Observation


def create_clip(
    root: Path, name: str, incident: str, positives: int, hits: bool, tint: int
) -> dict[str, str]:
    directory = root / name
    directory.mkdir()
    video = directory / "synthetic-shapes.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"MJPG"), 10, (640, 360))
    if not writer.isOpened():
        raise RuntimeError("Could not create synthetic fixture video")
    frames, records = [], []
    try:
        for index in range(positives + 2):
            image = np.full((360, 640, 3), (tint, 20, 30), dtype=np.uint8)
            cv2.putText(
                image,
                "SYNTHETIC TEST / NOT RESCUE ACCURACY",
                (15, 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (230, 230, 230),
                1,
            )
            cv2.putText(
                image,
                f"{name} / frame {index}",
                (15, 65),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (230, 230, 230),
                1,
            )
            objects, observations = [], []
            if index < positives:
                box = (100.0 + index * 8, 120.0, 180.0 + index * 8, 250.0)
                cv2.rectangle(image, (round(box[0]), 120), (round(box[2]), 250), (80, 190, 240), -1)
                objects.append(TruthObject(label="test-shape", bbox_xyxy=box, object_id="shape-1"))
                if hits:
                    observations.append(Observation("synthetic", "test-shape", 0.8, box, 1))
            writer.write(image)
            frames.append(LabelFrame(frame_index=index, objects=objects, reviewed=True))
            records.append(
                {
                    "schema_version": 1,
                    "frame_index": index,
                    "source_time_s": index / 10,
                    "read_process_encode_ms": 10 + index,
                    "observations": [asdict(obs) for obs in observations],
                }
            )
    finally:
        writer.release()
    reader = FrameReader(video)
    try:
        document = AnnotationDocument(
            source=reader.source,
            classes=["test-shape"],
            frames=frames,
            incident_id=incident,
            split="validation",
        )
    finally:
        reader.close()
    AnnotationSession(document, directory / "project.json").save()
    run = directory / "synthetic-run"
    run.mkdir()
    metadata = {
        "schema_version": 1,
        "status": "completed",
        "frames_reviewed": len(records),
        "source_video_sha256": document.source.sha256,
        "image_dimensions": [640, 360],
        "model_settings": {"synthetic_fixture_not_yolo": True},
        "timing_note": "Fabricated fixture timings, not measured performance",
    }
    (run / "summary.json").write_text(json.dumps(metadata), encoding="utf-8")
    (run / "frames.jsonl").write_text("\n".join(map(json.dumps, records)) + "\n", encoding="utf-8")
    return {"name": name, "project": f"{name}/project.json", "run": f"{name}/synthetic-run"}


def main() -> None:
    root = Path("diagnostics") / f"synthetic-benchmark-demo-{uuid4().hex[:8]}"
    root.mkdir(parents=True, exist_ok=False)
    entries = [
        create_clip(root, "clear-a", "SYNTHETIC-INCIDENT-A", 8, True, 25),
        create_clip(root, "clear-b", "SYNTHETIC-INCIDENT-A", 2, True, 45),
        create_clip(root, "missed", "SYNTHETIC-INCIDENT-B", 2, False, 65),
    ]
    manifest = root / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "name": "SYNTHETIC WORKFLOW TEST / NOT YOLO OR RESCUE ACCURACY",
                "split": "validation",
                "iou_threshold": 0.5,
                "entries": entries,
                "audit_projects": [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    directory, result = run_benchmark(manifest, root / "results")
    print("SYNTHETIC ONLY: fabricated detections and timings; no YOLO inference.")
    print(f"Manifest: {manifest.resolve()}")
    print(f"Report: {directory / 'report.md'}")
    print(f"Pooled box recall: {result['aggregate']['pooled']['overall']['recall']:.3f}")
    print(f"Equal-incident macro recall: {result['aggregate']['macro_incident']['recall']:.3f}")
    print("The smaller incident has zero recall; pooling alone obscures that failure.")


if __name__ == "__main__":
    main()
