# Rescue Studio desktop installation

## Start without commands

1. Run `RescueStudio-Setup-0.9.0-win64.exe` from the delivered `dist/desktop-*` folder.
2. Open **Rescue Studio** from the Start menu or optional desktop shortcut.
3. Choose **Open existing workspace...** and select
   `C:\Users\Hayden\Documents\clack\autonomous_tracker` to continue the existing footage and labels.
   On a different computer, choose the folder holding your copied workspace instead.
4. Select a video and **Continue labeling**. Training is a separate action.

The installer includes a private Windows x64 CPU Python runtime, Tk, OpenCV, PyTorch, Ultralytics
and their required dependencies. It does not use a global Python installation or the source
project's virtual environment. Runtime installation needs no dependency downloads. Media downloads
and optional upstream version/font requests still require internet; they are separate from setup.
The installer does not include videos, annotations, calibration data, model weights, or hardware
interfaces. A new empty workspace needs trusted local detection weights imported through
**Model library and versions**, and footage imported through **Import video...**.

This is an unsigned development build. Verify its adjacent `SHA256.txt` against the delivered
artifact and use your organization's normal software approval process. Do not disable Windows
security controls to install it. Field performance is not certified by successful software tests.

## Keep application files separate from your work

The default application directory is `%LOCALAPPDATA%\Programs\Rescue Studio`. Workspace selection
is remembered in `%LOCALAPPDATA%\RescueStudio\desktop.json`. **Open another workspace...** is
available from Home. Workspace folders inside the application installation are rejected.

Application updates replace application files, not workspace footage, labels or trained models.
Uninstall removes files installed into the application directory; it does not recursively delete
workspaces. The workspace preference is retained. Back up your workspace and any externally
referenced videos or weights yourself. Newly completed models and newly imported weights have
managed copies. Older manually registered model references still depend on their original files.

Close installed Studio windows and wait for jobs to finish before updating or uninstalling.
Setup intentionally does not terminate unrelated Python processes. The old source-project launcher
and the installed shortcut are different executables; the source launcher still depends on `.venv`.

Version 0.5 adds playback, a project-wide box list, lossless clip export and bulk frame review.
Playback and exported clips are video-only, without audio. Clip source ancestry is saved with labels.
It opens older projects, but
older Studio versions cannot open projects saved with newer history fields, including the
prediction-draft and tracking history saved by 0.9. Keep your backups
and use the updated app for continued editing.

## Workflow map

| Task | Where to go |
| --- | --- |
| Resume existing boxes | Home > Continue labeling or Resume project |
| Correct a model across a whole video | Train model > My models > Analyze entire video and correct boxes |
| Learn from the corrections | Label video > Save and train updated model |
| Watch the current footage and boxes | Annotate footage > Play / Pause and seek slider |
| Find boxes throughout the project | Annotate footage > All boxes |
| Extract footage with its labels | Annotate footage > Cut clip |
| Review six frames or approve a range | Annotate footage > Bulk review |
| Create/edit box names | Annotate footage > tag field or New tag |
| Copy fixed boxes to the next frame | Annotate footage > Copy all boxes to next |
| Follow boxes immediately to the next frame | Annotate footage > Track & next |
| Carry on ordinary Next clicks | Annotate footage > Auto-track on Next |
| Inspect identity or a failed match | Select a box or use Track details |
| Follow one/all boxes across a range | Annotate footage > Track boxes through range |
| Refresh drafts after a correction | Annotate footage > Update following |
| Prioritize frames and resume skips | Editor > 05 Assisted review |
| Suggest a selected box on nearby frames | Assisted review > Preview propagation |
| Export reviewed examples and train | Editor > 04 Export and train |
| Compare the newly trained model | Step 4 > test/compare controls |
| Name/select/revert model versions | Home > Model library and versions |
| Process several videos with recovery | Home > Batch video processing |

See [Label Studio guide](RESCUE_LABEL_STUDIO.md) for review safeguards and training requirements.
Machine proposals and propagated boxes remain drafts until explicitly reviewed. Synthetic smoke
tests prove that the code path runs, not that the resulting detector is useful in a rescue.

## Build and verification for developers

Run from the source workspace's tested Windows x64 Python 3.12 CPU environment:

```powershell
.\.venv\Scripts\python.exe tools\desktop\build_installer.py
```

The default compiler is the locally vendored Inno Setup 6.7.3 `ISCC.exe`; alternatively pass
`--compiler` with a trusted local compiler path. Each build gets a unique `build/desktop-*` bundle
and `dist/desktop-*` installer folder. The builder checks dependency versions, includes package
license files, records file hashes in `package-manifest.json`, and smoke-tests the isolated runtime
before compiling the installer. `--bundle-only` stops after runtime verification.
Deeply nested license files use short packaged names; `third-party-licenses/index.json` maps their
original package paths to the preserved notices. No Windows long-path registry change is needed.

`tools/desktop/verify_runtime_workflow.py --runtime <bundle-or-installed-runtime-folder>` runs real
one-epoch training, two-video batch inference and a validation comparison with synthetic fixtures.
It creates a unique diagnostic workspace and checks that baseline weights were not changed.
It does not promote its synthetic checkpoint into the user's active model library.

The distribution includes third-party software and license notices. Review their redistribution
requirements and model/dataset usage terms separately; the installer manifest is not license
clearance. Runtime isolation follows Python's documented `._pth` configuration, and setup is
built with Inno Setup:

- [Python Windows runtime configuration](https://docs.python.org/3.12/using/windows.html#finding-modules)
- [Official Inno Setup downloads](https://jrsoftware.org/isdl.php)
- [Inno Setup license](https://jrsoftware.org/files/is/license.txt)
