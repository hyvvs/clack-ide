from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from tracker.cli.rescue_benchmark import build_parser, run
from tracker.rescue import benchmark
from tracker.rescue.annotations import AnnotationDocument, LabelFrame
from tracker.rescue.benchmark import BenchmarkManifest, run_benchmark
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import VideoIdentity


def write_clip(
    root: Path, name: str, *, positives: int = 1, hits: bool = True, incident: str | None = None
) -> dict[str, str]:
    folder = root / name
    folder.mkdir()
    box = TruthObject(label="test-shape", bbox_xyxy=(10, 10, 30, 40), object_id="shape-1")
    document = AnnotationDocument(
        source=VideoIdentity(
            path="synthetic.avi",
            sha256=hashlib.sha256(name.encode()).hexdigest(),
            width=100,
            height=100,
            frame_count=positives + 1,
            nominal_fps=10,
        ),
        classes=["test-shape", "absent-class"],
        incident_id=incident or name,
        split="validation",
        frames=[
            LabelFrame(frame_index=index, objects=[box] if index < positives else [], reviewed=True)
            for index in range(positives + 1)
        ],
    )
    (folder / "project.json").write_text(document.model_dump_json(), encoding="utf-8")
    run_dir = folder / "run"
    run_dir.mkdir()
    (run_dir / "summary.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "status": "completed",
                "frames_reviewed": positives + 1,
                "source_video_sha256": document.source.sha256,
                "image_dimensions": [100, 100],
                "model_settings": {"synthetic_fixture_not_yolo": True},
                "timing_note": "Synthetic timings, not performance",
            }
        ),
        encoding="utf-8",
    )
    records = [
        {
            "schema_version": 1,
            "frame_index": index,
            "source_time_s": index / 10,
            "read_process_encode_ms": 10 + index,
            "observations": [
                {
                    "model": "synthetic",
                    "label": "test-shape",
                    "confidence": 0.9,
                    "bbox_xyxy": [10, 10, 30, 40],
                    "tracker_id": 1,
                }
            ]
            if hits and index < positives
            else [],
        }
        for index in range(positives + 1)
    ]
    (run_dir / "frames.jsonl").write_text(
        "\n".join(map(json.dumps, records)) + "\n", encoding="utf-8"
    )
    return {"name": name, "project": f"{name}/project.json", "run": f"{name}/run"}


def write_manifest(
    root: Path, entries: list[dict[str, str]], audit: list[str] | None = None
) -> Path:
    path = root / "manifest.json"
    path.write_text(
        json.dumps(
            {
                "name": "Synthetic tests, not field accuracy",
                "split": "validation",
                "entries": entries,
                "audit_projects": audit or [],
            }
        ),
        encoding="utf-8",
    )
    return path


def edit_json(path: Path, **updates: Any) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.update(updates)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_relative_paths_resolve_against_manifest_not_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write_manifest(tmp_path, [write_clip(tmp_path, "clip-a")])
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    directory, result = run_benchmark(path, tmp_path / "outputs")
    assert result["status"] == "completed"
    assert result["entries"][0]["project"] == str(tmp_path / "clip-a" / "project.json")
    assert json.loads((directory / "protocol.json").read_text())["entries"][0]["run"] == str(
        tmp_path / "clip-a" / "run"
    )


@pytest.mark.parametrize(
    "fault",
    [
        "duplicate_name",
        "duplicate_project",
        "duplicate_run",
        "unknown_field",
        "bad_iou",
        "blank_name",
    ],
)
def test_manifest_rejects_ambiguous_or_invalid_protocols(tmp_path: Path, fault: str) -> None:
    entries = [write_clip(tmp_path, "first"), write_clip(tmp_path, "second")]
    payload: dict[str, Any] = {"name": "fixture", "split": "validation", "entries": entries}
    if fault.startswith("duplicate_"):
        field = fault.removeprefix("duplicate_")
        entries[1][field] = entries[0][field]
    elif fault == "unknown_field":
        payload["confidence"] = 0.8
    elif fault == "bad_iou":
        payload["iou_threshold"] = float("nan")
    else:
        payload["name"] = "  "
    with pytest.raises(ValueError):
        BenchmarkManifest.model_validate(payload).resolved(tmp_path)


def test_incident_macro_does_not_hide_small_weak_incident(tmp_path: Path) -> None:
    entries = [
        write_clip(tmp_path, "long", positives=8, incident="incident-a"),
        write_clip(tmp_path, "short", positives=2, incident=" INCIDENT-A "),
        write_clip(tmp_path, "miss", positives=2, hits=False, incident="incident-b"),
    ]
    _, result = run_benchmark(write_manifest(tmp_path, entries), tmp_path / "out")
    measured = result["aggregate"]
    assert measured["pooled"]["overall"]["recall"] == pytest.approx(10 / 12)
    assert measured["macro_incident"]["recall"] == 0.5
    assert measured["macro_incident"]["precision_defined_incidents"] == 1
    assert measured["macro_incident"]["recall_defined_incidents"] == 2
    assert measured["per_incident"][0]["clips"] == 2
    assert measured["per_incident"][1]["overall"]["recall"] == 0.0
    assert measured["pooled"]["per_class"]["absent-class"]["recall"] is None
    assert measured["pooled"]["reviewed_negative_frames"] == 3
    assert measured["pooled"]["identity_switches_within_clips"] == 0
    assert "processing_ms" not in measured


def test_negative_only_incidents_are_not_perfect_recall(tmp_path: Path) -> None:
    path = write_manifest(tmp_path, [write_clip(tmp_path, "negatives", positives=0)])
    _, result = run_benchmark(path, tmp_path / "out")
    macro = result["aggregate"]["macro_incident"]
    assert macro == {
        "incidents": 1,
        "precision": None,
        "precision_defined_incidents": 0,
        "recall": None,
        "recall_defined_incidents": 0,
    }
    assert result["aggregate"]["pooled"]["identity_switches_within_clips"] is None


@pytest.mark.parametrize(
    "fault",
    [
        "source_overlap",
        "incident_overlap",
        "missing_incident",
        "unassigned",
        "wrong_split",
        "scope",
        "duplicate_video",
        "no_labels",
        "invalid_project",
    ],
)
def test_preflight_conflicts_block_before_prediction_scoring(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fault: str
) -> None:
    first, second = write_clip(tmp_path, "first"), write_clip(tmp_path, "second")
    first_path, second_path = tmp_path / first["project"], tmp_path / second["project"]
    extra: list[str] = []
    if fault in {"source_overlap", "incident_overlap"}:
        training = write_clip(tmp_path, "training")
        extra.append(training["project"])
        edits: dict[str, Any] = {"split": "training"}
        original = json.loads(first_path.read_text())
        edits["source" if fault == "source_overlap" else "incident_id"] = original[
            "source" if fault == "source_overlap" else "incident_id"
        ]
        edit_json(tmp_path / training["project"], **edits)
    elif fault == "missing_incident":
        edit_json(second_path, incident_id=" ")
    elif fault == "unassigned":
        edit_json(second_path, split="unassigned")
    elif fault == "wrong_split":
        edit_json(second_path, split="test")
    elif fault == "scope":
        edit_json(second_path, classes=["test-shape"])
    elif fault == "duplicate_video":
        edit_json(second_path, source=json.loads(first_path.read_text())["source"])
    elif fault == "no_labels":
        edit_json(second_path, frames=[])
    else:
        second_path.write_text("invalid JSON")

    def forbidden_score(*args: Any, **kwargs: Any) -> None:
        pytest.fail("preflight must block before reading predictions")

    monkeypatch.setattr(benchmark, "score_saved_run", forbidden_score)
    directory, result = run_benchmark(
        write_manifest(tmp_path, [first, second], extra), tmp_path / "out"
    )
    assert result["status"] == "blocked"
    assert result["aggregate"] is None
    assert all(row["status"] == "not_scored" for row in result["entries"])
    assert result["errors"]
    assert (directory / "report.md").is_file()


@pytest.mark.parametrize(
    "fault", ["partial", "missing_run", "different_settings", "empty_settings"]
)
def test_bad_run_is_visible_and_never_silently_excluded_from_aggregate(
    tmp_path: Path, fault: str
) -> None:
    first, second = write_clip(tmp_path, "first"), write_clip(tmp_path, "second")
    run_dir = tmp_path / first["run"]
    if fault == "partial":
        frames = (run_dir / "frames.jsonl").read_text().splitlines()
        (run_dir / "frames.jsonl").write_text(frames[0] + "\n")
        edit_json(run_dir / "summary.json", frames_reviewed=1, status="frame_limit_reached")
    elif fault == "missing_run":
        first["run"] = "missing"
    else:
        edit_json(
            run_dir / "summary.json",
            model_settings={"different": True} if fault == "different_settings" else {},
        )
    _, result = run_benchmark(write_manifest(tmp_path, [first, second]), tmp_path / "out")
    assert result["aggregate"] is None
    assert result["status"] == (
        "incompatible_runs" if fault == "different_settings" else "incomplete"
    )
    assert result["entries"][1]["status"] == "complete"
    assert (
        result["entries"][0]["status"]
        == {
            "partial": "partial",
            "missing_run": "failed",
            "different_settings": "complete",
            "empty_settings": "failed",
        }[fault]
    )


def test_changed_project_after_audit_blocks_stale_split_assumptions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry = write_clip(tmp_path, "first")
    actual_audit = benchmark.audit_projects

    def race(paths: list[Path]) -> dict[str, Any]:
        audited = actual_audit(paths)
        edit_json(paths[0], split="training")
        return audited

    monkeypatch.setattr(benchmark, "audit_projects", race)
    _, result = run_benchmark(write_manifest(tmp_path, [entry]), tmp_path / "out")
    assert result["status"] == "blocked"
    assert any(issue["code"] == "project_changed" for issue in result["errors"])


def test_outputs_preserve_snapshots_and_each_rerun_is_separate(tmp_path: Path) -> None:
    path = write_manifest(tmp_path, [write_clip(tmp_path, "first")])
    original = (tmp_path / "first" / "project.json").read_bytes()
    directory, result = run_benchmark(path, tmp_path / "out")
    snapshot = result["project_snapshots"][0]
    assert (directory / snapshot["snapshot"]).read_bytes() == original
    assert snapshot["sha256"] == hashlib.sha256(original).hexdigest()
    assert result["manifest_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    evidence = json.loads((directory / result["entries"][0]["evidence"]).read_text())
    assert len(evidence["per_frame"]) == 2
    assert evidence["annotation_sha256"] == result["entries"][0]["annotation_sha256"]
    saved = (directory / "summary.json").read_bytes()
    second, _ = run_benchmark(path, tmp_path / "out")
    assert directory != second
    assert (directory / "summary.json").read_bytes() == saved


def test_cli_distinguishes_clean_warnings_and_incomplete(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    entry = write_clip(tmp_path, "first")
    path = write_manifest(tmp_path, [entry])
    args = build_parser().parse_args(["--manifest", str(path), "--output", str(tmp_path / "out")])
    assert run(args) == 1
    training = write_clip(tmp_path, "training")
    edit_json(tmp_path / training["project"], split="training")
    write_manifest(tmp_path, [entry], [training["project"]])
    assert run(args) == 0
    edit_json(tmp_path / entry["project"], split="test")
    assert run(args) == 2
    assert "Aggregate withheld" in capsys.readouterr().out


def test_report_escapes_untrusted_titles_and_incident_names(tmp_path: Path) -> None:
    entry = write_clip(tmp_path, "first", incident="<img src=x> | [bad](https://example.com)\nnext")
    path = write_manifest(tmp_path, [entry])
    edit_json(path, name="<script>bad</script>\n# header")
    directory, _ = run_benchmark(path, tmp_path / "out")
    report = (directory / "report.md").read_text()
    assert "<script>" not in report and "<img" not in report
    assert "\\|" in report
    assert "\\[bad\\]" in report
    assert "\n# header" not in report


def test_manifest_iou_applies_to_each_clip_and_retains_negative_false_positives(
    tmp_path: Path,
) -> None:
    entry = write_clip(tmp_path, "first")
    log = tmp_path / entry["run"] / "frames.jsonl"
    records = [json.loads(line) for line in log.read_text().splitlines()]
    records[0]["observations"][0]["bbox_xyxy"] = [10, 10, 25, 40]
    records[1]["observations"] = records[0]["observations"]
    log.write_text("\n".join(map(json.dumps, records)) + "\n")
    path = write_manifest(tmp_path, [entry])
    _, loose = run_benchmark(path, tmp_path / "out")
    assert loose["aggregate"]["pooled"]["overall"]["true_positives"] == 1
    assert loose["aggregate"]["pooled"]["negative_frames_with_false_positives"] == 1
    edit_json(path, iou_threshold=0.9)
    _, strict = run_benchmark(path, tmp_path / "out")
    assert strict["aggregate"]["pooled"]["overall"] == {
        "true_positives": 0,
        "false_positives": 2,
        "false_negatives": 1,
        "precision": 0.0,
        "recall": 0.0,
    }


def test_settings_key_order_is_not_a_candidate_change_and_ids_reset_per_clip(
    tmp_path: Path,
) -> None:
    first = write_clip(tmp_path, "first")
    second = write_clip(tmp_path, "second")
    for entry, settings in [
        (first, {"synthetic": True, "version": 1}),
        (second, {"version": 1, "synthetic": True}),
    ]:
        edit_json(tmp_path / entry["run"] / "summary.json", model_settings=settings)
    log = tmp_path / second["run"] / "frames.jsonl"
    records = [json.loads(line) for line in log.read_text().splitlines()]
    records[0]["observations"][0]["tracker_id"] = 99
    log.write_text("\n".join(map(json.dumps, records)) + "\n")
    _, result = run_benchmark(write_manifest(tmp_path, [first, second]), tmp_path / "out")
    assert result["status"] == "completed"
    assert result["aggregate"]["pooled"]["identity_switches_within_clips"] == 0
    assert len({row["model_settings_sha256"] for row in result["entries"]}) == 1
