from __future__ import annotations

import queue
import threading
import tkinter as tk
from collections.abc import Callable
from functools import partial
from pathlib import Path
from tkinter import filedialog, ttk
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.rescue.dataset_audit import audit_projects, save_audit
from tracker.rescue.error_review import review_queue


class ErrorReviewPanel(ttk.Frame):
    def __init__(
        self,
        master: ttk.Notebook,
        inspect_frame: Callable[[dict[str, Any], dict[str, Any]], None],
    ) -> None:
        super().__init__(master, padding=8)
        self.inspect_frame = inspect_frame
        self.result: dict[str, Any] | None = None
        self.rows: dict[str, dict[str, Any]] = {}
        self.errors_only = tk.BooleanVar(value=True)
        self.description = tk.StringVar(value="Select a saved evaluation run above.")
        toolbar = ttk.Frame(self)
        toolbar.pack(fill="x", pady=(0, 8))
        ttk.Checkbutton(
            toolbar,
            text="Errors and missing predictions only",
            variable=self.errors_only,
            command=self.populate,
        ).pack(side="left")
        ttk.Button(toolbar, text="Inspect selected frame", command=self.inspect_selected).pack(
            side="right"
        )
        ttk.Label(self, textvariable=self.description, wraplength=1100).pack(
            anchor="w", pady=(0, 8)
        )
        columns = ["Frame", "TP", "FP", "FN", "ID changes", "Prediction status"]
        self.table = ttk.Treeview(
            self, columns=columns, show="headings", selectmode="browse", height=6
        )
        for column in columns:
            self.table.heading(column, text=column)
            self.table.column(column, width=140, minwidth=60)
        scroll = ttk.Scrollbar(self, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(fill="both", expand=True)
        self.table.bind("<Double-1>", lambda _: self.inspect_selected())
        self.table.bind("<Return>", lambda _: self.inspect_selected())

    def set_result(self, result: dict[str, Any]) -> None:
        if self.result is result:
            return
        self.result = result
        self.populate()

    def populate(self) -> None:
        for tree_row in self.table.get_children():
            self.table.delete(tree_row)
        self.rows.clear()
        if self.result is None:
            return
        for row in review_queue(self.result, self.errors_only.get()):
            values = [
                row.get(key)
                for key in [
                    "frame_index",
                    "true_positives",
                    "false_positives",
                    "false_negatives",
                    "identity_switches",
                    "prediction_status",
                ]
            ]
            key = self.table.insert("", "end", values=["N/A" if v is None else v for v in values])
            self.rows[key] = row
        self.description.set(
            f"{len(self.rows)} frames in this view. Counts use the saved label snapshot. "
            "Missing predictions are coverage gaps, not model misses."
        )

    def inspect_selected(self) -> None:
        selected = self.table.selection()
        if selected and self.result is not None:
            self.inspect_frame(self.result, self.rows[selected[0]])


class InspectionWindow:
    def __init__(
        self,
        root: tk.Tk,
        image: NDArray[np.uint8],
        result: dict[str, Any],
        frame: dict[str, Any],
        current_labels_match: bool,
        edit_frame: Callable[[], None],
    ) -> None:
        self.window = tk.Toplevel(root)
        self.window.title(f"Frame {frame['frame_index']} / scored evidence")
        self.window.geometry("1180x660")
        self.window.minsize(850, 550)
        self.window.configure(bg="#101923")
        self.image = image
        self.frame = frame
        self.photos: dict[str, tk.PhotoImage] = {}
        shell = ttk.Frame(self.window, padding=14)
        shell.pack(fill="both", expand=True)
        toolbar = ttk.Frame(shell)
        toolbar.pack(fill="x", pady=(0, 8))
        text = (
            f"Frame {frame['frame_index']} | IoU {result['evaluation']['iou_threshold']} | "
            f"{'CURRENT labels' if current_labels_match else 'OLDER label snapshot'}"
        )
        ttk.Label(toolbar, text=text, style="Accent.TLabel").pack(side="left")
        ttk.Button(toolbar, text="Edit this frame's labels", command=edit_frame).pack(side="right")
        has_details = "truth_objects" in frame and "predictions" in frame
        note = (
            "Green = matched. Red = missed truth. Pink = unmatched prediction. "
            "Predictions are model outputs, not annotation suggestions."
        )
        if frame["prediction_status"] == "missing":
            note = (
                "No predictions were saved for this frame. No TP / FP / FN conclusion is available."
            )
        elif not has_details:
            note = "Older result without box snapshots. Re-evaluate the saved run to inspect boxes."
        ttk.Label(shell, text=note, wraplength=1100).pack(anchor="w", pady=(0, 8))
        content = ttk.Frame(shell)
        content.pack(fill="both", expand=True)
        for column, title, key in (
            (0, "Human labels / scored snapshot", "truth_objects"),
            (1, "Model detections / scored snapshot", "predictions"),
        ):
            panel = ttk.Frame(content)
            panel.grid(row=0, column=column, sticky="nsew", padx=(0, 6) if column == 0 else (6, 0))
            content.columnconfigure(column, weight=1, uniform="paired")
            ttk.Label(panel, text=title, style="Accent.TLabel").pack(anchor="w", pady=(0, 6))
            canvas = tk.Canvas(panel, bg="#080e15", highlightthickness=0)
            canvas.pack(fill="both", expand=True)
            canvas.bind("<Configure>", partial(self.resize, key))
        content.rowconfigure(0, weight=1)
        changes = frame.get("identity_changes", [])
        change_text = "; ".join(
            f"{c['object_id']}: {c['previous']} -> {c['current']}" for c in changes
        )
        ttk.Label(
            shell, text=f"ID changes: {change_text or 'none recorded'}", wraplength=1100
        ).pack(anchor="w", pady=(8, 0))

    def resize(self, key: str, event: tk.Event[tk.Canvas]) -> None:
        self.draw(event.widget, key)

    def draw(self, canvas: tk.Canvas, key: str) -> None:
        height, width = self.image.shape[:2]
        available_w, available_h = max(1, canvas.winfo_width()), max(1, canvas.winfo_height())
        scale = min(available_w / width, available_h / height)
        display_w, display_h = max(1, round(width * scale)), max(1, round(height * scale))
        ox, oy = (available_w - display_w) / 2, (available_h - display_h) / 2
        ok, encoded = cv2.imencode(".ppm", cv2.resize(self.image, (display_w, display_h)))
        if not ok:
            return
        self.photos[key] = tk.PhotoImage(master=self.window, data=encoded.tobytes(), format="PPM")
        canvas.delete("all")
        canvas.create_image(ox, oy, anchor="nw", image=self.photos[key])
        match_key = "truth_index" if key == "truth_objects" else "prediction_index"
        matched = {match[match_key]: match for match in self.frame.get("matches", [])}
        for index, obj in enumerate(self.frame.get(key, [])):
            x1, y1, x2, y2 = obj["bbox_xyxy"]
            color = (
                "#70dfba"
                if index in matched
                else "#ff917e"
                if key == "truth_objects"
                else "#ffa1eb"
            )
            missing = self.frame["prediction_status"] == "missing"
            if missing:
                color = "#bac6d2"
            canvas.create_rectangle(
                ox + x1 * scale,
                oy + y1 * scale,
                ox + x2 * scale,
                oy + y2 * scale,
                outline=color,
                width=2,
            )
            identity = (
                obj.get("object_id")
                if key == "truth_objects"
                else (
                    f"{obj['model']}:{obj['tracker_id']}"
                    if obj.get("tracker_id") is not None
                    else None
                )
            )
            score = "" if key == "truth_objects" else f" {obj['confidence']:.2f}"
            suffix = f" IoU {matched[index]['iou']:.2f}" if index in matched else " UNMATCHED"
            if missing:
                suffix = " NOT SCORED"
            caption = (
                f"{obj['label']}{score} ID:{identity if identity is not None else '-'}{suffix}"
            )
            label = canvas.create_text(
                ox + x1 * scale + 3,
                oy + y1 * scale + 3,
                anchor="nw",
                text=caption,
                fill=color,
                font=("Segoe UI", 9, "bold"),
            )
            bounds = canvas.bbox(label)
            if bounds:
                background = canvas.create_rectangle(*bounds, fill="#101923", outline="")
                canvas.tag_lower(background, label)


class DatasetAuditPanel(ttk.Frame):
    def __init__(
        self,
        master: ttk.Notebook,
        output: Path,
        save_current: Callable[[], bool],
        initial_project: Path,
    ) -> None:
        super().__init__(master, padding=12)
        self.output = output
        self.save_current = save_current
        self.paths = [initial_project]
        self.busy = False
        self.jobs: queue.Queue[tuple[dict[str, Any] | None, str]] = queue.Queue()
        self.status = tk.StringVar(
            value="Select the current project files, not backups or exports."
        )
        toolbar = ttk.Frame(self)
        toolbar.pack(fill="x", pady=(0, 8))
        ttk.Button(toolbar, text="Select annotation projects", command=self.choose).pack(
            side="left"
        )
        self.audit_button = ttk.Button(toolbar, text="Check dataset splits", command=self.audit)
        self.audit_button.pack(side="left", padx=8)
        ttk.Label(self, textvariable=self.status, wraplength=1120).pack(anchor="w", pady=(0, 8))
        self.selection_text = tk.Text(
            self, height=3, bg="#1b2938", fg="#e9f0f7", wrap="word", relief="flat"
        )
        self.selection_text.pack(fill="x", pady=(0, 10))
        self.selection_text.insert("1.0", str(initial_project.resolve()))
        self.selection_text.configure(state="disabled")
        self.report = tk.Text(
            self,
            height=12,
            bg="#1b2938",
            fg="#e9f0f7",
            wrap="word",
            relief="flat",
            font=("Segoe UI", 10),
            padx=10,
            pady=10,
        )
        self.report.pack(fill="both", expand=True)
        self._report(
            "Checks exact video hashes and normalized incident tags across training, validation "
            "and test splits. Transcoded copies and incorrect incident tags can evade these "
            "checks. A clear result is not proof of independence or rescue readiness."
        )
        self.after(150, self.poll)

    def choose(self) -> None:
        if self.busy:
            return
        selected = filedialog.askopenfilenames(
            parent=self,
            title="Select annotation project JSON files",
            filetypes=[("Annotation JSON", "*.json")],
        )
        if selected:
            self.paths = [Path(path) for path in selected]
            self.selection_text.configure(state="normal")
            self.selection_text.delete("1.0", "end")
            self.selection_text.insert("1.0", "\n".join(str(path) for path in self.paths))
            self.selection_text.configure(state="disabled")
            self.status.set(
                f"{len(self.paths)} project files selected. Results are not yet updated."
            )

    def _report(self, text: str) -> None:
        self.report.configure(state="normal")
        self.report.delete("1.0", "end")
        self.report.insert("1.0", text)
        self.report.configure(state="disabled")

    def audit(self) -> None:
        if self.busy or not self.save_current():
            return
        if not self.paths:
            self.status.set("Select at least one annotation project first.")
            return
        paths = list(self.paths)
        self.busy = True
        self.audit_button.configure(state="disabled")
        self.status.set("Checking saved annotation projects...")

        def work() -> None:
            try:
                result = audit_projects(paths)
                path = save_audit(self.output, result)
                self.jobs.put((result, str(path.resolve())))
            except Exception as exc:
                self.jobs.put((None, str(exc)))

        threading.Thread(target=work, daemon=True).start()

    def poll(self) -> None:
        try:
            result, path = self.jobs.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            self.audit_button.configure(state="normal")
            if result is None:
                self.status.set(f"Dataset check failed: {path}")
            else:
                lines = [
                    f"{result['status'].upper()} | {result['projects_checked']} valid projects",
                    f"{result['unique_video_hashes']} distinct recorded video hashes",
                    "",
                ]
                for issue in result["issues"]:
                    lines.extend(
                        [
                            f"{issue['severity'].upper()} / {issue['code']}",
                            issue["message"],
                            *issue["projects"],
                            "",
                        ]
                    )
                lines.extend(result["limitations"])
                self._report("\n".join(lines))
                self.status.set(f"Saved dataset check: {path}")
        self.after(150, self.poll)
