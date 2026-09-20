from __future__ import annotations

import tkinter as tk
from contextlib import suppress
from tkinter import ttk


class ScrollablePanel(ttk.Frame):
    def __init__(self, parent: tk.Misc, width: int = 280) -> None:
        super().__init__(parent)
        self.canvas = tk.Canvas(self, width=width, highlightthickness=0, background="#101923")
        scroll = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.body = ttk.Frame(self.canvas)
        item = self.canvas.create_window(0, 0, anchor="nw", window=self.body)
        self.body.bind(
            "<Configure>", lambda _: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
        self.canvas.bind(
            "<Configure>", lambda event: self.canvas.itemconfigure(item, width=event.width)
        )
        top = self.winfo_toplevel()
        binding = top.bind("<MouseWheel>", self.wheel, add="+")

        def cleanup(event: tk.Event[tk.Misc]) -> None:
            if event.widget is self:
                with suppress(tk.TclError):
                    top.unbind("<MouseWheel>", binding)

        self.bind("<Destroy>", cleanup)

    def wheel(self, event: tk.Event[tk.Misc]) -> None:
        if str(event.widget).startswith(str(self)) and event.delta:
            units = max(1, abs(event.delta) // 120)
            self.canvas.yview_scroll(-units if event.delta > 0 else units, "units")
