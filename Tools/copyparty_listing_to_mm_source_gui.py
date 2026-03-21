#!/usr/bin/env python3
"""Small GUI for copyparty_listing_to_mm_source.py.

- Lets you enter title / pw
- Add one or more folder URLs (one per line)
- Choose episode numbering mode
- Optional: split-by-season (requires exactly one folder)
- Generates Media-Manager source JSON and displays it

Run:
  python3 copyparty_listing_to_mm_source_gui.py

Deps: stdlib only (tkinter)
"""

from __future__ import annotations

import json
import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

# Import converter functions from the CLI script
# (keeps logic in one place)
import copyparty_listing_to_mm_source as conv


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Copyparty → Media-Manager Source")
        self.geometry("1000x700")

        self.var_title = tk.StringVar(value="")
        self.var_pw = tk.StringVar(value="")
        self.var_episode_numbering = tk.StringVar(value="category")
        self.var_split_by_season = tk.BooleanVar(value=False)
        self.var_pretty = tk.BooleanVar(value=True)

        self._build_ui()

    def _build_ui(self):
        top = ttk.Frame(self)
        top.pack(side=tk.TOP, fill=tk.X, padx=10, pady=10)

        # Row 0
        ttk.Label(top, text="Source title:").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.var_title, width=60).grid(row=0, column=1, sticky="we", padx=(6, 12))

        ttk.Label(top, text="Copyparty PW:").grid(row=0, column=2, sticky="w")
        pw = ttk.Entry(top, textvariable=self.var_pw, show="•", width=30)
        pw.grid(row=0, column=3, sticky="we")

        # Row 1
        ttk.Label(top, text="Episode numbering:").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(
            top,
            textvariable=self.var_episode_numbering,
            values=["category", "global", "se"],
            state="readonly",
            width=20,
        ).grid(row=1, column=1, sticky="w", padx=(6, 12), pady=(8, 0))

        ttk.Checkbutton(
            top,
            text="Split by season from filename (SxxEyy) — requires 1 folder",
            variable=self.var_split_by_season,
        ).grid(row=1, column=2, columnspan=2, sticky="w", pady=(8, 0))

        ttk.Checkbutton(top, text="Pretty JSON", variable=self.var_pretty).grid(row=2, column=1, sticky="w", padx=(6, 12), pady=(8, 0))

        top.grid_columnconfigure(1, weight=1)
        top.grid_columnconfigure(3, weight=1)

        mid = ttk.PanedWindow(self, orient=tk.VERTICAL)
        mid.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        # Folders
        folder_frame = ttk.Labelframe(mid, text="Folders (one per line). Optional category override: URL=Season 1")
        self.txt_folders = tk.Text(folder_frame, height=8, wrap="none")
        self.txt_folders.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=8, pady=8)

        btn_row = ttk.Frame(folder_frame)
        btn_row.pack(side=tk.TOP, fill=tk.X, padx=8, pady=(0, 8))

        ttk.Button(btn_row, text="Generate", command=self.on_generate).pack(side=tk.LEFT)
        ttk.Button(btn_row, text="Save As…", command=self.on_save).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(btn_row, text="Clear Output", command=self.on_clear_output).pack(side=tk.LEFT, padx=(8, 0))

        ttk.Label(btn_row, text="Tip: paste folder URLs from Copyparty; ensure they end with '/'").pack(side=tk.RIGHT)

        # Output
        out_frame = ttk.Labelframe(mid, text="Generated Media-Manager source JSON")
        self.txt_out = tk.Text(out_frame, wrap="none")
        self.txt_out.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=8, pady=8)

        mid.add(folder_frame, weight=1)
        mid.add(out_frame, weight=3)

    def _get_folder_specs(self) -> list[str]:
        raw = self.txt_folders.get("1.0", "end").strip()
        if not raw:
            return []
        lines = [ln.strip() for ln in raw.splitlines()]
        return [ln for ln in lines if ln and not ln.startswith("#")]

    def on_generate(self):
        title = self.var_title.get().strip()
        if not title:
            messagebox.showerror("Missing title", "Please enter a source title.")
            return

        folder_specs = self._get_folder_specs()
        if not folder_specs:
            messagebox.showerror("Missing folders", "Add at least one folder URL.")
            return

        split_by_season = bool(self.var_split_by_season.get())
        if split_by_season and len(folder_specs) != 1:
            messagebox.showerror("Split-by-season", "Split-by-season requires exactly ONE folder.")
            return

        pw = self.var_pw.get()
        pw = pw if pw else None

        # Build listings list for conv.listings_to_mm_source
        listings: list[tuple[dict, str, str]] = []
        for idx, spec in enumerate(folder_specs, start=1):
            url, cname = conv._parse_folder_spec(spec)
            cname = cname or f"Season {idx}"
            j = conv.fetch_ls_json(url, pw, timeout=30.0)
            listings.append((j, url, cname))

        out_obj = conv.listings_to_mm_source(
            listings,
            title=title,
            episode_numbering=self.var_episode_numbering.get(),
            split_by_season=split_by_season,
        )

        s = json.dumps(out_obj, indent=2 if self.var_pretty.get() else None, ensure_ascii=False)
        self.txt_out.delete("1.0", "end")
        self.txt_out.insert("1.0", s + "\n")

    def on_save(self):
        content = self.txt_out.get("1.0", "end").strip()
        if not content:
            messagebox.showerror("Nothing to save", "Generate JSON first.")
            return

        default = "source.json"
        title = self.var_title.get().strip()
        if title:
            safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in title)
            default = safe + ".json"

        path = filedialog.asksaveasfilename(
            title="Save Media-Manager source JSON",
            initialdir=os.path.expanduser("~/Downloads"),
            initialfile=default,
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*")],
        )
        if not path:
            return

        # Validate JSON before saving
        try:
            obj = json.loads(content)
            to_write = json.dumps(obj, indent=2, ensure_ascii=False) + "\n"
        except Exception as e:
            messagebox.showerror("Invalid JSON in output", str(e))
            return

        with open(path, "w", encoding="utf-8") as f:
            f.write(to_write)

        messagebox.showinfo("Saved", f"Saved to:\n{path}")

    def on_clear_output(self):
        self.txt_out.delete("1.0", "end")


def main() -> int:
    try:
        app = App()
        app.mainloop()
        return 0
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
