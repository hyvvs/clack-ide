"""Create isolated synthetic fixtures and open the new desktop workflows for visual QA."""

from __future__ import annotations

import argparse
import sys
import tkinter as tk
from pathlib import Path
from uuid import uuid4

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.assisted_review import build_queue
from tracker.rescue.media import FrameReader
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.propagation import propagate_box
from tracker.rescue.studio_home import StudioHome


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["home", "editor", "tracking"], default="editor")
    args = parser.parse_args()
    workspace = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(workspace / "tests"))
    from test_rescue_assisted import moving_project
    from test_rescue_frame_tracking import multi_project

    directory = workspace / "diagnostics" / f"features-qa-{uuid4().hex[:8]}"
    annotations = directory / "annotations"
    annotations.mkdir(parents=True)
    (directory / "configs").mkdir()
    path = multi_project(annotations) if args.mode == "tracking" else moving_project(annotations)
    library = ModelLibrary(directory)
    version = library.register_weights(
        "Existing observation baseline", workspace / "models/rescue-fire-smoke/best.pt"
    )
    library.activate(version.id)
    reader = FrameReader(path.with_suffix(".avi"))
    session = AnnotationSession.open(path, reader.source)
    root = tk.Tk()
    if args.mode in {"editor", "tracking"}:
        app = AnnotationApp(root, reader, session)
        root.title(
            "Rescue Label Studio | " + ("TRACKING QA" if args.mode == "tracking" else "ASSISTED QA")
        )
        app.objects.selection_set(0)
        app.select_object()
        if args.mode == "editor":
            app.assisted_panel.commit_queue(build_queue(session.document))
            app.assisted_panel.jobs.put(propagate_box(session.document, 0, 0, steps=5))
            app.tabs.select(app.assisted_panel)  # type: ignore[no-untyped-call]
    else:
        StudioHome(root, directory)
        root.title("Rescue Studio | FEATURES QA")
    root.mainloop()
    reader.close()


if __name__ == "__main__":
    main()
