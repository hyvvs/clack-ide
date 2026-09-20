# Rescue imagery and model sources

Sources inspected on 2026-09-05. Dataset, media, code and weight licenses are separate;
the publisher's current terms and the rights in individual source images must be reviewed
for a proprietary product. This file is a provenance record, not a legal clearance.

| Source | Coverage | Publisher's stated terms / limitations |
| --- | --- | --- |
| [D-Fire](https://github.com/gaia-solutions-on-demand/DFireDataset) | More than 21,000 images, fire/smoke boxes and negative examples; official download and split links | Its [LICENSE](https://github.com/gaia-solutions-on-demand/DFireDataset/blob/master/LICENSE) dedicates the collection under CC0 but says the authors do not hold copyright in the individual images. Preserve that distinction. |
| [rabahdev/fire-smoke-yolov8n](https://huggingface.co/rabahdev/fire-smoke-yolov8n) | Compatible YOLOv8n fire/smoke checkpoint; publisher describes D-Fire training | Publisher labels weights AGPL-3.0. Installed for experimental local review, not cleared for proprietary deployment. Dataset rights remain separate. |
| [Fire-Detection research](https://github.com/pedbrgs/Fire-Detection) | A sample wildfire video and links to trained fire/smoke models | Repository MIT license; separate original media rights need review. Its YOLOv5 weights need a compatible legacy runtime or independently verified conversion. They are not installed here. |
| [FloodNet-Supervised v1.0](https://github.com/BinaLab/FloodNet-Supervised_v1.0) | Post-Hurricane-Harvey aerial imagery, flooded roads/buildings, water and other scene labels | Current publisher README states Community Data License Agreement (permissive). This is not the separately licensed FloodNet-VQA dataset. |
| [RescueNet](https://github.com/BinaLab/RescueNet-A-High-Resolution-Post-Disaster-UAV-Dataset-for-Semantic-Segmentation) | Post-Hurricane-Michael damage and blocked-road imagery | Dataset README states CC BY-NC-ND. Do not interpret the repository's MIT software label as commercial permission for the dataset. |
| [FASDD](https://github.com/OyamingO/FASDD) | Fire and smoke imagery, including remote-sensing contexts | Follow its DOI to the primary data repository and verify the particular release terms before ingestion. Not downloaded or cleared here. |

## Downloaded sample

Additional real fire videos, flood image/mask samples, import findings and broader humanitarian
dataset candidates are recorded in [Real footage starter](RESCUE_DATASET_STARTER.md). No model
has been trained on those new downloads.

`tools/fetch_rescue_sample.py` retrieves `examples/wildfire.mp4` from the Fire-Detection
repository at commit `9d99b0e71fd4cc930da053a41b79de1c58aabdf2`. It saves a SHA256 hash,
the source URL, the repository license, and limitations in `data/rescue-sample`.
It does not execute code from that repository or load its model checkpoints.
The clip is a functional test asset, not an annotated accuracy benchmark or a cleared
commercial training corpus.

On a fresh checkout:

```powershell
python tools\fetch_rescue_sample.py
python -m tracker.cli.rescue_review --video data\rescue-sample\wildfire.mp4 --show
```

## Obtaining trained weights

The general `yolo26n.pt` model is already installed. Its default COCO labels do not include
fire, smoke or floodwater. A separate experimental checkpoint is installed under
`models/rescue-fire-smoke/best.pt`. Its source is `rabahdev/fire-smoke-yolov8n` at revision
`13017fe8af477c25f5298d168e2dfede4b000753`, with SHA256
`b91633799ceb052c814b4f8b77a37efc9a40f002d528df97d74463585fa4f28f`.
The publisher's model card is preserved beside the weights. This is a functional integration,
not independent accuracy validation. Public metrics from unrelated cameras are not project metrics.

`python tools\fetch_rescue_fire_model.py` reproduces the download on a fresh checkout.
Select it with `--config configs\rescue_fire_review.yaml`. Floodwater and debris remain
unsupported, and the overlay says so. The older Fire-Detection YOLOv5 research models are
documented as alternate sources; they have not been installed or converted.

For new compatible hazard weights, use an appropriate licensed dataset with verified label
names and splits, train a detection/instance-segmentation model, and validate it independently.
Ultralytics documents [training](https://docs.ultralytics.com/modes/train/) and
[validation](https://docs.ultralytics.com/modes/val/). The dataset's YAML must point to actual
prepared files; do not silently substitute demonstration images for a training corpus.

Ultralytics publishes [AGPL-3.0 and Enterprise licensing terms](https://www.ultralytics.com/license).
Its licensing guidance identifies Enterprise as the route for proprietary embedding without
AGPL source-disclosure obligations. The MIT label on this project's own code does not replace
the licensing obligations of its dependencies, models or datasets.
