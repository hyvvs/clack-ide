from __future__ import annotations

import tkinter as tk
from collections.abc import Callable
from tkinter import ttk

from tracker.rescue.managed_models import model_available, model_date
from tracker.rescue.model_library import ModelLibrary, ModelVersion


class SavedModelsList(ttk.Frame):
    def __init__(self, parent: tk.Misc, changed: Callable[[], None]) -> None:
        super().__init__(parent)
        self.changed = changed
        self.library: ModelLibrary | None = None
        self.table = ttk.Treeview(
            self,
            columns=("name", "labels", "created", "status"),
            show="headings",
            selectmode="browse",
            height=5,
        )
        for key, title, width in (
            ("name", "Model", 250),
            ("labels", "Recognizes", 230),
            ("created", "Trained / added", 150),
            ("status", "Status", 200),
        ):
            self.table.heading(key, text=title)
            self.table.column(key, width=width, minwidth=80)
        scroll = ttk.Scrollbar(self, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(side="left", fill="both", expand=True)
        self.table.bind("<<TreeviewSelect>>", lambda _: self.changed())

    def selected(self) -> ModelVersion | None:
        rows = self.table.selection()
        if not rows or self.library is None:
            return None
        return self.library.get(rows[0])

    def render(self, library: ModelLibrary, preferred: str = "") -> None:
        old = self.selected()
        selected = preferred or (old.id if old else "")
        self.library = library
        self.table.delete(*self.table.get_children())
        versions = sorted(library.catalog.versions, key=lambda v: v.created_utc, reverse=True)
        for version in versions:
            status = "Not independently tested" if version.training_result else "Imported"
            if not model_available(version):
                status = "Files missing"
            elif version.id == library.catalog.active_id:
                status += " / Default"
            self.table.insert(
                "",
                "end",
                iid=version.id,
                values=(
                    version.name,
                    ", ".join(version.config.review_classes),
                    model_date(version),
                    status,
                ),
            )
        if versions:
            identity = selected if self.table.exists(selected) else versions[0].id
            self.table.selection_set(identity)
            self.table.see(identity)
        self.changed()
