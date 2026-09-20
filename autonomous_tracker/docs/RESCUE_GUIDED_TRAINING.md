# Train using your labels

Rescue Studio 0.9 lets you correct a model's full-video predictions and train an update.

## Already have a model? Correct it instead of labeling from scratch

1. Open your video project, then **04 Train model**.
2. Select your trained version in **My models**.
3. Click **Analyze entire video and correct boxes**. Confirm once. Studio processes every
   frame, then opens editable predictions in **Label video**. No annotation-file hunting.
   For different footage, use **Analyze another video...** and choose only the video.
4. Move or resize wrong boxes, change their tags, delete false detections, and draw missed
   objects. Mark frames reviewed only after checking all objects on each frame.
5. Click **Save and train updated model** above the video. Confirm once. Studio fine-tunes
   the model that made these predictions using this project's approved frames and saves a
   separate version in **My models**. It does not start with random weights.

Re-analyzing refreshes untouched machine drafts, including empty machine predictions.
Your manual edits, deliberate deletions, and reviewed frames remain protected. Old projects
without explicit machine-draft provenance are protected too. Use **Use predictions on this
frame** only when you intentionally want to replace existing labels on that frame.
Prediction refresh is undoable. Save your correction project to keep the imported drafts.

For another video, Studio saves a resumable project automatically under
`annotations/corrections` and lists it in your footage library. Runs are stored under
`diagnostics/rescue-corrections`. Original videos and older models stay unchanged.
**Stop** cancels analysis without applying a partial run to the open editor. A project
already saved at the very end of another-video preparation may remain available to resume.

Full-video analysis is separate from **Quick preview (300 frames)**, which is view-only.
The editor currently imports at most 100,000 frames and 200,000 boxes per run. For footage
above these limits, use the existing clip-cutting workflow to make manageable sections.
CPU analysis and training can take time; this workflow reduces manual labeling, not the
amount of computation needed or the need to check predictions.

## Follow a corrected box through later frames

YOLO's track links now survive import. Select a box to see its `T-...` identity and status.
When re-analysis has an unambiguous overlapping match to a previous machine track, its
link is retained. Ambiguous or fragmented identities are not silently joined together.
After a correction, **Update following...** previews changes to that track's later untouched
drafts. **Track & next** follows all current boxes one frame forward; **Auto-track on Next**
does this on ordinary Next clicks. **Keep positions** is the quick choice for static scenes.

Motion following combines local optical flow with appearance matching for small or
low-texture boxes. Range tracking checks against the starting appearance to help limit
drift. Missing or ambiguous matches stop or show **Needs attention**; they are not approved
as correct. Reviewed frames and manual keyframes are protected. Apply a range after checking
the preview; one Undo restores it. New objects still need detection or manual boxes.

## First model: train using your labels

1. Label your video, mark checked frames reviewed, and save.
2. Open **04 Train model** and click **Train using these labels**.
3. Confirm the starting model and run. Studio prepares the data and trains automatically.
4. The completed version appears and is selected in **My models** automatically.
5. Click **Analyze entire video and correct boxes** to improve its predictions, or
   **Quick preview (300 frames)** for a short view-only preview.

You do not need to find annotation JSON files, choose export folders, invent recording
groups, or supply a second video to make a practice model. The open project's approved
frames are used. Other projects from an older training selection are not silently included.

## What happens to my work?

- Your saved boxes and approvals stay unchanged. Only reviewed frames are used.
- Tags with no boxes anywhere in the project are left out of this run, without editing
  the project. Removing such an unused tag in the label editor also preserves approvals.
- A tag used only in draft frames is not silently discarded. Review an example first.
- Reviewed empty frames are included as negative examples. Draft frames are excluded.
- Files are prepared in a new folder under `training` beside the saved annotation project.
- The starting model and active observation model are not replaced or activated.
- The model learns from a frozen saved revision. Later label edits require a new run.

## My models: no file hunting

Open **04 Train model** and select a row in **My models**. It shows the model name,
the labels it recognizes, its training date and whether it is the default.
Completed runs in this workspace's annotation, data and training folders are found
automatically. Failed or stopped runs are not presented as completed models.

- **Analyze entire video and correct boxes** opens full-video predictions for correction.
- **Analyze another video...** creates or resumes managed labels for another recording.
- **Quick preview (300 frames)** previews that version on the open video.
- **Quick preview another video...** previews that version on another recording.
- **Train updated version...** uses that version as the starting model and trains from
  the open video's approved labels. Other videos are not silently included. Confirm once.
- **Rename...** gives a version any readable display name. It does not rename your files.
- **Open model folder** opens its managed folder without asking you to find it.
- **Refresh models** discovers work completed in another Studio window.

The home screen also has **My models**, with **Use selected model as default...** for
new video-analysis jobs. Selecting a row, previewing, or training does not change this default.
You can still return to an older version. New training never overwrites it.

Studio saves a verified copy of each newly registered training checkpoint under
`models/studio` in your workspace. It chooses the checkpoint recorded by the training run,
not whichever `.pt` filename looks preferable. The original run, labels and footage stay
where they were. Keep the original run for full training history and quality comparisons.
Existing manually registered versions retain their names and references; do not move
those original files. Newly added model files from the home screen are copied into managed
storage too. You do not need to separately register newly completed training.

**Open last preview** belongs to the selected model and is disabled if the saved preview
was made by another version. A quick preview is still view-only. Use the full-video
analysis button to open editable predictions in the label editor.

## Starting model and settings

Your saved model choice is reused. Otherwise Studio suggests a workspace model, preferring
the active registered version when available. If this workspace has no model yet, use
**Change starting model or settings** to choose a trusted local `.pt` file once.
No model is downloaded automatically. Model files can execute code when loaded, so only
use trusted files and footage you have permission to use.

The saved settings are reused, initially 30 passes, 640-pixel images, batch 4, and CPU.
CPU training can take a while. Progress shows preparation and completed training passes.
**Stop** requests a graceful stop; a second click offers forced termination. A failed or
stopped run does not replace the last successfully completed model.

## Trying the model is not testing its accuracy

Practice models are marked **NOT INDEPENDENTLY TESTED**. This mode does not create a fake
validation split from the teaching video. It runs no validation loader or final validation,
produces no validation scores, and uses the last completed epoch's checkpoint.

**Quick preview (300 frames)** processes up to the first 300 frames of the current video and opens
a silent, playable prediction preview inside Studio. **Quick preview another video** lets you pick
different footage without first labeling it. **Open last preview** reopens the saved result.
These predictions never replace your labels or become approved examples automatically.
Trying another video without reviewed truth is still a visual preview, not an accuracy test.

## Checking reliability later

Use **Check quality later** when you have independently recorded, reviewed footage.
Known source copies, cuts and shared events cannot be used as independent checks.
Footage already reserved for validation or final testing is not consumed by the quick
training button; changing that purpose requires an explicit action in Advanced.

**Advanced > Manage datasets** retains multi-video selection, purpose assignments,
shared tags and the strict train/validation export workflow.
**Advanced > Technical settings and logs** contains training settings and full job logs.
The main training screen does not require those steps for a practice run.

Training success and visual previews do not establish real-world accuracy, data rights,
or field readiness. The desktop workflow is local annotation and observation only;
no hardware or projectile interfaces are connected or packaged.
