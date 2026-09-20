from __future__ import annotations

from typing import Any


def review_queue(result: dict[str, Any], errors_only: bool = True) -> list[dict[str, Any]]:
    rows = []
    for frame in result["per_frame"]:
        errors = frame["false_positives"] + frame["false_negatives"]
        switches = frame.get("identity_switches", 0)
        if not errors_only or errors or switches:
            rows.append({**frame, "prediction_status": "scored"})
    missing_truth = {
        frame["frame_index"]: frame["objects"]
        for frame in result.get("unscored_reviewed_frames", [])
    }
    rows.extend(
        {
            "frame_index": index,
            "prediction_status": "missing",
            "true_positives": None,
            "false_positives": None,
            "false_negatives": None,
            "identity_switches": None,
            "truth_objects": missing_truth.get(index, []),
        }
        for index in result["coverage"]["missing_prediction_frames"]
    )
    return sorted(rows, key=lambda row: row["frame_index"])


def comparison_reasons(first: dict[str, Any], second: dict[str, Any]) -> list[str]:
    reasons = []
    if first["source_video_sha256"] != second["source_video_sha256"]:
        reasons.append("different source videos")
    if first["annotation_sha256"] != second["annotation_sha256"]:
        reasons.append("different reviewed label snapshots")
    if first["evaluation"]["iou_threshold"] != second["evaluation"]["iou_threshold"]:
        reasons.append("different IoU thresholds")
    first_frames = {frame["frame_index"] for frame in first["per_frame"]}
    second_frames = {frame["frame_index"] for frame in second["per_frame"]}
    if first_frames != second_frames:
        reasons.append("different scored-frame coverage")
    return reasons
