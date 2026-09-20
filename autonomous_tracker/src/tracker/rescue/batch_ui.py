from __future__ import annotations

import os
import queue
import threading
import tkinter as tk
from collections.abc import Callable
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from tracker.rescue.batch import BatchPlan, batch_lease, create_batch, read_batch
from tracker.rescue.desktop_jobs import DesktopJob


class BatchWindow(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Tk,
        workspace: Path,
        videos: list[Path],
        config: Callable[[], Path],
        review: Callable[[Path, Path], None],
        refresh: Callable[[], None],
    ) -> None:
        super().__init__(parent)
        self.workspace, self.get_config, self.on_review, self.on_refresh = (
            workspace,
            config,
            review,
            refresh,
        )
        self.videos = list(dict.fromkeys(videos))
        self.path: Path | None = None
        self.plan: BatchPlan | None = None
        self.job: DesktopJob | None = None
        self.preparing = False
        self.events: queue.Queue[Path | Exception] = queue.Queue()
        self.title("Rescue Studio | Batch processing")
        self.geometry("1080x780")
        self.minsize(930, 650)
        body = ttk.Frame(self, padding=16)
        body.pack(fill="both", expand=True)
        self.status = tk.StringVar(
            value="Choose footage, then create a batch. "
            "Each batch pins the current observation model."
        )
        ttk.Label(body, textvariable=self.status, wraplength=890, style="Accent.TLabel").pack(
            side="bottom", fill="x", pady=8
        )
        ttk.Label(body, text="Batch observation jobs", style="Title.TLabel").pack(anchor="w")
        top = ttk.Frame(body)
        top.pack(fill="x", pady=6)
        ttk.Button(top, text="Add videos...", command=self.add).pack(side="left")
        ttk.Button(top, text="Remove selected footage", command=self.remove).pack(
            side="left", padx=6
        )
        ttk.Button(top, text="Create batch from footage...", command=self.create).pack(side="left")
        footage_frame = ttk.Frame(body)
        footage_frame.pack(fill="x")
        self.footage = tk.Listbox(
            footage_frame,
            height=4,
            selectmode="extended",
            background="#1b2938",
            foreground="#e9f0f7",
            exportselection=False,
        )
        footage_scroll = ttk.Scrollbar(footage_frame, orient="vertical", command=self.footage.yview)
        self.footage.configure(yscrollcommand=footage_scroll.set)
        footage_scroll.pack(side="right", fill="y")
        self.footage.pack(side="left", fill="x", expand=True)
        self.show_videos()
        saved = ttk.Frame(body)
        saved.pack(fill="x", pady=8)
        ttk.Label(saved, text="Saved batch:").pack(side="left")
        self.batch_box = ttk.Combobox(saved, state="readonly")
        self.batch_box.pack(side="left", fill="x", expand=True, padx=6)
        self.batch_box.bind("<<ComboboxSelected>>", lambda _: self.open_saved())
        ttk.Button(saved, text="Refresh saved batches", command=self.refresh_saved).pack(
            side="left"
        )
        actions = ttk.Frame(body)
        actions.pack(fill="x")
        for text, command in (
            ("Start / resume / retry unfinished", self.start),
            ("Stop batch", self.stop),
            ("Review selected result", self.review),
            ("Open selected attempt folder", self.open_folder),
        ):
            ttk.Button(actions, text=text, command=command).pack(side="left", padx=(0, 6))
        table_frame = ttk.Frame(body)
        self.table = ttk.Treeview(
            table_frame,
            columns=("video", "status", "progress", "attempts"),
            show="headings",
            height=4,
        )
        for key, title, width in (
            ("video", "Video", 430),
            ("status", "Status", 160),
            ("progress", "Frames processed", 170),
            ("attempts", "Attempts", 90),
        ):
            self.table.heading(key, text=title)
            self.table.column(key, width=width)
        scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(side="left", fill="both", expand=True)
        self.table.bind("<<TreeviewSelect>>", lambda _: self.details())
        self.log = tk.Text(
            body,
            height=8,
            wrap="word",
            background="#1b2938",
            foreground="#e9f0f7",
            state="disabled",
        )
        self.log.pack(side="bottom", fill="x")
        table_frame.pack(fill="both", expand=True, pady=8)
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.refresh_saved()
        self.after_id = self.after(500, self.poll)
        self.bind("<Destroy>", self.cleanup)

    def cleanup(self, event: tk.Event[tk.Misc]) -> None:
        if event.widget is self:
            self.after_cancel(self.after_id)

    @property
    def busy(self) -> bool:
        return self.preparing or self.job is not None

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Batch processing", str(exc), parent=self)

    def show_videos(self) -> None:
        self.footage.delete(0, "end")
        for path in self.videos:
            self.footage.insert("end", str(path))

    def add(self) -> None:
        if self.busy:
            return
        paths = filedialog.askopenfilenames(
            title="Add original videos to the batch",
            filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv *.webm *.m4v *.mpeg *.mpg")],
            parent=self,
        )
        self.videos = list(dict.fromkeys([*self.videos, *(Path(path).resolve() for path in paths)]))
        self.show_videos()

    def remove(self) -> None:
        if not self.busy:
            selected = set(self.footage.curselection())  # type: ignore[no-untyped-call]
            self.videos = [path for index, path in enumerate(self.videos) if index not in selected]
            self.show_videos()

    def create(self) -> None:
        if self.busy or not self.videos:
            return
        if not messagebox.askyesno(
            "Create observation batch",
            f"Prepare {len(self.videos)} videos using the selected observation model? "
            "Identical video copies are deduplicated. No inference starts until you click Start. "
            "Only use media and weights you trust and have permission to use.",
            parent=self,
        ):
            return
        try:
            videos, config = self.videos.copy(), self.get_config()
        except (OSError, ValueError) as exc:
            self.error(exc)
            return
        self.preparing = True
        self.status.set(
            "Checking videos and pinning model checksums. No annotation projects are changed."
        )

        def work() -> None:
            try:
                self.events.put(create_batch(videos, config, self.workspace))
            except Exception as exc:
                self.events.put(exc)

        threading.Thread(target=work, daemon=True).start()

    def refresh_saved(self) -> None:
        paths = sorted(
            (self.workspace / "diagnostics" / "rescue-batches").glob("batch-*/batch.json"),
            reverse=True,
        )
        self.batch_box.configure(values=[str(path) for path in paths])
        if self.path is not None:
            self.batch_box.set(str(self.path))
        elif paths:
            self.batch_box.current(0)
            self.open_saved()

    def open_saved(self) -> None:
        if self.busy:
            if self.path is not None:
                self.batch_box.set(str(self.path))
            return
        if self.batch_box.get():
            try:
                path = Path(self.batch_box.get())
                plan = read_batch(path)
                self.path, self.plan = path, plan
                self.render()
                self.status.set(
                    f"Saved batch: {plan.status}. "
                    "Completed results are kept; unfinished videos can be retried."
                )
            except (OSError, ValueError) as exc:
                self.error(exc)

    def render(self) -> None:
        if self.plan is None:
            return
        selected = self.table.selection()
        self.table.delete(*self.table.get_children())
        for item in self.plan.items:
            self.table.insert(
                "",
                "end",
                iid=item.id,
                values=(
                    Path(item.source.path).name,
                    item.status,
                    f"{item.frames_done}/{item.source.frame_count}",
                    len(item.attempts),
                ),
            )
        if selected and self.table.exists(selected[0]):
            self.table.selection_set(selected[0])

    def start(self) -> None:
        if self.busy or self.path is None:
            return
        try:
            with batch_lease(self.path):
                pass
            if not messagebox.askyesno(
                "Start batch inference",
                "Run all unfinished videos with the batch's saved model snapshot? "
                "Completed, checksum-valid results are skipped. Failed attempts remain on disk. "
                "This may take time on CPU.",
                parent=self,
            ):
                return
            self.job = DesktopJob(
                self.workspace,
                "tracker.cli.rescue_batch",
                ["--batch", str(self.path), "--retry"],
                stoppable=True,
            )
            self.status.set("Batch worker started. You may keep working in the library.")
        except (OSError, ValueError) as exc:
            self.error(exc)

    def stop(self) -> None:
        try:
            if self.job is not None:
                self.job.stop()
                self.status.set(
                    "Stopping after the current inference frame. Completed videos are preserved."
                )
        except OSError as exc:
            self.error(exc)

    def details(self) -> None:
        selected = self.table.selection()
        if not selected or self.plan is None:
            return
        item = next(item for item in self.plan.items if item.id == selected[0])
        lines = [item.source.path, f"Status: {item.status}", item.error]
        for attempt in item.attempts:
            lines.extend([f"{attempt.status}: {attempt.directory}", attempt.error])
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.insert("1.0", "\n".join(lines))
        self.log.configure(state="disabled")

    def review(self) -> None:
        selected = self.table.selection()
        if selected and self.plan is not None:
            item = next(item for item in self.plan.items if item.id == selected[0])
            if item.status == "completed":
                self.on_review(Path(item.source.path), Path(item.run_directory))
            else:
                self.status.set("Choose a completed video to review its draft detections.")

    def open_folder(self) -> None:
        selected = self.table.selection()
        if selected and self.plan is not None and os.name == "nt":
            item = next(item for item in self.plan.items if item.id == selected[0])
            if item.attempts:
                try:
                    os.startfile(item.attempts[-1].directory)
                except OSError as exc:
                    self.error(exc)

    def close(self) -> None:
        if self.busy:
            self.status.set("Stop the batch and wait for it to finish before closing this window.")
        else:
            self.destroy()

    def poll(self) -> None:
        try:
            result = self.events.get_nowait()
        except queue.Empty:
            pass
        else:
            self.preparing = False
            if isinstance(result, Exception):
                self.error(result)
            else:
                self.path = result
                self.refresh_saved()
                self.open_saved()
        if self.job is not None:
            try:
                self.job.read()
                if self.path is not None:
                    self.plan = read_batch(self.path)
                    self.render()
                    count = sum(item.status == "completed" for item in self.plan.items)
                    self.status.set(
                        f"{count}/{len(self.plan.items)} videos complete. "
                        "Select a row for errors and attempt folders."
                    )
                code = self.job.poll()
                if code is not None:
                    log = self.job.log_path
                    self.job = None
                    self.on_refresh()
                    self.status.set(
                        f"Batch ended: {self.plan.status if self.plan else 'unknown'}. "
                        f"Full worker log: {log}"
                    )
                    if code:
                        self.error(ValueError(f"Batch worker failed. Open its log: {log}"))
            except (OSError, ValueError) as exc:
                self.status.set(f"Cannot refresh batch progress: {exc}")
        self.after_id = self.after(500, self.poll)
