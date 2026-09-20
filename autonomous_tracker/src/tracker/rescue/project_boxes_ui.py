from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import TYPE_CHECKING

from tracker.rescue.project_tools import BoxOccurrence, box_occurrences, timestamp

if TYPE_CHECKING:
    from tracker.rescue.annotation_ui import AnnotationApp


class ProjectBoxesWindow(tk.Toplevel):
    PAGE_SIZE = 200

    def __init__(self, app: AnnotationApp) -> None:
        super().__init__(app.root)
        self.app = app
        self.title("All boxes in this project")
        self.geometry("1020x620")
        self.minsize(800, 450)
        self.snapshot = app.session.document
        self.rows: list[BoxOccurrence] = []
        self.page = 0
        self.query = tk.StringVar()
        self.state_filter = tk.StringVar(value="All")
        self.summary = tk.StringVar()
        shell = ttk.Frame(self, padding=16)
        shell.pack(fill="both", expand=True)
        ttk.Label(
            shell,
            text="Every box occurrence across the video, including unsaved edits. "
            "Double-click a row to edit its frame.",
            wraplength=950,
        ).pack(anchor="w", pady=(0, 12))
        filters = ttk.Frame(shell)
        filters.pack(fill="x")
        ttk.Label(filters, text="Search tag / ID / frame").pack(side="left")
        entry = ttk.Entry(filters, textvariable=self.query, width=30)
        entry.pack(side="left", padx=6)
        entry.bind("<Return>", lambda _: self.reload())
        ttk.Combobox(
            filters,
            textvariable=self.state_filter,
            values=["All", "Draft", "Reviewed", "Needs attention"],
            state="readonly",
            width=17,
        ).pack(side="left")
        ttk.Button(filters, text="Search / refresh", command=self.reload).pack(side="left", padx=6)
        ttk.Label(shell, textvariable=self.summary, wraplength=950).pack(fill="x", pady=10)
        table_frame = ttk.Frame(shell)
        table_frame.pack(fill="both", expand=True)
        columns = ("Frame", "Time", "Tag", "Object ID", "State", "Coordinates")
        self.table = ttk.Treeview(
            table_frame, columns=columns, show="headings", selectmode="browse"
        )
        for name, width in zip(columns, (60, 110, 140, 130, 130, 230), strict=True):
            self.table.heading(name, text=name)
            self.table.column(name, width=width, minwidth=50)
        scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(fill="both", expand=True)
        self.table.bind("<Double-1>", lambda _: self.open_selected())
        bottom = ttk.Frame(shell)
        bottom.pack(fill="x", pady=(10, 0))
        ttk.Button(bottom, text="Previous page", command=lambda: self.change_page(-1)).pack(
            side="left"
        )
        ttk.Button(bottom, text="Next page", command=lambda: self.change_page(1)).pack(
            side="left", padx=6
        )
        ttk.Button(bottom, text="Open selected box", command=self.open_selected).pack(side="right")
        self.reload()

    def reload(self) -> None:
        self.snapshot = self.app.session.document.model_copy(deep=True)
        self.rows = box_occurrences(self.snapshot, self.query.get(), self.state_filter.get())
        self.page = 0
        self.render()

    def change_page(self, delta: int) -> None:
        self.page = max(0, min((len(self.rows) - 1) // self.PAGE_SIZE, self.page + delta))
        self.render()

    def render(self) -> None:
        self.table.delete(*self.table.get_children())
        start = self.page * self.PAGE_SIZE
        for number, row in enumerate(self.rows[start : start + self.PAGE_SIZE], start):
            self.table.insert(
                "",
                "end",
                iid=str(number),
                values=(
                    row.frame_index,
                    timestamp(row.frame_index, self.snapshot.source.nominal_fps),
                    row.label,
                    row.identity,
                    row.state,
                    ", ".join(f"{value:.1f}" for value in row.coordinates),
                ),
            )
        pages = max(1, (len(self.rows) + self.PAGE_SIZE - 1) // self.PAGE_SIZE)
        self.summary.set(
            f"{len(self.rows)} matching box occurrences across "
            f"{len({row.frame_index for row in self.rows})} frames. "
            f"Page {self.page + 1}/{pages}. "
            "Repeated IDs can appear once per frame; this is not a unique-object count."
        )

    def open_selected(self) -> None:
        if self.snapshot != self.app.session.document:
            self.reload()
            self.summary.set("Labels changed. List refreshed; select the box again.")
            return
        selection = self.table.selection()
        if not selection:
            return
        row = self.rows[int(selection[0])]
        self.app.go(row.frame_index)
        if self.app.index == row.frame_index:
            self.app.objects.selection_set(row.object_index)
            self.app.objects.see(row.object_index)
            self.app.select_object()
