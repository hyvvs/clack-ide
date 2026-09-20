# Real footage and broader disaster data

The synthetic benchmark tests software plumbing. It does not train a detector. Real training
requires suitable labeled images, reviewed class mappings, independent incident splits, and an
explicit training run. Adding or playing a video does not update YOLO weights.

## Downloaded locally on 2026-09-06

### Six real FURG fire videos

Folder: `data/rescue-furg-starter/`. The downloaded MP4/XML assets occupy about 112 MB.
The original publisher README, CC0 license and file fingerprints are preserved alongside them.

| Clip | Decoded frames with draft annotations | Flame boxes | Explicit empty annotations |
| --- | --- | --- | --- |
| Car1 | 630 | 671 | 0 |
| barbecue | 902 | 892 | 10 |
| hand_held_batteries_night | 615 | 615 | 0 |
| hand_held_camera_wildfire | 773 | 741 | 39 |
| house2 | 899 | 899 | 0 |
| non_fire_patrolbot_onboard | 341 | 0 | 341 |

Total: 4,160 frames with publisher annotation records and 3,818 flame boxes. These are imported
drafts, not independently verified labels. Class scope is `fire` only, not smoke or people.
Source: [FURG fire dataset](https://github.com/steffensbola/furg-fire-dataset), pinned revision
`6aff09d7baa27425f31d1df685284c26cbffe7af`. The publisher provides OpenCV-format rectangles.

The importer converts x/y/width/height to pixel box corners, keeps zero-based frame numbers,
does not invent tracking IDs, and leaves splits/incident tags unassigned. Each selected source XML
has one terminal record beyond the decoded video length. Only that exact complete-sequence case
is excluded, with a recorded warning; labels are not shifted. Original XML remains unchanged.
Filename comparison handles the original author's stored Windows path. Other invalid frames,
duplicate indices, malformed rectangles and out-of-bounds boxes are rejected.

The initial strict import report is retained as `provenance.initial-import.json`; the successful
import and its warnings are recorded in `provenance.json`. No original media was removed.

Open the real wildfire clip with imported boxes, from this project's directory:

```powershell
.\.venv\Scripts\python.exe -m tracker.cli.rescue_annotate `
  --video data\rescue-furg-starter\hand_held_camera_wildfire.mp4 `
  --project data\rescue-furg-starter\projects\hand_held_camera_wildfire.json
```

Check label placement and completeness, then mark reviewed frames. Assign related videos to the
same incident and split. Do not declare every differently named clip an independent incident.

To reproduce the download in a fresh output folder:

```powershell
.\.venv\Scripts\python.exe tools\fetch_rescue_training_videos.py
```

The completed starter directory is not overwritten. Use `--output PATH` for another copy.
Downloads are checked against pinned file sizes and Git object hashes; SHA256 fingerprints are
recorded. An interrupted `.part` file is retained, not accepted as a valid video.

### Twelve FloodNet aerial image/mask pairs

Folder: `data/rescue-floodnet-starter/`. Six pairs come from the publisher's Flooded labeled
training group and six from Non-Flooded. They are real images, not video clips. Source:
[FloodNet Challenge Track 1](https://github.com/BinaLab/FloodNet-Challenge-EARTHVISION2021),
downloaded through the [TorchGeo mirror](https://huggingface.co/datasets/torchgeo/floodnet) at
revision `b5ea0cb042b551ba85393b58dc1538c566e04ed5`.

This is the older partly labeled challenge release, not the fully supervised v1.0 dataset.
The source and mirror name CDLA-Permissive-1.0; the mirror card and license link are preserved.
Its labels cover flooded/non-flooded roads and buildings, water and other scene classes.

The downloader selects image/mask pairs from the labeled training directories only, preserving
original bytes and recording paths/checksums. It never invents labels for unlabeled or test images.
Bounded HTTP byte ranges avoid downloading the entire 12.8 GB archive. Selected entries pass ZIP
CRC checks and receive local SHA256 fingerprints; the complete archive is NOT hash-verified.

Five downloaded pairs fail image/mask dimension checks and are explicitly flagged in
`provenance.json`. Nothing has been resized to hide this problem. The other seven pass structural
checks, not semantic label review. For example, visual inspection of `Flooded/10165.jpg` shows
both land and water while its supplied mask contains a single class value. It needs label review
despite matching dimensions. Do not feed this starter subset directly into a training job.

```powershell
.\.venv\Scripts\python.exe tools\fetch_rescue_flood_samples.py
```

Use a new `--output PATH` for another completed subset. Incomplete runs can reuse individual files
only after size and CRC verification; conflicting local files are not overwritten. The command
returns exit code 1 after downloading if pairs require alignment/format review. A folder without
`provenance.json` is incomplete. This tool does not convert semantic masks into YOLO instances.

## Coverage beyond fire

| Humanitarian observation task | Candidate source | What remains |
| --- | --- | --- |
| Smoke and false-alarm examples | [FIRESENSE](https://zenodo.org/records/836749) | Publisher lists 13 positive and 9 negative smoke videos. Not downloaded; video-level categories are not frame-by-frame object boxes. |
| Flooded roads/buildings and water | [FloodNet supervised v1.0](https://github.com/BinaLab/FloodNet-Supervised_v1.0) | A fuller labeled corpus is available. The downloaded challenge samples are only a small initial inspection set. |
| Storm damage and blocked roads | [RescueNet](https://github.com/BinaLab/RescueNet-A-High-Resolution-Post-Disaster-UAV-Dataset-for-Semantic-Segmentation) | Useful UAV segmentation labels, but the DATA README states CC BY-NC-ND. Not ingested for proprietary training. The repository's MIT code license does not replace dataset terms. |
| Building damage across natural disasters | [xBD / xView2](https://github.com/DIUx-xView/xView2_baseline) | Pre/post satellite imagery and damage polygons. Access and dataset terms need checking; the software license alone is insufficient. Satellite appearance differs substantially from ground-camera video. |
| Conflict-zone humanitarian damage assessment | [UNOSAT products](https://unosat.org/products/3454) | Historical damage maps are potential contextual references, not automatically a YOLO video-training corpus. Raw imagery permissions, matching labels and humanitarian scope need review. Nothing downloaded or connected to targeting. |

The intended conflict-zone scope is humanitarian infrastructure damage, obstructions and rescue
access, not identifying combatants or assisting targeting. Do not infer civilian/combatant status,
medical urgency, structural safety or safe delivery locations from a generic object label.

## Before training

1. Review the imported labels and obtain compatible, appropriately licensed data for each task.
2. Define the annotation type per task. Fire boxes and flood semantic masks are not interchangeable.
3. Group related footage by incident before sampling frames. Keep final test incidents out of training.
4. Export a versioned training dataset after review, then run an explicit fine-tuning job for the
   selected observation model. This export/training step has not run for these downloads.
5. Compare it with the unchanged baseline on independent reviewed incidents, including hard negatives.

More nearly identical frames are not the same as broader incident coverage. These downloads add
real material for preparation, not new validated model capabilities or a guarantee of reliability.
