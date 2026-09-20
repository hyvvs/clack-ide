from __future__ import annotations

import html
import json
from pathlib import Path


def write_report(directory: Path, summary: dict[str, object]) -> None:
    encoded = json.dumps(summary, indent=2, allow_nan=False)
    (directory / "summary.json").write_text(encoded + "\n", encoding="utf-8")
    escaped = html.escape(encoded)
    page = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Rescue observation review</title>
<style>body{{font:16px system-ui;background:#121b27;color:#e2eaf3;
max-width:1000px;margin:40px auto;padding:0 20px}}
h1{{font-size:28px}}p{{line-height:1.6}}video{{width:100%;background:#080d14;border-radius:8px}}
pre{{overflow:auto;background:#1d2a3a;padding:20px;border-radius:8px}}a{{color:#7bd2ff}}</style>
<h1>Rescue observation review</h1>
<p>Image observations and operator-marked regions. Geographic location, terrain, clearance,
and payload delivery suitability have not been established. Missing evaluation labels mean
accuracy is not measured.</p>
<video controls preload="metadata" poster="preview.jpg" src="annotated.mp4"></video>
<p><a href="preview.jpg">Last reviewed frame</a> |
<a href="annotated.mp4">Download annotated video</a></p>
<p><a href="frames.jsonl">Frame records</a> | <a href="summary.json">Summary JSON</a></p>
<pre>{escaped}</pre></html>"""
    (directory / "report.html").write_text(page, encoding="utf-8")
