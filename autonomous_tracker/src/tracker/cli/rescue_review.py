"""Review rescue imagery and export observations without camera calibration."""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter, deque
from contextlib import suppress
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.rescue.config import ReviewModel, load_rescue_config
from tracker.rescue.detector import RescueDetector
from tracker.rescue.evaluation import Evaluation, load_ground_truth
from tracker.rescue.media import file_sha256
from tracker.rescue.observations import ObservationHistory
from tracker.rescue.regions import load_regions, review_regions
from tracker.rescue.render import render_review
from tracker.rescue.report import write_report
from tracker.rescue.state_store import StateStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--video", type=Path, help="local recorded video")
    inputs.add_argument("--camera", type=int, help="camera device index")
    parser.add_argument("--config", type=Path, default=Path("configs/rescue_review.yaml"))
    parser.add_argument("--output", type=Path, default=Path("diagnostics/rescue"))
    parser.add_argument("--show", action="store_true")
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--stop-file", type=Path, help="cooperative desktop cancellation signal")
    parser.add_argument(
        "--progress-file", type=Path, help="new progress receipt for a desktop batch"
    )
    parser.add_argument("--source-fps", type=float, help="override missing or incorrect source FPS")
    parser.add_argument("--annotations", type=Path, help="pixel-box labels for evaluation")
    parser.add_argument(
        "--regions", type=Path, help="operator-marked, frame-specific image polygons"
    )
    return parser


def run(args: argparse.Namespace) -> int:
    class Progress(ReviewModel):
        frames: int
        status: str

    progress_path = getattr(args, "progress_file", None)
    progress_store = StateStore(progress_path) if progress_path is not None else None
    if progress_store is not None:
        progress_store.save(Progress(frames=0, status="starting"))
    if args.max_frames < 0:
        raise ValueError("max-frames cannot be negative")
    if args.video is not None and not args.video.is_file():
        raise ValueError(f"video does not exist: {args.video}")
    if args.source_fps is not None and (not math.isfinite(args.source_fps) or args.source_fps <= 0):
        raise ValueError("source-fps must be finite and positive")
    if args.show and not cv2.currentUIFramework():
        raise RuntimeError("--show requires a GUI-enabled OpenCV installation")
    config = load_rescue_config(args.config)
    truth = load_ground_truth(args.annotations)
    video_sha256 = file_sha256(args.video) if args.video is not None else None
    if truth is not None and truth.video_sha256 is not None and truth.video_sha256 != video_sha256:
        raise ValueError("annotations belong to a different video (SHA256 mismatch)")
    regions = load_regions(args.regions)
    detectors = [RescueDetector(settings) for settings in config.models]
    enabled = {label for settings in config.models for label in settings.classes}
    unsupported = sorted(set(config.review_classes) - enabled)
    print("Enabled model labels: " + ", ".join(sorted(enabled)))
    if unsupported:
        print("Not modeled: " + ", ".join(unsupported))
    capture = cv2.VideoCapture(str(args.video) if args.video is not None else args.camera)
    writer: cv2.VideoWriter | None = None
    history = ObservationHistory(
        config.confirmation_frames, config.lost_after_s, config.history_length
    )
    evaluator = Evaluation(truth)
    timings: deque[float] = deque(maxlen=10000)
    class_counts: Counter[str] = Counter()
    warning_counts: Counter[str] = Counter()
    count = 0
    fallback_count = 0
    last_source_s = -1.0
    previous_thumbnail: NDArray[np.uint8] | None = None
    last_rendered: NDArray[np.uint8] | None = None
    last_change_s = 0.0
    dimensions: tuple[int, int] | None = None
    directory: Path | None = None
    status, error = "running", None
    start = time.perf_counter()
    try:
        if not capture.isOpened():
            raise RuntimeError("unable to open the requested video or camera")
        reported_fps = float(capture.get(cv2.CAP_PROP_FPS))
        fps = args.source_fps if args.source_fps is not None else reported_fps
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("source FPS is unavailable; supply --source-fps with the actual rate")
        timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        directory = args.output / f"review-{timestamp}-{uuid4().hex[:8]}"
        directory.mkdir(parents=True, exist_ok=False)
        print(f"Writing review to {directory.resolve()}")
        with (directory / "frames.jsonl").open("x", encoding="utf-8") as stream:
            while args.max_frames == 0 or count < args.max_frames:
                stop_file = getattr(args, "stop_file", None)
                if stop_file is not None and stop_file.exists():
                    status = "operator_stopped"
                    break
                frame_start = time.perf_counter()
                ok, raw_image = capture.read()
                if not ok:
                    if args.video is None:
                        raise RuntimeError("camera read failed; review stopped")
                    reported_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
                    if count == 0 or (reported_count > 0 and count < reported_count):
                        raise RuntimeError(
                            f"video ended or decoding failed at frame {count}; "
                            f"reported total {reported_count}"
                        )
                    status = "completed"
                    break
                image = np.asarray(raw_image, dtype=np.uint8)
                height, width = image.shape[:2]
                if dimensions is None:
                    dimensions = width, height
                    if truth is not None and dimensions != (truth.image_width, truth.image_height):
                        raise ValueError("annotation image dimensions do not match the source")
                    writer = cv2.VideoWriter(
                        str(directory / "annotated.mp4"),
                        cv2.VideoWriter.fourcc(*"mp4v"),
                        fps,
                        dimensions,
                    )
                    if not writer.isOpened():
                        raise RuntimeError("could not open the annotated MP4 writer")
                elif dimensions != (width, height):
                    raise ValueError("source resolution changed during the review")
                warnings: list[str] = []
                if args.video is not None:
                    reported_time = float(capture.get(cv2.CAP_PROP_POS_MSEC)) * 0.001
                    if (
                        args.source_fps is None
                        and math.isfinite(reported_time)
                        and reported_time > last_source_s
                    ):
                        source_s = reported_time
                        time_basis = "video_media_timestamp"
                    else:
                        source_s = max(count / fps, last_source_s + 1.0 / fps)
                        time_basis = "frame_index_fps_fallback"
                        fallback_count += 1
                else:
                    source_s = time.perf_counter() - start
                    time_basis = "host_read_completion_not_sensor_exposure"
                last_source_s = source_s
                thumbnail = np.asarray(
                    cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (64, 36)), dtype=np.uint8
                )
                if previous_thumbnail is None or not np.array_equal(thumbnail, previous_thumbnail):
                    last_change_s = source_s
                elif source_s - last_change_s >= config.freeze_warning_s:
                    warnings.append("Repeated image suspected; a static scene can also cause this")
                previous_thumbnail = thumbnail
                observations = [obs for detector in detectors for obs in detector.detect(image)]
                tracks = history.update(observations, source_s)
                evaluator.update(count, observations)
                reviews = review_regions(regions, count, observations, width, height, unsupported)
                rendered = render_review(
                    image, observations, tracks, regions, count, source_s, warnings, unsupported
                )
                last_rendered = rendered
                assert writer is not None
                writer.write(rendered)
                processing_ms = (time.perf_counter() - frame_start) * 1000.0
                timings.append(processing_ms)
                class_counts.update(obs.label for obs in observations)
                warning_counts.update(warnings)
                record = {
                    "schema_version": 1,
                    "frame_index": count,
                    "source_time_s": source_s,
                    "timestamp_basis": time_basis,
                    "read_process_encode_ms": processing_ms,
                    "observations": [asdict(obs) for obs in observations],
                    "tracks": [asdict(track) for track in tracks],
                    "region_reviews": reviews,
                    "warnings": warnings,
                }
                stream.write(json.dumps(record, allow_nan=False) + "\n")
                count += 1
                if count % 25 == 0:
                    print(f"STUDIO_VIDEO_PROGRESS {count}", flush=True)
                if progress_store is not None and count % 25 == 0:
                    progress_store.save(Progress(frames=count, status="running"))
                if args.show:
                    cv2.imshow("Rescue Review", rendered)
                    delay_ms = (
                        max(1, round(1000.0 / fps - processing_ms)) if args.video is not None else 1
                    )
                    if cv2.waitKey(delay_ms) & 0xFF in {27, ord("q")}:
                        status = "operator_stopped"
                        break
                if count % 100 == 0:
                    print(f"Reviewed {count} frames")
            else:
                status = "frame_limit_reached"
    except KeyboardInterrupt:
        status = "operator_stopped"
    except Exception as exc:
        status, error = "failed", str(exc)
        raise
    finally:
        capture.release()
        if writer is not None:
            writer.release()
        if args.show:
            with suppress(cv2.error):
                cv2.destroyWindow("Rescue Review")
        if directory is not None:
            if progress_store is not None:
                progress_store.save(Progress(frames=count, status=status))
            if last_rendered is not None:
                cv2.imwrite(str(directory / "preview.jpg"), last_rendered)
            elapsed = time.perf_counter() - start
            summary: dict[str, object] = {
                "schema_version": 1,
                "status": status,
                "error": error,
                "source": str(args.video.resolve())
                if args.video is not None
                else f"camera:{args.camera}",
                "frames_reviewed": count,
                "source_video_sha256": video_sha256,
                "image_dimensions": dimensions,
                "elapsed_wall_s": elapsed,
                "wall_throughput_fps": count / elapsed if elapsed > 0 else None,
                "source_timestamp_fallback_frames": fallback_count,
                "read_process_encode_ms_p50": float(np.median(timings)) if timings else None,
                "read_process_encode_ms_p95": float(np.percentile(timings, 95))
                if timings
                else None,
                "timing_sample_frames": len(timings),
                "timing_note": (
                    "Latest 10000 frames; excludes display wait and JSON logging. "
                    "Includes model warmup; not sensor exposure-to-display latency."
                ),
                "model_settings": config.model_dump(mode="json"),
                "unsupported_review_classes": unsupported,
                "observation_counts_not_unique_objects": dict(class_counts),
                "warning_frame_counts": dict(warning_counts),
                "evaluation": evaluator.summary(),
                "delivery_suitability": "not_established",
                "geographic_mapping": "unavailable_without_calibrated_geometry_and_pose",
            }
            write_report(directory, summary)
            print(f"Report: {(directory / 'report.html').resolve()}")
    return 0


def main() -> None:
    parser = build_parser()
    try:
        code = run(parser.parse_args())
    except (OSError, ValueError, RuntimeError, cv2.error) as exc:
        parser.error(str(exc))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
