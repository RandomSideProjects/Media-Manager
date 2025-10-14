#!/usr/bin/env python3
"""
Split a large video into multiple playable chunks that stay under a target size.

The tool provides both a simple CLI prompt and a Tkinter GUI (when available).
It requires FFmpeg/ffprobe on PATH because the heavy lifting is done by FFmpeg's
segment muxer.
"""
from __future__ import annotations

import argparse
import math
import pathlib
import subprocess
import sys
import threading
from typing import Callable, Optional

try:  # pragma: no cover - GUI is optional and not always available
    import tkinter as tk
    from tkinter import filedialog, messagebox
except Exception:  # pragma: no cover
    tk = None  # type: ignore
    filedialog = None  # type: ignore
    messagebox = None  # type: ignore


StatusCallback = Optional[Callable[[str], None]]


def ask_path(prompt: str, expect_file: Optional[bool] = None) -> pathlib.Path:
    """Prompt for a filesystem path and validate basic expectations."""
    while True:
        raw = input(prompt).strip().strip('"')
        if not raw:
            print("Please enter a path.")
            continue
        path = pathlib.Path(raw).expanduser()
        if expect_file is True and not path.is_file():
            print("That path does not point to an existing file. Try again.")
            continue
        if expect_file is False and path.exists() and not path.is_dir():
            print("That path exists but is not a directory. Try again.")
            continue
        return path


def ask_target_size_mb() -> float:
    """Prompt until a positive numeric target size (MB) is provided."""
    while True:
        raw = input("Target size per chunk (MB): ").strip()
        try:
            value = float(raw)
            if value <= 0:
                raise ValueError
            return value
        except ValueError:
            print("Please enter a positive number, e.g. 180.")


def run_ffprobe_duration(video: pathlib.Path) -> float:
    """Return video duration in seconds using ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video),
    ]
    try:
        out = subprocess.check_output(cmd)
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe not found on PATH.") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffprobe failed: {exc}") from exc

    try:
        duration = float(out.decode().strip())
    except ValueError as exc:
        raise RuntimeError("Could not parse duration from ffprobe output.") from exc

    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("ffprobe reported a non-positive duration.")
    return duration


def split_video(
    video: pathlib.Path,
    target_size_mb: float,
    output_dir: pathlib.Path,
    status_cb: StatusCallback = None,
) -> None:
    """Run FFmpeg segment muxing with a rough duration per chunk."""

    def log(message: str) -> None:
        if status_cb:
            status_cb(message)
        else:
            print(message)

    video_size = video.stat().st_size
    target_bytes = target_size_mb * 1024 * 1024

    if video_size <= target_bytes:
        log("The file is already within the requested size; nothing to split.")
        return

    duration = run_ffprobe_duration(video)
    chunk_count = max(2, math.ceil(video_size / target_bytes))
    segment_seconds = max(duration / chunk_count, 1.0)

    log(f"Video size: {video_size / (1024 * 1024):.2f} MB")
    log(f"Estimated chunk count: {chunk_count}")
    log(f"Segment duration target: {segment_seconds:.2f} seconds per chunk")

    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = video.suffix or ".mp4"
    output_pattern = output_dir / f"Part_#%03d{suffix}"

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-i",
        str(video),
        "-c",
        "copy",
        "-map",
        "0",
        "-f",
        "segment",
        "-segment_time",
        f"{segment_seconds:.2f}",
        "-reset_timestamps",
        "1",
        str(output_pattern),
    ]

    log("Running: " + " ".join(cmd))

    try:
        subprocess.run(cmd, check=True)
        log(f"Done! Parts saved under: {output_dir}")
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg not found on PATH.") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"FFmpeg reported an error (exit code {exc.returncode}).") from exc


# ------------------------------- GUI helpers ------------------------------- #

def launch_gui() -> None:  # pragma: no cover - GUI interaction is manual
    if tk is None or filedialog is None or messagebox is None:
        print("Tkinter is not available on this system. Falling back to CLI.")
        run_cli()
        return

    class SplitterUI:
        def __init__(self) -> None:
            self.root = tk.Tk()
            self.root.title("Video Splitter")
            self.root.resizable(False, False)

            main = tk.Frame(self.root, padx=14, pady=12)
            main.grid(row=0, column=0, sticky="nsew")

            tk.Label(main, text="Target size per chunk (MB):").grid(row=0, column=0, sticky="w")
            self.entry_size = tk.Entry(main, width=12)
            self.entry_size.grid(row=0, column=1, sticky="we", padx=(6, 0))
            self.entry_size.insert(0, "180")

            tk.Label(main, text="Source video:").grid(row=1, column=0, sticky="w", pady=(10, 0))
            self.video_var = tk.StringVar()
            entry_video = tk.Entry(main, textvariable=self.video_var, width=40)
            entry_video.grid(row=1, column=1, sticky="we", padx=(6, 0), pady=(10, 0))
            tk.Button(main, text="Browse…", command=self.pick_video).grid(row=1, column=2, padx=(6, 0), pady=(10, 0))

            tk.Label(main, text="Output folder:").grid(row=2, column=0, sticky="w", pady=(8, 0))
            self.output_var = tk.StringVar()
            entry_output = tk.Entry(main, textvariable=self.output_var, width=40)
            entry_output.grid(row=2, column=1, sticky="we", padx=(6, 0), pady=(8, 0))
            tk.Button(main, text="Browse…", command=self.pick_output).grid(row=2, column=2, padx=(6, 0), pady=(8, 0))

            self.status_var = tk.StringVar(value="Ready")
            tk.Label(main, textvariable=self.status_var, fg="#3a8ad8").grid(row=3, column=0, columnspan=3, sticky="w", pady=(12, 6))

            self.run_button = tk.Button(main, text="Split Video", command=self.on_run, width=18)
            self.run_button.grid(row=4, column=0, columnspan=3, pady=(4, 0))

            main.columnconfigure(1, weight=1)

        def pick_video(self) -> None:
            filetypes = [
                ("Video files", "*.mp4 *.mkv *.webm *.mov *.m4v"),
                ("All files", "*.*"),
            ]
            path = filedialog.askopenfilename(title="Select video", filetypes=filetypes)
            if path:
                self.video_var.set(path)

        def pick_output(self) -> None:
            path = filedialog.askdirectory(title="Select output folder")
            if path:
                self.output_var.set(path)

        def set_status(self, message: str) -> None:
            self.status_var.set(message)
            self.root.update_idletasks()

        def on_run(self) -> None:
            try:
                target = float(self.entry_size.get().strip())
                if target <= 0:
                    raise ValueError
            except ValueError:
                messagebox.showerror("Invalid input", "Please enter a positive number for the target size.")
                return

            video_path = pathlib.Path(self.video_var.get().strip()).expanduser()
            if not video_path.is_file():
                messagebox.showerror("Missing file", "Please pick a valid source video.")
                return

            output_path = pathlib.Path(self.output_var.get().strip()).expanduser()
            if output_path.exists() and not output_path.is_dir():
                messagebox.showerror("Invalid output", "Output path points to a file. Choose a directory.")
                return

            self.run_button.config(state="disabled")
            self.set_status("Splitting… this may take a moment.")

            def worker() -> None:
                try:
                    split_video(
                        video_path,
                        target,
                        output_path,
                        status_cb=lambda msg: self.root.after(0, self.set_status, msg),
                    )
                    self.root.after(0, lambda: messagebox.showinfo("Complete", "Splitting finished successfully."))
                except Exception as exc:
                    error_message = str(exc) or "Unexpected error."
                    self.root.after(0, lambda msg=error_message: messagebox.showerror("Error", msg))
                finally:
                    self.root.after(0, lambda: self.run_button.config(state="normal"))

            threading.Thread(target=worker, daemon=True).start()

        def run(self) -> None:
            self.root.mainloop()

    SplitterUI().run()


# ------------------------------ CLI entrypoint ----------------------------- #

def run_cli() -> None:
    target_mb = ask_target_size_mb()
    video_path = ask_path("Path to the source video: ", expect_file=True)
    output_path = ask_path("Output directory (created if missing): ", expect_file=False)
    split_video(video_path, target_mb, output_path)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split a video into size-constrained chunks.")
    parser.add_argument("--cli", action="store_true", help="Force CLI mode even if Tkinter is available.")
    parser.add_argument("--video", type=pathlib.Path, help="Source video path.")
    parser.add_argument("--output", type=pathlib.Path, help="Output directory.")
    parser.add_argument("--size", type=float, help="Target size per chunk (MB).")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv or sys.argv[1:])

    if args.size is not None and args.size <= 0:
        print("Target size must be positive.", file=sys.stderr)
        sys.exit(1)

    if args.video and args.output and args.size:
        split_video(args.video.expanduser(), args.size, args.output.expanduser())
        return

    if args.cli:
        run_cli()
        return

    launch_gui()


if __name__ == "__main__":
    main()
