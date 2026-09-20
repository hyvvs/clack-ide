# Rescue observation review

This workflow observes images and produces reports. It does not estimate projectile
trajectories, operate motors, select firing targets, or communicate with a launcher.
Camera calibration is not required for its image coordinates.

## Run the downloaded demonstration

From the autonomous_tracker project directory, with its virtual environment active:

```powershell
python -m tracker.cli.rescue_review --video data\rescue-sample\wildfire.mp4 --show
```

The sourced experimental fire/smoke model has a separate profile:

```powershell
python -m tracker.cli.rescue_review --video data\rescue-sample\wildfire.mp4 --config configs\rescue_fire_review.yaml --show
```

On a fresh checkout, first run `python tools\fetch_rescue_sample.py` and
`python tools\fetch_rescue_fire_model.py`. Both refuse to overwrite an existing download.
The fire profile verifies the model checksum before loading it. This is a research model,
not a model independently validated on this project's rescue footage.

The default model detects people, boats, cars, trucks, and buses. It does not recognize
fire, smoke, floodwater, or debris. The display and report explicitly list those missing
capabilities. Seeing no detections on the wildfire sample is not evidence of no hazard.

Use `--camera 0 --show` instead of `--video ...` for a local camera. Use `--max-frames 100`
for a bounded smoke test. Every run creates a new directory under `diagnostics/rescue`.
The program prints its absolute report path. Q or Escape stops a displayed review.

Outputs are `annotated.mp4`, `preview.jpg`, `frames.jsonl`, `summary.json`, and `report.html`.
Some browsers cannot play the OpenCV MP4 codec; the MP4 can also be opened in a desktop
video player. The JSON and HTML reports do not require a server.

Each frame records the model name, label, confidence, box, optional segmentation polygon,
tracker ID, lifecycle status and last observation time. Missing tracks retain their last
measured position; their positions are not extrapolated. Confirmation requires consecutive
observations and is reset on reacquisition. These are anonymous tracking IDs, not identities.

Video playback uses media timestamps when available and an explicit FPS fallback otherwise.
Set `--source-fps` when a video's FPS metadata is incorrect. Camera timestamps are host read
completion times, not measured sensor exposure times. Reported processing latency includes
read, inference, annotation and encoding; it excludes display waiting and JSON logging.
Timing percentiles cover the latest 10,000 frames and include startup warmup. Repeated-image
warnings indicate a possible freeze, but static scenes can produce the same warning.

## Add a compatible trained hazard model

Add a second model to `configs/rescue_review.yaml` only when its weights are available:

```yaml
  - name: hazards
    weights: models/fire-smoke.pt
    classes: [fire, smoke]
    confidence: 0.35
    image_size: 640
    tracker: botsort.yaml
```

Use exact class names from the model. Startup rejects unsupported labels. It also rejects
classification, pose and semantic-segmentation model outputs; this adapter accepts detection
and instance-segmentation models. It reads masks when the latter supplies them. RGB and
thermal models require separate representative training and validation; merely converting
thermal frames to three channels does not validate an RGB model for thermal use.

The older YOLOv5 research weights linked by D-Fire are not drop-in current-Ultralytics
weights. Do not rename a legacy checkpoint to make it appear compatible. Only load trusted
model files. See `RESCUE_SOURCES.md` for sources and licensing observations.

## Evaluate annotated video

For a visual label editor and repeatable run-comparison dashboard, use
[Rescue Label Studio](RESCUE_LABEL_STUDIO.md). It exports this annotation format and binds
new labels and prediction runs to the exact source-video checksum.

Supply `--annotations annotations.json`. Frame indices start at zero. Boxes use pixels at
the original video resolution. Only explicitly listed frames are scored; an explicit empty
objects list is an annotated negative frame. Omitted frames are not treated as negatives.

```json
{
  "image_width": 1280,
  "image_height": 720,
  "frames": [
    {"frame_index": 0, "objects": [
      {"label": "person", "bbox_xyxy": [100, 120, 180, 300], "object_id": "person-1"}
    ]},
    {"frame_index": 1, "objects": []}
  ]
}
```

The report computes per-class and overall precision/recall using one-to-one matching at
box IoU >= 0.5. This is a fixed-threshold video check, not mAP, HOTA, or a safety score.
Identity switches count changes between matched labeled observations with object IDs,
including across gaps. Without labels, accuracy is `not_measured`, never an invented zero
or perfect score. The sample video has no labels and cannot establish accuracy.

Training and final test material must be separated by recording session or incident.
Different neighboring frames from one event are not independent train/test evidence.

## Review candidate supply-delivery areas

An operator may supply `--regions regions.json`. Regions are convex image-space polygons
in normalized coordinates, and apply to one exact frame to avoid silently following camera
movement. This is an annotation/review feature, not a delivery-area detector or geospatial map.

```json
{"regions": [{"name": "Candidate A", "frame_index": 20,
  "polygon_normalized": [[0.1, 0.6], [0.4, 0.6], [0.4, 0.9], [0.1, 0.9]]}]}
```

The report lists overlapping observations. Masks are used when available; otherwise a box
is used. A region with no overlap remains `unverified`. It is never marked safe or approved.
Terrain, obstructions, depth, geographic position, weather and delivery suitability require
separate information and qualified operator assessment.

## Remaining work requiring evidence or hardware

- Train and validate fire/smoke and flood/debris models on licensed representative data.
- Label independent video sequences and measure incident-level recall and false alarms.
- Obtain camera calibration, sensor timing, depth and platform pose for geographic mapping.
- Collect paired RGB/thermal evidence before sensor fusion.
- Validate candidate-area review in supervised rescue exercises.

This milestone does not establish disaster-wide recognition or operational rescue readiness.
