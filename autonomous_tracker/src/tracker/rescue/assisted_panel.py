from __future__ import annotations

import queue
import threading
import tkinter as tk
from collections.abc import Callable
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import TYPE_CHECKING

import cv2

from tracker.rescue.assisted_review import (
    AssistedQueue,
    build_queue,
    candidate_status,
    load_queue,
    next_candidate,
    queue_path,
    skip_candidate,
)
from tracker.rescue.media import FrameReader
from tracker.rescue.propagation import PropagationResult, merge_propagation, propagate_box
from tracker.rescue.scrollable import ScrollablePanel
from tracker.rescue.state_store import StateStore, WorkCancelled

if TYPE_CHECKING:
    from tracker.rescue.annotation_ui import AnnotationApp


class AssistedPanel(ttk.Frame):
    def __init__(self, parent: ttk.Notebook, app: AnnotationApp) -> None:
        super().__init__(parent, padding=12)
        self.app = app
        self.store = StateStore(queue_path(app.session.path))
        self.review_queue: AssistedQueue | None = None
        self.result: PropagationResult | None = None
        self.jobs: queue.Queue[AssistedQueue | PropagationResult | Exception] = queue.Queue()
        self.cancel_event = threading.Event()
        self.busy = False
        self.follow_queue = False
        self.photo: tk.PhotoImage | None = None
        self.run = tk.StringVar()
        self.limit = tk.StringVar(value="150")
        self.steps = tk.StringVar(value="15")
        self.direction = tk.StringVar(value="Forward")
        self.append_drafts = tk.BooleanVar(value=False)
        self.status = tk.StringVar(
            value="Suggested frames are triage hints, not reviewed labels or accuracy scores."
        )
        self.progress: queue.Queue[str] = queue.Queue()
        self.seed_hint = tk.StringVar()
        scroller = ScrollablePanel(self)
        scroller.pack(fill="both", expand=True)
        body = scroller.body
        ttk.Label(body, text="Suggested frames to review", style="Accent.TLabel").pack(anchor="w")
        ttk.Label(
            body,
            text="Mixes detection warnings, sampled scene changes and coverage samples. "
            "Confidence is not calibrated accuracy. Existing reviewed frames are excluded.",
            wraplength=950,
        ).pack(anchor="w", pady=6)
        bar = ttk.Frame(body)
        bar.pack(fill="x")
        ttk.Button(bar, text="Choose recognition run...", command=self.choose_run).pack(side="left")
        ttk.Entry(bar, textvariable=self.run, state="readonly").pack(
            side="left", fill="x", expand=True, padx=6
        )
        ttk.Button(bar, text="Without predictions", command=lambda: self.run.set("")).pack(
            side="left"
        )
        actions = ttk.Frame(body)
        actions.pack(fill="x", pady=6)
        ttk.Label(actions, text="Maximum frames").pack(side="left")
        ttk.Entry(actions, textvariable=self.limit, width=6).pack(side="left", padx=6)
        ttk.Button(actions, text="Build suggested queue", command=self.build).pack(side="left")
        ttk.Button(actions, text="Reload saved queue", command=self.reload).pack(
            side="left", padx=6
        )
        ttk.Button(actions, text="Cancel background work", command=self.cancel_event.set).pack(
            side="left"
        )
        table_frame = ttk.Frame(body)
        table_frame.pack(fill="x", pady=6)
        self.table = ttk.Treeview(
            table_frame, columns=("frame", "status", "reason"), show="headings", height=6
        )
        for key, title, width in (
            ("frame", "Frame", 80),
            ("status", "Progress", 110),
            ("reason", "Why review this frame", 700),
        ):
            self.table.heading(key, text=title)
            self.table.column(key, width=width)
        scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(side="left", fill="x", expand=True)
        self.table.bind("<Double-1>", lambda _: self.open_selected())
        actions = ttk.Frame(body)
        actions.pack(fill="x")
        for text, command in (
            ("Open next suggested", self.open_next),
            ("Open selected frame", self.open_selected),
            ("Skip current suggestion", self.skip),
            ("Undo skip", self.undo_skip),
            ("Exit queue navigation", self.exit_queue),
        ):
            ttk.Button(actions, text=text, command=command).pack(side="left", padx=(0, 6))
        ttk.Label(
            body,
            text="Skipping does not mark a frame reviewed. Progress is saved automatically. "
            "In the editor, Review and next follows this queue until you exit it.",
            wraplength=950,
            style="Muted.TLabel",
        ).pack(anchor="w", pady=6)
        ttk.Separator(body).pack(fill="x", pady=10)
        ttk.Label(
            body, text="Suggest a selected box across nearby frames", style="Accent.TLabel"
        ).pack(anchor="w")
        ttk.Label(body, textvariable=self.seed_hint, wraplength=950).pack(anchor="w", pady=6)
        options = ttk.Frame(body)
        options.pack(fill="x")
        ttk.Label(options, text="Frames (1-60)").pack(side="left")
        ttk.Entry(options, textvariable=self.steps, width=6).pack(side="left", padx=6)
        ttk.Combobox(
            options,
            textvariable=self.direction,
            values=["Forward", "Backward"],
            state="readonly",
            width=10,
        ).pack(side="left")
        ttk.Button(options, text="Preview propagation", command=self.start_propagation).pack(
            side="left", padx=6
        )
        ttk.Checkbutton(
            options,
            text="Add to existing draft frames (no replacement)",
            variable=self.append_drafts,
        ).pack(side="left")
        self.proposal_box = ttk.Combobox(body, state="readonly")
        self.proposal_box.pack(fill="x", pady=6)
        self.proposal_box.bind("<<ComboboxSelected>>", lambda _: self.preview())
        self.preview_canvas = tk.Canvas(
            body, width=680, height=270, background="#080e15", highlightthickness=0
        )
        self.preview_canvas.pack(fill="x")
        ttk.Button(body, text="Add previewed suggestions as drafts...", command=self.apply).pack(
            anchor="w", pady=6
        )
        ttk.Label(
            body,
            text="Motion estimates stop when support is weak. "
            "Reviewed frames and overlapping boxes are protected. "
            "Added boxes are never automatically reviewed; one Undo restores the entire edit.",
            wraplength=950,
            style="Muted.TLabel",
        ).pack(anchor="w")
        ttk.Label(self, textvariable=self.status, wraplength=980, style="Accent.TLabel").pack(
            side="bottom", fill="x", pady=8
        )
        self.reload()
        self.after(150, self.poll)

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Assisted review", str(exc), parent=self)

    def reload(self) -> None:
        if self.busy:
            return
        try:
            self.review_queue = load_queue(self.store, self.app.session.document)
            if self.review_queue is not None:
                self.run.set(self.review_queue.run_directory)
                self.status.set(
                    "Saved suggested queue restored. "
                    "Reviewed status comes from your current labels."
                )
            self.render()
        except (OSError, ValueError) as exc:
            self.review_queue = None
            self.status.set(str(exc))

    def render(self) -> None:
        self.table.delete(*self.table.get_children())
        if self.review_queue is not None:
            for item in self.review_queue.candidates:
                self.table.insert(
                    "",
                    "end",
                    iid=str(item.frame_index),
                    values=(
                        item.frame_index,
                        candidate_status(
                            self.review_queue, self.app.session.document, item.frame_index
                        ),
                        "; ".join(item.reasons),
                    ),
                )
            cursor = self.review_queue.bookmark.cursor
            if cursor is not None:
                self.table.selection_set(str(cursor))
                self.table.see(str(cursor))
        selected = self.app.selected
        frame = self.app.session.frame(self.app.index)
        self.seed_hint.set(
            f"Selected seed: frame {self.app.index}, {frame.objects[selected].label}."
            if selected is not None and selected < len(frame.objects)
            else "First select a corrected box in Annotate footage, then return here."
        )

    def choose_run(self) -> None:
        if not self.busy:
            name = filedialog.askdirectory(
                title="Recognition run containing frames.jsonl and summary.json", parent=self
            )
            if name:
                self.run.set(name)

    def start_work(self, operation: Callable[[], AssistedQueue | PropagationResult]) -> None:
        if self.busy:
            return
        self.busy = True
        self.cancel_event.clear()
        self.status.set("Working in the background. You can cancel without changing labels.")

        def work() -> None:
            try:
                self.jobs.put(operation())
            except Exception as exc:
                self.jobs.put(exc)

        threading.Thread(target=work, daemon=True).start()

    def check_stop(self) -> None:
        if self.cancel_event.is_set():
            raise WorkCancelled("Cancelled. Existing labels and saved queue were preserved.")

    def build(self) -> None:
        if self.busy or not self.app.save():
            return
        try:
            limit = int(self.limit.get())
            if self.review_queue is not None and not messagebox.askyesno(
                "Replace suggested queue?",
                "Rebuild the suggested queue and reset its skipped-frame list? "
                "Labels are not changed.",
                parent=self,
            ):
                return
            snapshot = self.app.session.document.model_copy(deep=True)
            run = Path(self.run.get()) if self.run.get() else None
            self.start_work(
                lambda: build_queue(
                    snapshot,
                    run,
                    limit=limit,
                    check_stop=self.check_stop,
                    progress=self.progress.put,
                )
            )
        except ValueError as exc:
            self.error(exc)

    def commit_queue(self, updated: AssistedQueue) -> None:
        self.store.save(updated)
        self.review_queue = updated
        self.render()

    def open_index(self, index: int) -> bool:
        if self.review_queue is None:
            return False
        try:
            if set(self.review_queue.classes) != set(self.app.session.document.classes):
                raise ValueError("Tags changed. Build a new queue before continuing.")
            updated = self.review_queue.model_copy(deep=True)
            updated.bookmark.cursor = index
            self.commit_queue(updated)
            self.follow_queue = True
            self.app.tabs.select(0)  # type: ignore[no-untyped-call]
            self.app.go(index)
            self.app.status.set(
                "Suggested review frame. Review and next follows this queue; "
                "skip leaves labels unchanged."
            )
            return True
        except (OSError, ValueError) as exc:
            self.error(exc)
            return False

    def open_next(self) -> bool:
        if self.review_queue is None:
            self.app.tabs.select(self)  # type: ignore[no-untyped-call]
            self.status.set("Build a suggested queue first. A recognition run is optional.")
            return False
        index = next_candidate(self.review_queue, self.app.session.document)
        if index is None:
            self.status.set(
                "Queue finished: all suggested frames are reviewed or skipped. "
                "This does not mean the full video is reviewed."
            )
            self.app.status.set(self.status.get())
            self.follow_queue = False
            self.render()
            return False
        return self.open_index(index)

    def open_selected(self) -> None:
        selected = self.table.selection()
        if selected:
            self.open_index(int(selected[0]))

    def skip(self) -> None:
        if self.review_queue is None or not self.follow_queue:
            self.status.set("Open a suggested frame before skipping it.")
            return
        try:
            self.commit_queue(
                skip_candidate(self.review_queue, self.app.session.document, self.app.index)
            )
            self.open_next()
        except (OSError, ValueError) as exc:
            self.error(exc)

    def undo_skip(self) -> None:
        if self.review_queue is not None and self.review_queue.undo:
            updated = self.review_queue.model_copy(deep=True)
            updated.bookmark = updated.undo.pop()
            try:
                self.commit_queue(updated)
            except (OSError, ValueError) as exc:
                self.error(exc)

    def exit_queue(self) -> None:
        self.follow_queue = False
        self.status.set("Queue navigation off. Review and next uses normal frame order.")

    def start_propagation(self) -> None:
        if self.busy:
            return
        try:
            if self.app.selected is None:
                raise ValueError("Select a corrected box in Annotate footage first.")
            steps = int(self.steps.get())
            index, selected = self.app.index, self.app.selected
            snapshot = self.app.session.document.model_copy(deep=True)
            direction = 1 if self.direction.get() == "Forward" else -1
            self.result = None
            self.proposal_box.configure(values=[])
            self.preview_canvas.delete("all")
            self.start_work(
                lambda: propagate_box(
                    snapshot,
                    index,
                    selected,
                    steps=steps,
                    direction=direction,
                    check_stop=self.check_stop,
                )
            )
        except ValueError as exc:
            self.error(exc)

    def preview(self) -> None:
        if self.result is None or self.proposal_box.current() < 0:
            return
        reader = None
        try:
            proposal = self.result.proposals[self.proposal_box.current()]
            reader = FrameReader(Path(self.app.session.document.source.path))
            if reader.source.sha256 != self.result.source_sha256:
                raise ValueError("Source changed since propagation.")
            image = reader.read(proposal.frame_index)
            x1, y1, x2, y2 = map(round, proposal.box.bbox_xyxy)
            cv2.rectangle(image, (x1, y1), (x2, y2), (100, 230, 170), 2)
            scale = min(680 / image.shape[1], 270 / image.shape[0])
            resized = cv2.resize(
                image, (round(image.shape[1] * scale), round(image.shape[0] * scale))
            )
            ok, encoded = cv2.imencode(".png", resized)
            if not ok:
                raise ValueError("Could not render propagation preview.")
            self.photo = tk.PhotoImage(data=encoded.tobytes())
            self.preview_canvas.delete("all")
            self.preview_canvas.create_image(0, 0, image=self.photo, anchor="nw")
        except (OSError, ValueError, cv2.error) as exc:
            self.error(exc)
        finally:
            if reader is not None:
                reader.close()

    def apply(self) -> None:
        if self.result is None or self.busy:
            return
        try:
            updated, added, protected = merge_propagation(
                self.app.session.document, self.result, append_drafts=self.append_drafts.get()
            )
            if not added:
                self.status.set(
                    f"No boxes added. {len(protected)} frames protected. "
                    "Existing drafts require the explicit add-to-drafts option."
                )
                return
            if messagebox.askyesno(
                "Add draft suggestions?",
                f"Add {len(added)} suggested boxes as unreviewed drafts? "
                f"{len(protected)} frames are protected. No existing box will be replaced. "
                "Undo restores this whole edit.",
                parent=self,
            ):
                self.app.session.replace_document(updated)
                self.app.refresh()
                self.render()
                self.status.set(
                    f"Added {len(added)} draft boxes. Review each one and save the project. "
                    "One Undo restores all of them."
                )
                self.result = None
        except (ValueError, OSError) as exc:
            self.error(exc)

    def poll(self) -> None:
        try:
            while True:
                self.status.set(self.progress.get_nowait())
        except queue.Empty:
            pass
        try:
            result = self.jobs.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            if isinstance(result, WorkCancelled) or self.cancel_event.is_set():
                self.status.set("Cancelled. Existing labels and queue preserved.")
            elif isinstance(result, Exception):
                self.error(result)
            else:
                try:
                    if isinstance(result, AssistedQueue):
                        if set(result.classes) != set(self.app.session.document.classes):
                            raise ValueError("Tags changed during sampling. Rebuild the queue.")
                        self.commit_queue(result)
                        self.status.set(
                            f"Saved {len(result.candidates)} suggested frames. "
                            "Open next to start reviewing."
                        )
                    else:
                        self.result = result
                        self.proposal_box.configure(
                            values=[
                                f"Frame {item.frame_index}: {item.box.label} | "
                                f"motion support {item.support:.0%} (not accuracy)"
                                for item in result.proposals
                            ]
                        )
                        if result.proposals:
                            self.proposal_box.current(0)
                            self.preview()
                        self.status.set(
                            f"{len(result.proposals)} draft suggestions. {result.stop_reason}"
                        )
                except (ValueError, OSError) as exc:
                    self.error(exc)
        self.after(150, self.poll)
