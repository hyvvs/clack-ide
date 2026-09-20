# Multi-incident rescue observation benchmark

Score one saved detector configuration across multiple annotated videos without rerunning YOLO.
This is an offline observation-evaluation workflow, separate from all hardware and projectile code.
It does not improve model weights by itself or establish field reliability.

## Try the workflow now

From the `autonomous_tracker` project directory, with `.venv` active:

```powershell
python tools\create_rescue_benchmark_demo.py
```

This creates three small, playable synthetic videos, annotation projects, fabricated prediction logs,
a manifest and a report in a new `diagnostics/synthetic-benchmark-demo-...` folder. It downloads
nothing and changes no existing project. Open the printed `report.md` path in a Markdown viewer.
Its detections and timings are fabricated fixtures, not YOLO predictions or measured performance.

Two clips in incident A have 10 total correctly detected boxes. Incident B has two missed boxes.
The pooled recall is 10/12, or 83.3%, but equal-incident macro recall is 50%. The incident table
exposes the 0% recall for incident B. Neither number is evidence of real disaster performance.

To inspect a demo clip visually, use its generated video and project with the existing desktop UI:

```powershell
python -m tracker.cli.rescue_annotate --video diagnostics\YOUR_DEMO\missed\synthetic-shapes.avi --project diagnostics\YOUR_DEMO\missed\project.json --run diagnostics\YOUR_DEMO\missed\synthetic-run
```

Replace `YOUR_DEMO` with the generated folder name. In Evaluate runs, inspect the missed frames.
The benchmark itself produces local Markdown and JSON; it does not add a new desktop tab.

## Benchmark real recorded observations

1. Label footage in [Rescue Label Studio](RESCUE_LABEL_STUDIO.md). Mark frames reviewed only after
   checking every visible object in the declared class scope. Include explicit negative frames.
2. Assign an incident tag and split to each project, then save. Related recordings from the same
   event must stay in one split. Use validation incidents for model/threshold selection; reserve
   separate final test incidents. The tool cannot verify that operator tags are truthful.
3. Generate saved `rescue_review` runs for each video using the same detector settings. Every run
   must cover all reviewed frames in its corresponding project. No calibration is needed here.
4. Create a JSON manifest. Paths resolve relative to the manifest's directory, not the shell's
   working directory. Absolute paths are also accepted. Use forward slashes in JSON on Windows.

For example, save this as `annotations/validation-benchmark.json`, replacing the example paths:

```json
{
  "schema_version": 1,
  "name": "Rescue observations: validation candidate A",
  "split": "validation",
  "iou_threshold": 0.5,
  "entries": [
    {
      "name": "wildfire-a",
      "project": "wildfire-a.json",
      "run": "../diagnostics/rescue/REPLACE_WITH_RUN_A"
    },
    {
      "name": "wildfire-b",
      "project": "wildfire-b.json",
      "run": "../diagnostics/rescue/REPLACE_WITH_RUN_B"
    }
  ],
  "audit_projects": ["training-a.json", "final-test-a.json"]
}
```

Entry names must be unique lowercase slugs: letters, digits, underscores or hyphens, at most
80 characters. Each entry needs a distinct project path, run path and source-video checksum.
All scored projects must share the same class scope and the manifest's validation or test split.

`audit_projects` supplies additional training, validation or test projects for overlap checking;
their detections are not scored. Supply all available split records, not backups or exported truth
JSON. An empty list is allowed but cannot check omitted material. Without any training projects,
the report explicitly warns that training overlap was not checked. Pretrained-model training
provenance remains unknown even if the supplied local splits have no known overlap.

```powershell
python -m tracker.cli.rescue_benchmark --manifest annotations\validation-benchmark.json
```

Use `--output PATH` to change the output root. No models, videos or source annotations are modified.
There is no automatic download, inference, training or model selection in this command.

## Blocking checks and incomplete inputs

Before prediction scoring, preflight blocks invalid project files, changed project snapshots,
cross-split video/incident overlap, missing incident tags, unassigned splits, incorrect scored
splits, duplicate scored videos, different scored class scopes and projects with no reviewed frames.
All supplied audit projects need an assigned split and incident tag, even when they are not scored.

The run scorer checks source hashes, image dimensions, finalized run status, ordered contiguous
frame records, increasing timestamps, box bounds and recorded frame counts. Failed runs and partial
coverage remain visible; they are never dropped from a supposedly complete combined score.

Recorded model settings must be nonempty and match exactly after canonical JSON serialization.
Different settings suppress the aggregate. This is deliberately conservative: a changed weight
path or class-list order can count as different settings. Matching settings still do not prove
identical weight binaries, package versions, hardware or training provenance.

Missing negative frames and different scopes in additional audit-only projects produce warnings.
They do not silently change the scoring scope. A warning-free run is not an accuracy acceptance test.

CLI exit codes:

- `0`: scoring completed with no reported input warnings.
- `1`: scoring completed, but warnings need review.
- `2`: blocked, incomplete, incompatible runs, invalid manifest or I/O failure.

A readable report is saved for blocked, partial and incompatible runs. An invalid manifest or an
I/O failure may prevent report creation. A folder without `summary.json` is unfinished; the summary
is written last. Each run uses a new output folder and never replaces previous reports.

## Read the evidence

- `report.md`: per-clip and per-incident tables, issues, evidence links and limitations.
- `summary.json`: pooled and per-incident overall/per-class counts; macro precision/recall;
  explicit negative-frame counts; tracking-ID changes within clips; per-clip timing; input hashes.
- `manifest.json`: exact input bytes, retained as provenance. Its relative paths still refer to the
  original manifest location. `protocol.json` records resolved absolute paths for the run.
- `dataset-audit.json` and `projects/`: audit results plus exact saved project snapshots.
- `clips/`: scored frame-by-frame evidence and reviewed truth snapshots for each successful scoring
  attempt, including partial coverage. Older evidence is not changed by later annotation edits.

Pooled ratios are calculated from summed TP/FP/FN box counts, not averaged clip percentages.
Macro ratios give each normalized incident equal weight. Undefined ratios are displayed as `n/a`
and excluded from the macro mean; the report shows the number of defined incident ratios.
Multiple clips from one incident are combined before that mean. Tracking IDs are never compared
across clips. Timing percentiles are shown per clip, not averaged into a fictitious global p95.

Only reviewed frames count. Sparse labels cannot establish continuous event detection, and repeated
frame boxes are not independent alarm events. These fixed-IoU metrics are not mAP, HOTA, calibration,
delivery approval or operational certification. Exact hashes cannot detect every transcode or related
recording. Representative, independent, human-reviewed real footage is still required before any
claim about real-world detection or tracking reliability.
