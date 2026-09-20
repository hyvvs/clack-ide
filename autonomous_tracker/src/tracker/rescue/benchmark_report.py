from __future__ import annotations

from typing import Any


def _cell(value: object) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\n", " ")
        .replace("\r", " ")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("`", "\\`")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("*", "\\*")
        .replace("_", "\\_")
    )


def _ratio(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.3f}"


def render_benchmark_report(result: dict[str, Any]) -> str:
    lines = [
        f"# {_cell(result['name'])}",
        "",
        f"Status: **{result['status']}**. "
        "Completed means scoring finished, not operational readiness.",
        "",
        f"Split: {result['split']}. Box IoU threshold: {result['iou_threshold']}. "
        "Only reviewed frames are scored.",
        "",
        "## Per clip",
        "",
        "| Clip | Status | Scored / reviewed | TP | FP | FN | Precision | Recall | "
        "Processing p95 ms |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in result["entries"]:
        counts = row.get("evaluation", {}).get("overall") or {}
        coverage = row.get("coverage")
        coverage_text = (
            f"{coverage['scored_frames']} / {coverage['reviewed_frames']}" if coverage else "n/a"
        )
        timing = row.get("processing_ms", {}).get("p95")
        lines.append(
            f"| {row['name']} | {row['status']} | {coverage_text} | "
            f"{counts.get('true_positives', 'n/a')} | {counts.get('false_positives', 'n/a')} | "
            f"{counts.get('false_negatives', 'n/a')} | {_ratio(counts.get('precision'))} | "
            f"{_ratio(counts.get('recall'))} | {'n/a' if timing is None else f'{timing:.2f}'} |"
        )
    lines += ["", "## Per incident", ""]
    aggregate = result["aggregate"]
    if aggregate is None:
        lines.append(
            "Aggregate withheld. Resolve all blocked, failed, partial or incompatible "
            "inputs and rerun."
        )
    else:
        pooled = aggregate["pooled"]["overall"]
        macro = aggregate["macro_incident"]
        lines += [
            f"Pooled box precision: {_ratio(pooled['precision'])}; "
            f"recall: {_ratio(pooled['recall'])}.",
            "",
            f"Equal-incident macro precision: {_ratio(macro['precision'])} "
            f"({macro['precision_defined_incidents']}/{macro['incidents']} defined); "
            f"recall: {_ratio(macro['recall'])} "
            f"({macro['recall_defined_incidents']}/{macro['incidents']} defined).",
            "",
            "| Incident | Clips | Reviewed frames | TP | FP | FN | Precision | Recall |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for row in aggregate["per_incident"]:
            counts = row["overall"]
            lines.append(
                f"| {_cell(row['incident_id'])} | {row['clips']} | {row['scored_frames']} | "
                f"{counts['true_positives']} | {counts['false_positives']} | "
                f"{counts['false_negatives']} | {_ratio(counts['precision'])} | "
                f"{_ratio(counts['recall'])} |"
            )
        lines += [
            "",
            aggregate["note"],
            "",
            "Per-class counts, explicit negative-frame counts and within-clip ID changes "
            "are in summary.json.",
        ]
    lines += ["", "## Input issues", ""]
    for issue in result["errors"] + result["warnings"]:
        lines.append(
            f"- {_cell(issue['severity'])} / {_cell(issue['code'])}: {_cell(issue['message'])}"
        )
    if not result["errors"] and not result["warnings"]:
        lines.append("No issues found by the checks performed. See scope limitations below.")
    for row in result["entries"]:
        if row.get("error"):
            lines.append(f"- {row['name']}: {_cell(row['error'])}")
    lines += [
        "",
        "## Evidence",
        "",
        "The manifest, resolved protocol, dataset audit and exact project snapshots are saved "
        "alongside this report. Summary JSON records their paths and checksums.",
        "",
    ]
    for row in result["entries"]:
        if row.get("evidence"):
            lines.append(f"- [{row['name']}: frame-by-frame evidence]({row['evidence']})")
            lines.append(f"  - Timing note: {_cell(row['processing_ms']['note'])}")
    lines += ["", "## Limitations", ""]
    lines += [f"- {_cell(note)}" for note in result["limitations"]]
    return "\n".join(lines) + "\n"
