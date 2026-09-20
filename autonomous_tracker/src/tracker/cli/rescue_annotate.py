"""Open the local rescue annotation and evaluation desktop interface."""

from __future__ import annotations

import argparse
import tkinter as tk
from contextlib import suppress
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog

import cv2

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.media import FrameReader


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path)
    parser.add_argument("--project", type=Path, help="annotation project to create or resume")
    parser.add_argument("--training", action="store_true", help="open the guided training tab")
    parser.add_argument(
        "--training-result", type=Path, help="open a completed model's test controls"
    )
    parser.add_argument("--training-project", type=Path, action="append", default=[])
    parser.add_argument(
        "--classes", help="comma-separated exhaustive class scope for a new project"
    )
    parser.add_argument("--run", type=Path, help="saved observation run to evaluate after opening")
    parser.add_argument(
        "--suggestions", type=Path, help="saved recognition run to import as editable drafts"
    )
    args = parser.parse_args()
    reader = None
    root = None
    try:
        root = tk.Tk()
        root.withdraw()
        if args.video is None:
            video = filedialog.askopenfilename(
                title="Step 1: choose the original video (not the box-overlay output)",
                filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv"), ("All files", "*.*")],
                parent=root,
            )
            if not video:
                return
            args.video = Path(video)
        if args.project is None:
            project = filedialog.asksaveasfilename(
                title="Step 2: choose an existing annotation JSON to resume, or a new filename",
                defaultextension=".json",
                filetypes=[("Annotation project", "*.json")],
                confirmoverwrite=False,
                initialfile=args.video.stem + ".annotations.json",
                parent=root,
            )
            if not project:
                return
            args.project = Path(project)
            if not args.project.exists() and args.classes is None:
                args.classes = simpledialog.askstring(
                    "Step 3: rescue classes",
                    "Comma-separated classes to label exhaustively. Start with a small scope, "
                    "for example fire,smoke. Adding classes later resets review status.",
                    initialvalue="fire,smoke",
                    parent=root,
                )
                if args.classes is None:
                    return
        reader = FrameReader(args.video)
        classes = (
            None
            if args.classes is None
            else [label.strip().casefold() for label in args.classes.split(",")]
        )
        session = AnnotationSession.open(args.project, reader.source, classes)
        app = AnnotationApp(root, reader, session)
        root.deiconify()
        if not app.training_panel.saved_state.projects:
            app.training_panel.paths = list(
                dict.fromkeys(
                    [session.path.resolve(), *(path.resolve() for path in args.training_project)]
                )
            )
        default_weights = Path("models/rescue-fire-smoke/best.pt")
        if default_weights.is_file() and not app.training_panel.weights.get():
            app.training_panel.weights.set(str(default_weights.resolve()))
        if args.training:
            app.tabs.select(app.training_panel)  # type: ignore[no-untyped-call]
        if args.training_result is not None:
            app.training_panel.check_panel.set_training(args.training_result)
            app.training_panel.check_panel.project.set(str(session.path.resolve()))
            root.after(200, app.training_panel.show_checks)
        if args.suggestions is not None:
            root.after(100, lambda: app.import_suggestions(args.suggestions))
        if args.run is not None:

            def evaluate_initial_run() -> None:
                app.tabs.select(1)  # type: ignore[no-untyped-call]
                app.evaluate(args.run)

            root.after(100, evaluate_initial_run)
        root.mainloop()
    except (OSError, ValueError, RuntimeError, tk.TclError, cv2.error) as exc:
        if root is not None:
            with suppress(tk.TclError):
                messagebox.showerror("Cannot open project", str(exc), parent=root)
        parser.error(str(exc))
    finally:
        if reader is not None:
            reader.close()
        if root is not None:
            with suppress(tk.TclError):
                root.destroy()


if __name__ == "__main__":
    main()
