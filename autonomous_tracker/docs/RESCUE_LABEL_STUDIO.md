# Rescue Label Studio

In version 0.9, choose **04 Train model > My models > Analyze entire video and correct boxes**
to improve an existing model. Correct and review its drafts, then use **Save and train updated
model** above the video. For a first model, use **Train using these labels**.
Studio prepares the approved labels and trains automatically, including with one video.
Completed models appear automatically in **My models** with names, dates and selection actions.
See [the short training guide](RESCUE_GUIDED_TRAINING.md). The older dataset-management
workflow described below is now under **Advanced** and is optional for practice training.
Removing a genuinely unused tag preserves boxes and review approvals.

A local Python/Tk desktop interface for image-space annotation, evaluation and supervised
rescue-observation training. It does not connect detections to hardware or projectile calculations.
Training uses a trusted local detection checkpoint and saves separate new weights. Optional
Ultralytics account/analytics callbacks are disabled for the training call. The library can still
check its version or fetch a display font; no footage upload is implemented by this workflow.

## Open the footage

Use the Windows installer and open **Rescue Studio** from its shortcut. At first launch, choose your
existing workspace or create a new one. See [Desktop installation](RESCUE_DESKTOP_INSTALL.md).
The older **Rescue Studio.exe** in the source project still works, but that development launcher
needs the adjacent `.venv`, source, and configuration folders. The installed application does not.

- Select a clip and click **Continue labeling**, or double-click its library row. This opens your
  saved boxes directly on the annotation tab. It does not start training, run YOLO, or import predictions.
- The editor remembers your frame and active tag when you save or close. Save box corrections with
  **Save project** / Ctrl+S. Closing with unsaved edits still asks whether to save them.
- **Resume project...** opens an existing annotation JSON directly, including projects outside the
  library. If its video moved, choose the original when prompted; the content hash must still match.
- **Label with selected predictions...** is a separate, explicit import action. Existing edits are
  preserved; replacing boxes on an already edited frame still requires confirmation in the editor.
- **Prepare dataset / train...** is a separate later step. It is never required to resume corrections.
- The library prefers the project with the latest saved editing session for a clip, then the
  most-reviewed project. The project picker lets you choose another revision explicitly.

The right-hand details panel scrolls so prediction, model, training and file controls remain reachable
on smaller windows. **Continue labeling** stays above the scroll area.

### Watch footage, find boxes, cut clips and review batches

The top row of **Annotate footage** now provides:

- **Play / Pause**, playback speed from 0.25x to 4x, a seek slider, timestamp and frame number.
  Playback shows existing boxes and optionally original predictions. It never runs tracking,
  propagates boxes, creates labels or approves frames, even with Auto-track on Next enabled.
  Click the image to pause and edit. Navigation, editing and switching tabs pause playback.
  This is video-only playback with no audio. Every frame is displayed in order; slow decoding
  or rendering can reduce playback speed below the selected nominal rate.
- **All boxes...** lists every box occurrence across the current project, including unsaved edits.
  Search by tag, ID or frame; filter drafts, reviewed frames or Needs attention. The list is paged
  in groups of 200. Double-click a row to select that box in the main editor. Repeated IDs represent
  occurrences across frames, not additional unique objects. Use Search / refresh after editing.
- **Cut clip...** selects inclusive In and Out frames. Type frame numbers, or navigate the main
  video and click Set from current for each boundary. Whole video selects everything. Export creates
  a uniquely named folder containing a lossless `clip.avi`, a rebased `clip.json` label project and
  `clip-origin.json` provenance. Each output frame is decoded and checked for pixel-exact agreement
  before the export is accepted. Existing boxes, IDs, deletion history and review states survive;
  frame numbering restarts at zero. The original video/project are unchanged, and labels are a
  snapshot from export start, not a live link to future edits. Audio is not copied. Lossless clips
  can be large, require even image dimensions and are limited to 100,000 frames per export.
  Cancellation cleans up only the incomplete new clip. **Open exported project** opens the result
  separately when requested. The default destination is a `clips` folder beside the source project.
  Home can discover these clips under workspace `annotations` or `data` after Refresh; for a custom
  external destination, use Resume project and select the exported `clip.json`.
- **Bulk review...** displays six boxed thumbnails at a time for a selected frame range. Click a
  thumbnail to correct its frame in the main editor, then refresh the thumbnail page. Mark this
  page reviewed, mark the entire range reviewed, or return the range to draft. A confirmation
  shows counts and warns when the entire range includes frames not on the current page. Marking
  frames reviewed is your explicit approval, not an automated quality check. Empty/unlabeled
  frames are excluded unless you opt into reviewed negatives. Unresolved Needs attention boxes
  always block their frame from approval. Each batch supports one Undo in the main editor;
  Save project persists the changes. A maximum of 10,000 frames can change in one batch.

Clips inherit the incident and split and record source ancestry. Dataset checks and training export
reject related clips crossing splits, even if an incident is renamed. Overlapping clips within a
split can still double-count examples; dataset checks warn about related clips. Ancestry checks
cannot detect arbitrary externally transcoded footage or manually removed metadata.

Version 0.5 opens older projects and adds source ancestry metadata when saving. Older Studio
versions cannot read these new fields. Keep backups and use the updated app for continued editing.

### Quick box tags

Tags are the model's training classes, not additional notes or multiple categories on one box.
Select a box, then click a tag button to change only its class. Or type a name in the tag field and
press **Enter** / **Create / apply tag**. A new name creates the class and applies it in one undoable
edit. **New tag...** opens a small name dialog. With no box selected, the tag becomes active for the
next box you draw. A newly drawn box is selected automatically, so you can name it immediately.
Use **Deselect box / tag the next box** to change the next drawing's class without relabeling the
current box. Coordinates, anonymous IDs and prediction provenance are preserved on relabel.

Adding a new class keeps all existing boxes but returns reviewed frames to draft, because they
must now be checked for that class too. The editor asks before resetting existing reviewed frames.
Choosing an existing tag changes only the selected frame's review status. **Undo** restores the
previous boxes, class list and review status. Tag names become actual YOLO class names when reviewed
frames are exported; adding names alone does not train the model. All projects in a training dataset
must use the same exhaustive class scope.

Frame-position state lives in a `.studio` sidecar directory next to each project. It is not part of
the annotation truth, score digest or exported YOLO dataset. Older projects without a saved position
start at frame zero. Box review is still explicit, not continuous autosave.

### Carry boxes forward without redrawing them

The **Annotate footage** tab has a **Carry boxes forward** section directly above the image.

For the everyday frame-to-frame workflow:

1. Draw or correct the boxes on the current frame.
2. Click **Track & next**. This follows all current boxes into the adjacent next frame and applies
   the drafts immediately, without a separate preview dialog. One Undo restores this carry edit.
3. To do that on ordinary **Next** clicks, enable **Auto-track on Next**. The status changes to
   **AUTO ON** and the navigation button changes to **Next (auto-track)**. It does not play through
   the clip unattended. Backward navigation, jumps, and suggested-frame queue navigation do not
   propagate boxes. **Review and next**, outside the suggested queue, reviews the current frame
   and tracks into the adjacent next frame when auto-track is on.
4. Use **Follow motion** for moving objects, or **Keep positions** for an explicit fixed-position
   copy. Fixed copying does not test whether the object moved or is still present.
5. Review the carried boxes, correct drift, and add newly appearing objects yourself. These controls
   do not run YOLO or discover new objects. Save normally. Auto-track and mode preferences are
   restored with the project's saved viewing position. New projects default to AUTO OFF.

Assigned Object IDs are retained. For boxes without a user-assigned ID, Studio displays a stable
`T-xxxxxxxx` abbreviation of the internal tracking identity as soon as they are carried. This is
not an automatically assigned ground-truth Object ID. **Track details...** shows the full identity.
Box captions and the box list include status text; color is an additional cue, not the only cue:
light blue **Predicted**, blue **Tracked**, purple **Copied/Draft**, yellow **Corrected**, green **Reviewed**, red **Needs
attention**, and white **Manual/Keyframe**. Keyframe means a starting box, not reviewed truth.

If adjacent-frame motion tracking fails, the last known position appears as a red dashed editable
box marked **Needs attention**, not as a successful match. Select it to see the failure reason.
Move/resize it, use **Confirm / update selected box** if it is correct, or delete it if the object
is absent. Changing only its tag does not confirm its location. Unresolved red boxes block further
tracking and frame review. Their warning survives saving/reopening and is restored by Undo.
Switching auto-track off still allows ordinary navigation without altering any labels.

An already reviewed next frame opens unchanged. Existing manual boxes and later corrections are
protected against overwrite. A conflicting last-known suggestion can be withheld rather than
drawn over an existing protected box; the footer reports failures and protected conflicts.
Cancellation, navigation away, changes to labels, or changing tracking mode while a step is running
discard its pending suggestions. Nothing is silently autosaved or approved for training.

Additional controls:

- **Copy all boxes to next** copies the current boxes at their existing pixel positions and
  opens the next frame. Use this for mostly static scenes, then adjust anything that moved.
- **Track range...** previews **All boxes** or the **Selected box** up to an end
  frame. **To end of video** fills the last frame number. **Follow motion** uses local optical
  flow plus appearance matching and a starting-appearance check to help limit drift;
  **Fixed positions (copy)** keeps coordinates unchanged and does not follow camera movement.
- **Update following...** starts from your current correction. Select a box for a single-track
  update, or choose all boxes to refresh multiple tracks. Preview, inspect frames, then apply.

Tracking runs in the background and can be cancelled. One operation is limited to 5,000 frames,
512 seed tracks, and 100,000 box-frames. For longer clips, continue from another checked frame.
It does not run YOLO, recognize a new class, train weights, or reliably reacquire an occluded object.
Motion, appearance ambiguity, texture, forward/backward consistency, scene-change and boundary
checks can stop a track. YOLO track links survive prediction import, without becoming
ground-truth Object IDs. A label or position correction can update that track's later untouched
drafts using **Update following...**. You still need to check the result.
The preview lists each box's last suggestion and stop reason. Motion support is not accuracy.

Generated boxes stay drafts. Correct every object on a frame, including missed objects, then
**Review and next**. Export/training includes only explicitly reviewed frames. Closely adjacent
frames are correlated; more copied boxes are not a substitute for diverse footage and held-out
incidents. Merely applying tracking suggestions does not train the detector.

The default **Update this track's untouched generated drafts** replaces only that track's prior
machine suggestions. Hand-edited boxes, conflicting existing boxes and reviewed frames are
preserved. A later correction, tracked deletion, or reviewed frame stops that track before the
protected frame. Continue from that later frame if you want to update beyond it. This prevents an
earlier correction from overwriting a later one. Imported or older propagated boxes without this
new tracking history are treated as existing labels, not silently claimed by a new track.

If a tracked box disappears, delete it on the first absent frame, then **Update following...**
with **All boxes** to remove its later untouched drafts. A failed retrack can likewise remove stale
drafts before the next protected keyframe. The preview and confirmation show additions, updates,
removals and protected conflicts. Uncheck the update option to add proposals without replacing or
removing existing drafts.

Nothing changes before confirmation. A single **Undo label edit** restores the whole range edit,
including its tracking history. **Save project** persists boxes and internal tracking links so the
workflow survives reopening. These links are independent of optional object IDs and are excluded
from truth/YOLO exports. Changing labels while a preview is running makes that preview stale;
preview again before applying. Do not open newly saved projects in an older Studio version.

### Assisted review and nearby-frame suggestions

Open the editor's **05 Assisted review** tab. Choose a saved recognition run, or use
**Without predictions**, then **Build suggested queue**. It combines low-confidence detections,
abrupt box motion, disappearing tracks, sampled scene changes and coverage samples. Sampling is
bounded, so this is a prioritization aid, not an exhaustive search for missed objects.

**Open next suggested** returns to the annotation tab. Correct every object on that frame and click
**Review and next** to save and advance. **Skip suggestion** records a skip without approving any
boxes. **Undo skip** restores the previous queue position and skipped-frame state. **Exit queue
navigation** restores normal frame ordering. Queue progress saves automatically to a project-local
`.studio/*.queue.json`; label edits still require saving. Reopening the project restores the queue.
Changing class scope invalidates the old queue; rebuild it. Changing a skipped frame makes it
pending again. Finishing the queue does not mean the entire video is reviewed.

For propagation, first select a corrected box on the annotation tab. In **Assisted review**, choose
1-60 nearby frames and a direction, then **Preview propagation**. Inspect the proposed frames in
the dropdown before **Add previewed suggestions as drafts...**. This uses forward/backward optical
flow and agreement checks, not a learned guarantee that the same object was followed. It stops
when texture, motion support, scale, or image-boundary checks fail.

Reviewed frames and existing overlapping boxes are protected. By default, existing draft frames
are also skipped; the explicit **Add to existing draft frames** option can append non-overlapping
suggestions without replacing boxes. Additions stay unreviewed. One **Undo** restores the entire
propagation edit. If labels changed after the preview was computed, rebuild it before applying.
Motion support and detector confidence are not calibrated accuracy scores.

### Model versions and batch processing

From Home, **Model library and versions** imports trusted local detection `.pt` files, observation
configs, or completed Studio training results. Names are editable; configurations and weight
checksums are pinned. The details panel shows local weight references, training settings and saved
validation checks where available. Importing or selecting a row does not activate it.

Choose **Use for new observation jobs...** explicitly. **Revert to previous active version...**
selects the preceding active model after verifying its files. Neither action overwrites weights
or changes labels. Existing jobs and saved batches retain their original model snapshots. The
active selection persists per workspace; a corrupt active record does not silently fall back.
Weights are referenced, not copied: keep the source `.pt` files and training result folders.

After training, step 4 also offers **Save this trained version to model library...**. Continue to
test/compare it against held-out reviewed footage before deciding whether to use it. An imported
model without a Studio training record can still generate predictions; use **Evaluate runs** for
those results. Guided trained-versus-starting-model comparison needs the training record.

**Batch video processing** lets you choose multiple videos and **Create batch from footage...**.
This pins the selected model and checks video identities without starting inference. **Start /
resume / retry unfinished** processes the videos sequentially, with frame progress, per-video
errors and attempt folders. **Stop batch** stops cooperatively at an inference boundary.
Completed checksum-valid results are retained and skipped on retry; failed/interrupted attempts
remain available, and unfinished videos get new attempt folders. Reopen saved batches to resume.
**Review selected result** opens its predictions as editable drafts, never reviewed truth.

Model and batch windows must finish their current operation before closing. The home library can
remain usable while a batch runs. **Open another workspace...** opens a separate workspace chooser
without closing current editors. Back up the whole workspace, including `.studio`, plus any media
or weights referenced from outside it.

### Optional command-line entry point

From this project's directory with `.venv` active:

```powershell
python -m tracker.cli.rescue_annotate
```

File pickers ask for the original video, an existing or new annotation project, and the classes
for a new project. Choose the ORIGINAL video, not an exported video with boxes burned into pixels.
To specify paths directly instead:

```powershell
python -m tracker.cli.rescue_annotate --video data\rescue-sample\wildfire.mp4 --project annotations\wildfire.json
```

The same command resumes the saved project. The video can move, but its byte content,
dimensions and frame count must match. The decoder must expose a finite positive FPS and
frame count, and must support verified frame-index seeking. Use an offline constant-frame-rate
transcode if the original does not support these requirements; annotate and evaluate the SAME
transcoded file. Frame indexing starts at zero, not one. Camera calibration is not required.

Default class scope: person, fire, smoke, boat, car, truck, bus, floodwater, debris. For a narrower
new project, add `--classes fire,smoke,person`. Every visible object in that declared scope must
be labeled on each reviewed frame. Predictions outside scope are excluded, not counted as
false positives. Do not change the scope partway through a comparison. A class with no evidence
has undefined precision/recall, displayed as `N/A`, not perfect accuracy.

## Label and review

1. Navigate with Previous/Next, +/-10, a frame index, or Next unreviewed.
2. Choose or type a rescue class. Drag on empty image space to create a box. Enable **Draw new
   box** to draw inside an existing box. Coordinates are stored in ORIGINAL image pixels.
3. Optionally enter a stable object ID, such as `person-1`. Keep the same ID for the same object
   across frames; different objects in one frame cannot share an ID. This is an anonymous label,
   not a person's identity. IDs are required to measure tracking-ID changes.
4. Click a box to select it. Drag its interior to move it, or a yellow corner handle to resize it.
   Selecting its list row also works. Type a different class and click **Update selected box**
   to relabel that box. The numeric coordinate fields remain available for precise edits.
   **Delete selected box** and **Undo label edit** are available; Ctrl+Z also undoes edits.
5. After checking ALL scoped objects, click Mark frame reviewed. A reviewed frame with no boxes
   is an explicit negative. Unreviewed frames remain drafts and are excluded from scoring.
   Editing a reviewed frame always returns it to draft. **Review and next** combines review
   with navigation to the next unreviewed frame. Scroll the sidebar if some controls are below
   the visible area.
6. Save project (Ctrl+S). Export reviewed JSON writes a separate, uniquely named ground-truth
   file compatible with `rescue_review --annotations`. Drafts remain in the project, not the export.

Saving is explicit, not continuous autosave. Evaluation and training/export actions save the
current project before reading it; opening the training tab also saves and refreshes its list.
Closing prompts for unsaved edits. Each replacement
save retains the preceding project in a uniquely named backup beside it and atomically replaces
the active project. A save lock and checksum check prevent competing application writers from
silently overwriting edits. After an interrupted process, a stale `.PROJECT.json.lock` may remain;
verify no annotation process is saving before manually removing only that lock. Backups are not
automatically pruned. `annotations/` is ignored by git.

## Generate observations once

```powershell
python -m tracker.cli.rescue_review --video data\rescue-sample\wildfire.mp4 --config configs\rescue_fire_review.yaml
```

The printed output directory contains `frames.jsonl` and `summary.json`. New runs record the
source video SHA256. Older runs without that fingerprint must be regenerated once. The studio
does not silently assume that matching filenames or dimensions mean matching video content.

## Correct an existing recognition run

Click **Import recognition boxes...** in Annotate footage and select that run's output directory.
This requires the same original video, but does NOT require any reviewed labels beforehand.
Alternatively append `--suggestions diagnostics\rescue\YOUR_RUN_DIRECTORY` when opening the studio.

- Saved detections become editable, unreviewed draft boxes on frames with no existing annotation
  record. Empty prediction frames remain drafts, never automatic reviewed negatives.
- Existing labels are preserved, including reviewed frames and deliberately emptied draft frames.
  **Use predictions on this frame** explicitly replaces the current frame after confirmation.
  Undo restores its prior labels and review status. The saved recognition run itself is unchanged.
- **Show original predictions** displays dashed blue reference boxes; the normal boxes are the
  editable labels. Re-import the saved run after reopening if you want this reference overlay.
- Predictions outside the project class scope are reported and excluded from editable labels.
  Add a needed rescue class first, then use predictions on the relevant frame. Unknown names are
  never silently added to the labeling scope.
- Model tracking IDs are not copied into human truth IDs. Assign IDs independently if measuring
  tracking identity changes. Imported drafts retain the prediction-log SHA256 as provenance.
- Import validates source hash, image bounds, contiguous frame indices, timestamps and summary
  counts. Failed/unfinished or incompatible old runs must be regenerated. Import is bounded to
  100,000 frames and 200,000 boxes.

These are suggestions, not ground truth. Correct wrong boxes/classes, delete false detections,
and add missed objects before marking each frame reviewed. Reviewing only the model's detections
can preserve its blind spots, so inspect the full frame, including frames with no detections.

## Manage rescue classes

Type a class name in the class field and click **Add class**, or use it when drawing/updating a
box. Names are normalized to lowercase and limited to 64 characters without control characters.
**Rename class throughout project...** changes that class on every frame; changing a selected
box's class only changes that box. **Remove unused** removes a class only when no boxes use it.

Adding, renaming or removing a class returns every frame to draft. This is intentional: labels
must cover the full new class scope. Undo restores the prior scope and review status. Keep the
same class names across all training/validation/test projects. Start with a small scope such as
`fire` if you do not yet have examples of other classes. These are humanitarian observation
labels, not combatant-status judgments or inputs to an aiming/firing system.

## Export and actually train

The **04 Export and train** tab provides the complete local workflow:

The project list, chosen export, weights, settings, completed model and recent model checks are
remembered per project. Reopening the same project restores that training workspace, without
changing its boxes. **Test models and view saved comparisons** jumps directly to the results.

1. Add the saved annotation projects to use. Select each row, enter its incident/recording group,
   choose training, validation or test, and click **Save selected assignment**. Recordings of the
   same incident must stay together, even if the files differ.
   **Edit shared dataset tags...** applies one tag list to all selected projects. It starts with
   their combined tags, preserves every existing box, and refuses to remove tags that still have
   boxes. Confirming a changed scope returns that project's reviewed frames to draft. Review those
   frames again for the new exhaustive scope. Backups are retained, but are not listed as projects.
2. Click **Check and export...** and choose a parent folder. A uniquely named dataset folder is
   created. No existing dataset or project is replaced. Only reviewed frames become lossless PNG
   images and YOLO detection `.txt` labels; reviewed negatives get empty label files.
3. Choose trusted local `.pt` detection weights. A pretrained fire/smoke observation model is at
   `models\rescue-fire-smoke\best.pt` in the existing starter setup. Check the source/license of
   every model and dataset yourself. Loading untrusted model files can execute code.
4. Set epochs, image size (a multiple of 32), batch and device. CPU works with the existing CPU
   PyTorch build. Device `0` requires a compatible CUDA installation; the UI does not install one.
5. Click **Start training...** and confirm. Training runs in a separate process while the UI stays
   responsive. Logs, new checkpoints and a new `review.yaml` are saved under the exported dataset's
   `training-runs` folder. **Stop training** requests cancellation at a batch boundary; pressing it
   again offers forced termination. Existing checkpoints/logs are retained, but a forced stop may
   leave the latest write incomplete. Nothing is automatically deployed.
6. After successful training the app opens the testing section. Choose a reviewed **validation**
   project and click **Test this model**, or **Compare with starting model**. These buttons run real
   local inference, then score both models against the same frozen reviewed labels. Training and
   final-test incidents are rejected from this model-selection workflow. Results show precision,
   recall, reviewed-frame coverage and unsupported labels. Unsupported starting-model tags are
   explicitly listed; differing tag support is not a like-for-like quality comparison. If the
   starting model supports none of the tags, only the new-model test is available.
7. Select a result and use **Inspect selected run / correct boxes** to open the validation editor
   and its error review. Save corrections, then rerun the check. Previous scores are retained as
   snapshots and flagged stale when selected if reviewed labels changed. **Open selected result
   folder** shows the saved evidence. **Stop check** cancels at a frame boundary; partial output
   remains available but is not presented as a completed comparison.

Export requires matching exhaustive class scopes, reviewed training AND validation data, nonempty
incident tags, and at least one reviewed training box for each class. Duplicate source videos,
cross-split incident tags, changed source videos and unreviewed-only projects are blocked.
Hash/incident checks cannot detect every transcode or incorrectly tagged related recording.

Each export includes `data.yaml`, snapshots of the annotation projects, split/class counts and
SHA256 checksums of exported files in `manifest.json`. Training verifies those files, then makes
an isolated copy of TRAINING AND VALIDATION data inside its new run directory. Allow disk space
for that extra copy. Test images are not copied into the training workspace. YOLO's generated
caches therefore cannot modify the reviewed export. Incomplete exports retain `FAILED.json`
for diagnosis and cannot be trained through the guided workflow.

Exports are immutable snapshots, not live views of the projects. Changing reviewed boxes, review
status, tag scope, incident assignments, splits or the selected project set flags **STALE EXPORT**
and blocks training until **Check and export...** creates a fresh snapshot. This check runs again
in the training worker. Draft-only edits and relocating an identical source video do not change
the exported examples. A relocated original must pass the video identity check; **Save** persists
its new path even when no box was edited. Backup and truth-export JSON files are excluded from
library discovery, and automatic project selection uses at most one revision per video.

**Saving or exporting labels alone does not train anything.** Only the explicit training step
updates weights. This uses the official [Ultralytics training API](https://docs.ultralytics.com/modes/train/)
and [YOLO detection dataset format](https://docs.ultralytics.com/datasets/detect/).

Optional terminal equivalent, after exporting reviewed data:

```powershell
python -m tracker.cli.rescue_train --data PATH_TO_EXPORTED_DATA_YAML --weights models\rescue-fire-smoke\best.pt --epochs 30 --device cpu
```

The GUI can reopen a completed training `result.json` with **Open completed training...**. Terminal
users can still use the printed `review.yaml` with `rescue_review --config`. Reserve separate
test incidents for the final evaluation. A successful training job, one-epoch synthetic smoke test,
or a tiny starter dataset is not evidence of field accuracy or rescue readiness. Fine-tuning on a
restricted class set does not preserve the original model's ability to detect excluded classes.

## Evaluate and compare

To open and evaluate without a folder picker, append `--run diagnostics\rescue\YOUR_RUN_DIRECTORY`
to the `rescue_annotate` command. Unlike `--suggestions`, this requires reviewed frames first.

In the Evaluate runs tab:

- Set the incident/recording group and dataset split. All footage from one incident should stay
  in one split. The Dataset checks tab can check these tags and exact video hashes across projects.
- Click Add saved run and evaluate, and select the output directory from `rescue_review`.
- The worker re-scores saved observations at box IoU >= 0.5; it does not rerun YOLO.
- Add another run to compare model/configuration changes against the same annotations.
- The table shows overall precision/recall, FP and FN counts, tracking-ID changes, processing p95
  and coverage. Select a row for per-class results and limitations. Scroll the class table for all labels.
- If reviewed labels change, older rows are marked stale. Rescore before comparing. Each result
  stores the annotation snapshot, input hashes, model settings, per-frame counts and coverage in
  a new `evaluations/evaluation-...` folder beside the annotation project.
- The details panel flags differences from the first run's source, label snapshot, IoU or scored
  frames. Matching settings do not make a small or biased dataset representative.

### Inspect the frames behind a score

Select a run, then open **Inspect error frames**. The default list contains frames with false
positives, missed labels, ID changes, or missing predictions. Uncheck the filter to include all
scored frames. Double-click a row or use **Inspect selected frame**.

The paired viewer shows the exact human-label snapshot on the left and saved model detections
on the right. Green boxes matched at the stated IoU; red truth boxes were missed; pink model
boxes were unmatched. Tracking-ID changes show the previous and current model IDs. Both panes
use the same verified source frame. Missing prediction frames retain gray, explicitly unscored
human labels and never acquire invented FP/FN counts.

**Edit this frame's labels** returns to that frame in the annotation tab. It does not copy model
boxes into ground truth. Existing results retain their earlier label snapshots and must be
rescored after reviewed labels change. Older results without box evidence require a fresh
evaluation of their existing prediction log, not a new YOLO run.

### Check dataset splits

The **Dataset checks** tab starts with the current annotation project. Select multiple current
project JSON files to inspect the wider dataset, excluding backup and exported truth files.
**Check dataset splits** saves the open project first and checks the saved versions of the
selected files in the background. The JSON report is saved under `audits/` beside the project.

It flags:

- The same recorded video hash across training, validation or test splits.
- The same normalized incident tag across splits, even if video hashes differ.
- Duplicate copies of a video, missing incident tags, unassigned splits, invalid project files,
  missing reviewed labels/negatives and differing class scopes.

The auditor does not change splits or move files. It normalizes incident-tag case, Unicode and
whitespace. It cannot recognize undeclared related incidents, visually similar clips, or transcodes
whose incident tags are wrong. It checks recorded hashes, not the source video files themselves.
`no_known_overlap` means these checks found no issue, not proof of independence or data rights.

```powershell
python -m tracker.cli.rescue_audit --projects annotations\incident-a.json annotations\incident-b.json
```

CLI exit codes: 0 = no known issue, 1 = warnings needing review, 2 = split conflicts or invalid
files. Every check writes a uniquely named report, including checks with warnings or conflicts.

For one saved detector configuration across multiple videos, use the separate
[multi-incident benchmark](RESCUE_BENCHMARK.md). It applies split checks before scoring, retains
per-incident results and withholds aggregate metrics for incomplete or incompatible runs.

### Re-score from the command line

The evaluation CLI provides repeatable scoring without opening the interface:

```powershell
python -m tracker.cli.rescue_evaluate --project annotations\wildfire.json --run diagnostics\rescue\YOUR_RUN_DIRECTORY
```

`--iou` selects a different matching threshold, and `--output` selects the result root. Keep IoU
and label scope identical when comparing. The CLI reads saved projects, not unsaved GUI edits.

## Interpret the results carefully

- Precision/recall use one-to-one class-aware box matching at a fixed IoU, not mAP or HOTA.
- Missing reviewed-frame predictions are explicit coverage gaps; they are not silently treated
  as model misses or clean negatives. Compare runs covering the same reviewed frames.
- False-positive frames and reviewed negatives with false positives are counted separately.
  The optional FP boxes per labeled minute uses reviewed-frame count divided by nominal FPS,
  not the time span between sparse labels. Repeated boxes count on each frame. This is NOT
  an independent alarm-event rate, and variable-rate video can distort its minute denominator.
- Processing p95 includes frame read, inference, drawing and video encoding from the saved run.
  It is not sensor-exposure-to-display latency, and the studio is not measuring live camera delay.
- Identity changes require matched truth IDs and model tracking IDs, including across gaps.
- Labels still require careful human review. The downloaded wildfire clip is a workflow demo,
  not an independently labeled or representative disaster benchmark. Do not infer field reliability
  from synthetic test fixtures, a few labeled frames, or a single incident.

Use representative negatives (fog, glare, steam), occlusion, low light and camera motion. Reserve
entire independent incidents for final testing. Choose models and thresholds using validation
material, and report sample sizes and coverage alongside every score.
