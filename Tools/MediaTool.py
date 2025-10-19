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
import time
from typing import Callable, Optional

try:  # pragma: no cover - GUI is optional and not always available
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except Exception:  # pragma: no cover
    tk = None  # type: ignore
    filedialog = None  # type: ignore
    messagebox = None  # type: ignore
    ttk = None  # type: ignore


StatusCallback = Optional[Callable[[str], None]]

SUPPORTED_VIDEO_SUFFIXES = {
    ".mp4",
    ".mkv",
    ".mov",
    ".m4v",
    ".webm",
}


def format_timespan(seconds: float) -> str:
    """Return a human-friendly mm:ss or hh:mm:ss string."""
    seconds = max(0, int(seconds + 0.5))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:d}:{secs:02d}"


def ask_path(prompt: str, expect_file: Optional[bool] = None) -> pathlib.Path:
    """Prompt for a filesystem path and validate basic expectations."""
    while True:
        raw = input(prompt).strip()
        raw = raw.strip('"').strip("'")
        if not raw:
            print("Please enter a path.")
            continue
        path = pathlib.Path(raw).expanduser()
        if expect_file is True:
            if not path.is_file():
                print("That path does not point to an existing file. Try again.")
                continue
            return path
        if expect_file is False:
            if path.exists() and not path.is_dir():
                print("That path exists but is not a directory. Try again.")
                continue
            return path
        if not path.exists():
            print("That path does not exist. Try again.")
            continue
        if not path.is_file() and not path.is_dir():
            print("That path is neither a file nor a directory. Try again.")
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
    """Return video duration in seconds using ffprobe, with fallbacks."""

    commands = [
        [
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
        ],
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video),
        ],
    ]

    last_error: Optional[str] = None

    for cmd in commands:
        try:
            out = subprocess.check_output(cmd)
            candidate = out.decode().strip()
            if not candidate:
                last_error = "ffprobe returned no duration."
                continue
            duration = float(candidate)
            if not math.isfinite(duration) or duration <= 0:
                last_error = "ffprobe reported a non-positive duration."
                continue
            return duration
        except FileNotFoundError as exc:
            raise RuntimeError("ffprobe not found on PATH.") from exc
        except subprocess.CalledProcessError as exc:
            last_error = f"ffprobe failed: {exc}"
        except ValueError:
            last_error = "Could not parse duration from ffprobe output."

    raise RuntimeError(last_error or "Unable to determine duration via ffprobe.")


DEFAULT_SUPPRESS_TOKENS = (
    "Invalid NAL unit size",
    "missing picture in access unit",
)


def run_ffmpeg_command(
    cmd: list[str],
    log: Callable[[str], None],
    suppress_tokens: tuple[str, ...] = DEFAULT_SUPPRESS_TOKENS,
    total_duration: Optional[float] = None,
    progress_cb: Optional[Callable[[float, float], None]] = None,
) -> int:
    """Run ffmpeg, provide optional progress, and return the count of suppressed lines."""
    cmd_local = cmd.copy()
    if progress_cb is not None and "-progress" not in cmd_local:
        insert_pos = 1
        if len(cmd_local) > 1 and cmd_local[1] == "-hide_banner":
            insert_pos = 2
        cmd_local.insert(insert_pos, "-progress")
        cmd_local.insert(insert_pos + 1, "pipe:1")
        cmd_local.insert(insert_pos + 2, "-nostats")

    log("Running: " + " ".join(cmd_local))

    try:
        process = subprocess.Popen(
            cmd_local,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg not found on PATH.") from exc

    filtered_messages = 0
    remaining_messages: list[str] = []

    try:
        if process.stdout is not None:
            for raw_line in iter(process.stdout.readline, ""):
                line = raw_line.strip()
                if not line:
                    continue
                if progress_cb is not None and total_duration and total_duration > 0:
                    if line.startswith("out_time_ms="):
                        try:
                            out_time_ms = int(line.split("=", 1)[1])
                            processed_seconds = out_time_ms / 1_000_000
                            processed_seconds = max(0.0, min(processed_seconds, total_duration))
                            progress_cb(processed_seconds, total_duration)
                        except ValueError:
                            continue
                    elif line.startswith("out_time="):
                        # Fallback if only HH:MM:SS provided
                        try:
                            time_str = line.split("=", 1)[1]
                            h, m, s = time_str.split(":")
                            seconds = int(h) * 3600 + int(m) * 60 + float(s)
                            processed_seconds = max(0.0, min(seconds, total_duration))
                            progress_cb(processed_seconds, total_duration)
                        except Exception:
                            continue
                    elif line.startswith("progress="):
                        value = line.split("=", 1)[1].strip()
                        if value == "end" and total_duration and total_duration > 0:
                            progress_cb(total_duration, total_duration)
        process.wait()

        stderr_output = process.stderr.read() if process.stderr else ""
        if stderr_output:
            for raw_line in stderr_output.splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("frame="):
                    continue
                if any(token in line for token in suppress_tokens):
                    filtered_messages += 1
                    continue
                remaining_messages.append(line)

        for message in remaining_messages:
            log(message)

        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg reported an error (exit code {process.returncode}).")
    finally:
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()

    if progress_cb is not None and total_duration and total_duration > 0:
        progress_cb(total_duration, total_duration)

    return filtered_messages


IgnoredReason = tuple[pathlib.Path, str]


def collect_video_files(source: pathlib.Path) -> tuple[list[pathlib.Path], list[IgnoredReason]]:
    """Return candidate video files plus a list of skipped entries."""
    ignored: list[IgnoredReason] = []

    def is_hidden(path: pathlib.Path) -> bool:
        return path.name.startswith(".")

    def validate_file(file_path: pathlib.Path) -> bool:
        if is_hidden(file_path):
            ignored.append((file_path, "hidden file"))
            return False
        if file_path.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES:
            ignored.append((file_path, "unsupported extension"))
            return False
        return True

    if source.is_file():
        if validate_file(source):
            return [source], ignored
        return [], ignored

    if source.is_dir():
        videos = []
        for item in sorted(source.iterdir()):
            if not item.is_file():
                continue
            if validate_file(item):
                videos.append(item)
        if not videos:
            supported = ", ".join(sorted(SUPPORTED_VIDEO_SUFFIXES))
            if ignored:
                skipped = ", ".join(f"{path.name} ({reason})" for path, reason in ignored[:5])
                if len(ignored) > 5:
                    skipped += ", ..."
                raise RuntimeError(
                    f"No usable video files found in {source}. "
                    f"Skipped {len(ignored)} item(s): {skipped}. "
                    f"Expected extensions: {supported}"
                )
            raise RuntimeError(
                f"No supported video files found in {source}. Expected extensions: {supported}"
            )
        return videos, ignored

    raise RuntimeError("Source path must be a file or directory.")


def split_video(
    video: pathlib.Path,
    target_size_mb: float,
    output_dir: pathlib.Path,
    status_cb: StatusCallback = None,
    progress_cb: Optional[Callable[[float, float], None]] = None,
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
        "-segment_start_number",
        "1",
        str(output_pattern),
    ]

    if progress_cb and duration > 0:
        progress_cb(0.0, duration)

    suppressed = run_ffmpeg_command(
        cmd,
        log,
        total_duration=duration,
        progress_cb=progress_cb,
    )

    if suppressed:
        log(
            f"Suppressed {suppressed} corrupted packet warnings from FFmpeg; damaged frames were skipped."
        )

    log(f"Done! Parts saved under: {output_dir}")


def split_source(
    source: pathlib.Path,
    target_size_mb: float,
    output_dir: pathlib.Path,
    status_cb: StatusCallback = None,
    progress_cb: Optional[Callable[[pathlib.Path, float, float], None]] = None,
    delete_source: bool = False,
) -> None:
    """Split a single file or every supported file within a directory."""

    def log(message: str) -> None:
        if status_cb:
            status_cb(message)
        else:
            print(message)

    videos, ignored = collect_video_files(source)
    if not videos:
        if ignored:
            skipped_summary = ", ".join(f"{path.name} ({reason})" for path, reason in ignored[:5])
            if len(ignored) > 5:
                skipped_summary += f", ... ({len(ignored) - 5} more)"
            raise RuntimeError(f"No valid video files to split. Skipped {len(ignored)} item(s): {skipped_summary}")
        raise RuntimeError("No video files to split.")

    total = len(videos)
    multiple = total > 1

    if output_dir.exists() and not output_dir.is_dir():
        raise RuntimeError("Output path must refer to a directory, not a file.")

    if ignored:
        skipped_summary = ", ".join(f"{path.name} ({reason})" for path, reason in ignored[:5])
        if len(ignored) > 5:
            skipped_summary += f", ... ({len(ignored) - 5} more)"
        log(f"Skipped {len(ignored)} item(s): {skipped_summary}")

    if multiple:
        log(f"Found {total} videos to process in {source}.")

    used_folder_names: set[str] = set()
    failures: list[tuple[pathlib.Path, str]] = []
    completed = 0

    for index, video in enumerate(videos, start=1):
        if multiple:
            log(f"[{index}/{total}] Processing {video.name}")
            child_cb: StatusCallback = lambda msg, name=video.name: log(f"{name}: {msg}")
            folder_name = video.stem or video.name
            candidate = folder_name
            counter = 1
            while candidate in used_folder_names:
                candidate = f"{folder_name}_{counter}"
                counter += 1
            used_folder_names.add(candidate)
            video_output = output_dir / candidate
        else:
            child_cb = status_cb
            video_output = output_dir

        if progress_cb:

            def progress_wrapper(processed: float, total: float, video_path: pathlib.Path = video) -> None:
                progress_cb(video_path, processed, total)
        else:
            progress_wrapper = None

        try:
            split_video(
                video,
                target_size_mb,
                video_output,
                status_cb=child_cb,
                progress_cb=progress_wrapper,
            )
            completed += 1
        except Exception as exc:
            reason = str(exc) or exc.__class__.__name__
            log(f"Failed to split {video}: {reason}")
            failures.append((video, reason))
            continue

        if delete_source and video.is_file():
            message_cb = child_cb or log
            try:
                video.unlink()
                if multiple:
                    message_cb("Deleted source file.")
                else:
                    message_cb(f"Deleted source file: {video}")
            except OSError as exc:
                message_cb(f"Failed to delete source file ({exc}).")

    if multiple:
        log(f"Finished processing {completed} of {total} video(s).")

    if failures:
        if len(failures) == 1 and completed == 0:
            # Preserve original behaviour for single failures.
            failed_video, reason = failures[0]
            raise RuntimeError(f"Failed to split {failed_video}: {reason}")
        summary = "; ".join(f"{path.name}: {reason}" for path, reason in failures[:5])
        if len(failures) > 5:
            summary += f"; ... and {len(failures) - 5} more"
        raise RuntimeError(f"{len(failures)} video(s) failed: {summary}")


CONVERSION_FORMATS = ("mp4", "mkv", "webm")


def build_conversion_command(
    video: pathlib.Path,
    target_format: str,
    destination: pathlib.Path,
) -> list[str]:
    cmd = ["ffmpeg", "-hide_banner", "-y", "-i", str(video)]

    if target_format == "mp4":
        cmd.extend(
            [
                "-map",
                "0",
                "-map",
                "-0:d?",
                "-map",
                "-0:t?",
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-c:s",
                "mov_text",
                "-movflags",
                "+faststart",
            ]
        )
    elif target_format == "mkv":
        cmd.extend(
            [
                "-map",
                "0",
                "-map",
                "-0:d?",
                "-c",
                "copy",
            ]
        )
    elif target_format == "webm":
        cmd.extend(
            [
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "32",
                "-c:a",
                "libopus",
                "-b:a",
                "128k",
            ]
        )
    else:
        raise RuntimeError(f"Unsupported format: {target_format}")

    cmd.append(str(destination))
    return cmd


def convert_source(
    source: pathlib.Path,
    target_format: str,
    output_dir: Optional[pathlib.Path],
    status_cb: StatusCallback = None,
    progress_cb: Optional[Callable[[pathlib.Path, float, float], None]] = None,
    replace_existing: bool = False,
) -> None:
    """Convert a single video or all videos in a directory to a new format."""

    target_format = target_format.lower()
    if target_format not in CONVERSION_FORMATS:
        raise RuntimeError(f"Target format must be one of: {', '.join(CONVERSION_FORMATS)}")

    def log(message: str) -> None:
        if status_cb:
            status_cb(message)
        else:
            print(message)

    videos, ignored = collect_video_files(source)
    if not videos:
        if ignored:
            skipped_summary = ", ".join(f"{path.name} ({reason})" for path, reason in ignored[:5])
            if len(ignored) > 5:
                skipped_summary += f", ... ({len(ignored) - 5} more)"
            raise RuntimeError(f"No valid video files to convert. Skipped {len(ignored)} item(s): {skipped_summary}")
        raise RuntimeError("No video files to convert.")

    total = len(videos)
    multiple = total > 1

    if ignored:
        skipped_summary = ", ".join(f"{path.name} ({reason})" for path, reason in ignored[:5])
        if len(ignored) > 5:
            skipped_summary += f", ... ({len(ignored) - 5} more)"
        log(f"Skipped {len(ignored)} item(s): {skipped_summary}")

    if multiple:
        log(f"Found {total} videos to process in {source}.")

    if not replace_existing and output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)

    failures: list[tuple[pathlib.Path, str]] = []
    completed = 0
    used_output_names: set[pathlib.Path] = set()

    for index, video in enumerate(videos, start=1):
        if multiple:
            log(f"[{index}/{total}] Processing {video.name}")
            child_cb: StatusCallback = lambda msg, name=video.name: log(f"{name}: {msg}")
        else:
            child_cb = status_cb

        def child_log(message: str) -> None:
            if child_cb:
                child_cb(message)
            else:
                log(message)

        try:
            duration = run_ffprobe_duration(video)
            if progress_cb:

                def progress_wrapper(processed: float, total: float, video_path: pathlib.Path = video) -> None:
                    progress_cb(video_path, processed, total)
            else:
                progress_wrapper = None

            if progress_wrapper and duration > 0:
                progress_wrapper(0.0, duration)
            if replace_existing:
                current_ext = video.suffix.lower().lstrip(".")
                if current_ext == target_format:
                    temp_path = video.with_name(f"{video.stem}.tmp_convert.{target_format}")
                    final_path = video
                else:
                    final_path = video.with_suffix(f".{target_format}")
                    temp_path = final_path
                destination = temp_path
            else:
                if output_dir is None:
                    dest_dir = video.parent if not multiple else video.parent
                else:
                    dest_dir = output_dir

                dest_dir.mkdir(parents=True, exist_ok=True)
                candidate = dest_dir / f"{video.stem}.{target_format}"
                counter = 1
                while candidate in used_output_names or candidate.exists():
                    candidate = dest_dir / f"{video.stem}_{counter}.{target_format}"
                    counter += 1
                used_output_names.add(candidate)
                final_path = candidate
                destination = candidate

            destination.parent.mkdir(parents=True, exist_ok=True)
            cmd = build_conversion_command(video, target_format, destination)
            suppressed = run_ffmpeg_command(
                cmd,
                child_log,
                suppress_tokens=(),
                total_duration=duration,
                progress_cb=progress_wrapper,
            )

            if replace_existing:
                if final_path == video:
                    # Replacing in place with same extension.
                    if destination != video:
                        backup = video.with_name(f"{video.name}.bak")
                        try:
                            if backup.exists():
                                backup.unlink()
                            video.rename(backup)
                            pathlib.Path(destination).rename(video)
                            backup.unlink()
                        except Exception as exc:
                            if pathlib.Path(destination).exists():
                                pathlib.Path(destination).unlink()
                            if backup.exists():
                                backup.rename(video)
                            raise RuntimeError(f"Failed to replace original file: {exc}") from exc
                else:
                    try:
                        video.unlink()
                    except OSError as exc:
                        child_log(f"Warning: could not delete original file ({exc}).")

            if suppressed:
                child_log(f"Suppressed {suppressed} informational ffmpeg lines.")

            if not replace_existing and final_path != destination:
                pathlib.Path(destination).rename(final_path)

            child_log(f"Done! Converted file saved to: {final_path}")
            completed += 1
        except Exception as exc:
            reason = str(exc) or exc.__class__.__name__
            log(f"Failed to convert {video}: {reason}")
            # Clean up partially written outputs.
            if destination := locals().get("destination"):
                try:
                    dest_path = pathlib.Path(destination)
                    if dest_path.exists():
                        dest_path.unlink()
                except Exception:
                    pass
            failures.append((video, reason))

    if multiple:
        log(f"Finished processing {completed} of {total} video(s).")

    if failures:
        summary = "; ".join(f"{path.name}: {reason}" for path, reason in failures[:5])
        if len(failures) > 5:
            summary += f"; ... and {len(failures) - 5} more"
        raise RuntimeError(f"{len(failures)} video(s) failed: {summary}")
# ------------------------------- GUI helpers ------------------------------- #

def launch_gui() -> None:  # pragma: no cover - GUI interaction is manual
    if tk is None or filedialog is None or messagebox is None or ttk is None:
        print("Tkinter is not available on this system. Falling back to CLI.")
        run_cli()
        return

    class SplitterTab:
        def __init__(self, notebook: ttk.Notebook) -> None:
            self.notebook = notebook
            self.root = notebook.winfo_toplevel()
            self.frame = ttk.Frame(notebook, padding=(20, 18))
            self.frame.grid_columnconfigure(0, weight=1)

            self.progress_start: dict[str, float] = {}

            header = ttk.Label(self.frame, text="Split Media Into Parts", style="Header.TLabel")
            header.grid(row=0, column=0, sticky="w")

            size_frame = ttk.LabelFrame(self.frame, text="Chunk Settings", style="Section.TLabelframe")
            size_frame.grid(row=1, column=0, sticky="ew", pady=(12, 8))
            size_frame.grid_columnconfigure(1, weight=1)
            ttk.Label(size_frame, text="Target size per chunk (MB):").grid(row=0, column=0, sticky="w")
            self.entry_size = ttk.Entry(size_frame, width=12)
            self.entry_size.grid(row=0, column=1, sticky="w", padx=(8, 0))
            self.entry_size.insert(0, "180")

            source_frame = ttk.LabelFrame(self.frame, text="Source", style="Section.TLabelframe")
            source_frame.grid(row=2, column=0, sticky="ew", pady=(4, 8))
            source_frame.grid_columnconfigure(0, weight=1)
            self.video_var = tk.StringVar()
            ttk.Label(source_frame, text="Video or folder:").grid(row=0, column=0, sticky="w")
            self.video_entry = ttk.Entry(source_frame, textvariable=self.video_var, width=48)
            self.video_entry.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(4, 0))
            self.video_var.trace_add("write", self.on_video_path_change)

            button_row = ttk.Frame(source_frame)
            button_row.grid(row=1, column=2, sticky="w", padx=(8, 0))
            ttk.Button(button_row, text="Browse…", command=self.pick_video, width=9).grid(row=0, column=0)
            ttk.Button(button_row, text="Folder…", command=self.pick_folder, width=9).grid(row=0, column=1, padx=(6, 0))

            output_frame = ttk.LabelFrame(self.frame, text="Output", style="Section.TLabelframe")
            output_frame.grid(row=3, column=0, sticky="ew", pady=(4, 8))
            output_frame.grid_columnconfigure(0, weight=1)

            self.use_splitparts_var = tk.BooleanVar(value=True)
            ttk.Checkbutton(
                output_frame,
                text="Place parts inside ./SplitParts/",
                variable=self.use_splitparts_var,
                command=self.update_output_state,
            ).grid(row=0, column=0, columnspan=2, sticky="w")

            self.output_var = tk.StringVar()
            self.output_entry = ttk.Entry(output_frame, textvariable=self.output_var, width=48)
            self.output_entry.grid(row=1, column=0, sticky="ew", pady=(4, 0))
            self.output_browse_btn = ttk.Button(output_frame, text="Browse…", command=self.pick_output, width=9)
            self.output_browse_btn.grid(row=1, column=1, padx=(8, 0), sticky="w")

            self.delete_var = tk.BooleanVar(value=False)
            ttk.Checkbutton(
                output_frame,
                text="Delete source file(s) after splitting",
                variable=self.delete_var,
            ).grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 0))

            self.status_var = tk.StringVar(value="Ready")
            ttk.Label(self.frame, textvariable=self.status_var, style="Status.TLabel").grid(
                row=4, column=0, sticky="w", pady=(8, 0)
            )

            control_row = ttk.Frame(self.frame)
            control_row.grid(row=5, column=0, sticky="ew", pady=(6, 0))
            control_row.grid_columnconfigure(0, weight=1)
            self.run_button = ttk.Button(control_row, text="Split Video", command=self.on_run, width=18)
            self.run_button.grid(row=0, column=1, sticky="e")

            progress_row = ttk.Frame(self.frame)
            progress_row.grid(row=6, column=0, sticky="ew", pady=(8, 0))
            progress_row.grid_columnconfigure(0, weight=1)
            self.progress = ttk.Progressbar(progress_row, mode="determinate", maximum=100)
            self.progress.grid(row=0, column=0, sticky="ew")

            self.update_output_state()

        # Shared helpers -------------------------------------------------- #
        def pick_video(self) -> None:
            filetypes = [
                ("Video files", "*.mp4 *.mkv *.webm *.mov *.m4v"),
                ("All files", "*.*"),
            ]
            path = filedialog.askopenfilename(title="Select video", filetypes=filetypes)
            if path:
                self.video_var.set(path)

        def pick_folder(self) -> None:
            path = filedialog.askdirectory(title="Select folder containing videos")
            if path:
                self.video_var.set(path)

        def pick_output(self) -> None:
            if self.use_splitparts_var.get():
                return
            path = filedialog.askdirectory(title="Select output folder")
            if path:
                self.output_var.set(path)

        def compute_default_output(self, video_path: pathlib.Path) -> pathlib.Path:
            if video_path.is_dir():
                base_dir = video_path
                if self.use_splitparts_var.get():
                    return base_dir / "SplitParts"
                return base_dir

            base_dir = video_path.parent
            if self.use_splitparts_var.get():
                return base_dir / "SplitParts" / video_path.stem
            return base_dir

        def apply_output_path(self) -> None:
            raw = self.video_var.get().strip()
            if not raw:
                return
            video_path = pathlib.Path(raw).expanduser()
            if not video_path.exists():
                return
            auto_dir = self.compute_default_output(video_path)
            self.output_var.set(str(auto_dir))

        def update_output_state(self) -> None:
            using_auto = bool(self.use_splitparts_var.get())
            state = "disabled" if using_auto else "normal"
            try:
                self.output_entry.configure(state=state)
                self.output_browse_btn.configure(state=state)
            except Exception:
                pass
            if using_auto or not self.output_var.get():
                self.apply_output_path()

        def on_video_path_change(self, *_args: str) -> None:
            if self.use_splitparts_var.get():
                self.apply_output_path()

        def set_status(self, message: str) -> None:
            self.status_var.set(message)
            self.root.update_idletasks()

        def handle_progress(self, label: str, key: str, processed: float, total: float) -> None:
            if key not in self.progress_start or processed <= 0:
                self.progress_start[key] = time.time()

            start_time = self.progress_start.get(key, time.time())
            if total > 0:
                fraction = max(0.0, min(processed / total, 1.0))
            else:
                fraction = 0.0
            percent = int(fraction * 100)
            self.progress["value"] = percent

            if fraction >= 1.0:
                self.status_var.set(f"{label}: 100% — Completed")
                self.progress_start.pop(key, None)
            else:
                eta_text = ""
                if processed > 0 and total > 0:
                    elapsed = time.time() - start_time
                    rate = processed / max(elapsed, 1e-6)
                    if rate > 0:
                        remaining = max(total - processed, 0.0)
                        eta_text = f" — ETA {format_timespan(remaining / rate)}"
                self.status_var.set(f"{label}: {percent}%{eta_text}")
            self.root.update_idletasks()

        def on_run(self) -> None:
            try:
                target = float(self.entry_size.get().strip())
                if target <= 0:
                    raise ValueError
            except ValueError:
                messagebox.showerror("Invalid input", "Please enter a positive number for the target size.")
                return

            raw_source = self.video_var.get().strip()
            if not raw_source:
                messagebox.showerror("Missing source", "Please pick a source video or folder.")
                return
            video_path = pathlib.Path(raw_source).expanduser()
            if not video_path.exists():
                messagebox.showerror("Missing source", "Please pick a valid source video or folder.")
                return
            if not video_path.is_file() and not video_path.is_dir():
                messagebox.showerror("Invalid source", "Source must be a video file or a folder.")
                return

            if self.use_splitparts_var.get():
                output_path = self.compute_default_output(video_path)
                self.output_var.set(str(output_path))
            else:
                raw_output = self.output_var.get().strip()
                if not raw_output:
                    messagebox.showerror(
                        "Invalid output", "Please choose an output folder or enable the automatic option."
                    )
                    return
                output_path = pathlib.Path(raw_output).expanduser()

            if output_path.exists() and not output_path.is_dir():
                messagebox.showerror("Invalid output", "Output path points to a file. Choose a directory.")
                return

            self.run_button.config(state="disabled")
            self.set_status("Splitting… this may take a moment.")
            self.progress["value"] = 0
            self.progress_start.clear()

            def worker() -> None:
                try:
                    split_source(
                        video_path,
                        target,
                        output_path,
                        status_cb=lambda msg: self.root.after(0, self.set_status, msg),
                        progress_cb=lambda p, processed, total: self.root.after(
                            0, self.handle_progress, p.name, str(p), processed, total
                        ),
                        delete_source=self.delete_var.get(),
                    )
                    self.root.after(0, lambda: messagebox.showinfo("Complete", "Splitting finished successfully."))
                except Exception as exc:
                    error_message = str(exc) or "Unexpected error."
                    self.root.after(0, lambda msg=error_message: messagebox.showerror("Error", msg))
                finally:
                    self.root.after(0, lambda: self.run_button.config(state="normal"))

            threading.Thread(target=worker, daemon=True).start()

    class ConverterTab:
        def __init__(self, notebook: ttk.Notebook) -> None:
            self.notebook = notebook
            self.root = notebook.winfo_toplevel()
            self.frame = ttk.Frame(notebook, padding=(20, 18))
            self.frame.grid_columnconfigure(0, weight=1)

            self.progress_start: dict[str, float] = {}

            ttk.Label(self.frame, text="Convert Media", style="Header.TLabel").grid(row=0, column=0, sticky="w")

            format_frame = ttk.LabelFrame(self.frame, text="Target Format", style="Section.TLabelframe")
            format_frame.grid(row=1, column=0, sticky="ew", pady=(12, 8))
            ttk.Label(format_frame, text="Container:").grid(row=0, column=0, sticky="w")
            self.format_var = tk.StringVar(value=CONVERSION_FORMATS[0])
            self.format_menu = ttk.OptionMenu(format_frame, self.format_var, CONVERSION_FORMATS[0], *CONVERSION_FORMATS)
            self.format_menu.grid(row=0, column=1, sticky="w", padx=(8, 0))

            source_frame = ttk.LabelFrame(self.frame, text="Source", style="Section.TLabelframe")
            source_frame.grid(row=2, column=0, sticky="ew", pady=(4, 8))
            source_frame.grid_columnconfigure(0, weight=1)
            self.video_var = tk.StringVar()
            ttk.Label(source_frame, text="Video or folder:").grid(row=0, column=0, sticky="w")
            self.video_entry = ttk.Entry(source_frame, textvariable=self.video_var, width=48)
            self.video_entry.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(4, 0))
            self.video_var.trace_add("write", self.on_video_path_change)

            btn_row = ttk.Frame(source_frame)
            btn_row.grid(row=1, column=2, sticky="w", padx=(8, 0))
            ttk.Button(btn_row, text="Browse…", command=self.pick_video, width=9).grid(row=0, column=0)
            ttk.Button(btn_row, text="Folder…", command=self.pick_folder, width=9).grid(row=0, column=1, padx=(6, 0))

            output_frame = ttk.LabelFrame(self.frame, text="Output", style="Section.TLabelframe")
            output_frame.grid(row=3, column=0, sticky="ew", pady=(4, 8))
            output_frame.grid_columnconfigure(0, weight=1)
            ttk.Label(output_frame, text="Destination folder:").grid(row=0, column=0, sticky="w")
            self.output_var = tk.StringVar()
            self.output_entry = ttk.Entry(output_frame, textvariable=self.output_var, width=48)
            self.output_entry.grid(row=1, column=0, sticky="ew", pady=(4, 0))
            self.output_browse_btn = ttk.Button(output_frame, text="Browse…", command=self.pick_output, width=9)
            self.output_browse_btn.grid(row=1, column=1, padx=(8, 0), sticky="w")

            self.replace_var = tk.BooleanVar(value=False)
            ttk.Checkbutton(
                output_frame,
                text="Replace existing file(s)",
                variable=self.replace_var,
                command=self.update_output_state,
            ).grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 0))

            self.status_var = tk.StringVar(value="Ready")
            ttk.Label(self.frame, textvariable=self.status_var, style="Status.TLabel").grid(
                row=4, column=0, sticky="w", pady=(8, 0)
            )

            ctrl_row = ttk.Frame(self.frame)
            ctrl_row.grid(row=5, column=0, sticky="ew", pady=(6, 0))
            ctrl_row.grid_columnconfigure(0, weight=1)
            self.run_button = ttk.Button(ctrl_row, text="Convert Video", command=self.on_run, width=18)
            self.run_button.grid(row=0, column=1, sticky="e")

            progress_row = ttk.Frame(self.frame)
            progress_row.grid(row=6, column=0, sticky="ew", pady=(8, 0))
            progress_row.grid_columnconfigure(0, weight=1)
            self.progress = ttk.Progressbar(progress_row, mode="determinate", maximum=100)
            self.progress.grid(row=0, column=0, sticky="ew")

            self.update_output_state()

        def pick_video(self) -> None:
            filetypes = [
                ("Video files", "*.mp4 *.mkv *.webm *.mov *.m4v"),
                ("All files", "*.*"),
            ]
            path = filedialog.askopenfilename(title="Select video", filetypes=filetypes)
            if path:
                self.video_var.set(path)

        def pick_folder(self) -> None:
            path = filedialog.askdirectory(title="Select folder containing videos")
            if path:
                self.video_var.set(path)

        def pick_output(self) -> None:
            if self.replace_var.get():
                return
            path = filedialog.askdirectory(title="Select output folder")
            if path:
                self.output_var.set(path)

        def compute_default_output_dir(self, video_path: pathlib.Path) -> pathlib.Path:
            if video_path.is_dir():
                return video_path / "Converted"
            return video_path.parent

        def apply_output_path(self) -> None:
            raw = self.video_var.get().strip()
            if not raw:
                return
            video_path = pathlib.Path(raw).expanduser()
            if not video_path.exists():
                return
            auto_dir = self.compute_default_output_dir(video_path)
            self.output_var.set(str(auto_dir))

        def update_output_state(self) -> None:
            replace = bool(self.replace_var.get())
            state = "disabled" if replace else "normal"
            try:
                self.output_entry.configure(state=state)
                self.output_browse_btn.configure(state=state)
            except Exception:
                pass
            if replace:
                self.output_var.set("")
            elif not self.output_var.get():
                self.apply_output_path()

        def handle_progress(self, label: str, key: str, processed: float, total: float) -> None:
            if key not in self.progress_start or processed <= 0:
                self.progress_start[key] = time.time()

            start_time = self.progress_start.get(key, time.time())
            if total > 0:
                fraction = max(0.0, min(processed / total, 1.0))
            else:
                fraction = 0.0
            percent = int(fraction * 100)
            self.progress["value"] = percent

            if fraction >= 1.0:
                self.status_var.set(f"{label}: 100% — Completed")
                self.progress_start.pop(key, None)
            else:
                eta_text = ""
                if processed > 0 and total > 0:
                    elapsed = time.time() - start_time
                    rate = processed / max(elapsed, 1e-6)
                    if rate > 0:
                        remaining = max(total - processed, 0.0)
                        eta_text = f" — ETA {format_timespan(remaining / rate)}"
                self.status_var.set(f"{label}: {percent}%{eta_text}")
            self.root.update_idletasks()

        def on_video_path_change(self, *_args: str) -> None:
            if not self.replace_var.get():
                self.apply_output_path()

        def set_status(self, message: str) -> None:
            self.status_var.set(message)
            self.root.update_idletasks()

        def on_run(self) -> None:
            target_format = self.format_var.get().strip().lower()
            if target_format not in CONVERSION_FORMATS:
                messagebox.showerror("Invalid format", f"Please choose one of: {', '.join(CONVERSION_FORMATS)}.")
                return

            raw_source = self.video_var.get().strip()
            if not raw_source:
                messagebox.showerror("Missing source", "Please pick a source video or folder.")
                return
            source_path = pathlib.Path(raw_source).expanduser()
            if not source_path.exists():
                messagebox.showerror("Missing source", "Please pick a valid source video or folder.")
                return
            if not source_path.is_file() and not source_path.is_dir():
                messagebox.showerror("Invalid source", "Source must be a video file or a folder.")
                return

            replace_existing = bool(self.replace_var.get())
            output_path: Optional[pathlib.Path] = None
            if not replace_existing:
                raw_output = self.output_var.get().strip()
                if not raw_output:
                    messagebox.showerror("Invalid output", "Please choose an output folder or enable replace mode.")
                    return
                output_path = pathlib.Path(raw_output).expanduser()
                if output_path.exists() and not output_path.is_dir():
                    messagebox.showerror("Invalid output", "Output path points to a file. Choose a directory.")
                    return

            self.run_button.config(state="disabled")
            self.set_status("Converting… this may take a moment.")
            self.progress["value"] = 0
            self.progress_start.clear()

            def worker() -> None:
                try:
                    convert_source(
                        source_path,
                        target_format,
                        output_path,
                        status_cb=lambda msg: self.root.after(0, self.set_status, msg),
                        progress_cb=lambda p, processed, total: self.root.after(
                            0, self.handle_progress, p.name, str(p), processed, total
                        ),
                        replace_existing=replace_existing,
                    )
                    self.root.after(0, lambda: messagebox.showinfo("Complete", "Conversion finished successfully."))
                except Exception as exc:
                    error_message = str(exc) or "Unexpected error."
                    self.root.after(0, lambda msg=error_message: messagebox.showerror("Error", msg))
                finally:
                    self.root.after(0, lambda: self.run_button.config(state="normal"))

            threading.Thread(target=worker, daemon=True).start()

    root = tk.Tk()
    root.title("MM Media Tool")
    root.resizable(False, False)

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass
    style.configure("Header.TLabel", font=("Helvetica", 15, "bold"))
    style.configure("Status.TLabel", foreground="#3a8ad8")
    style.configure("Section.TLabelframe", padding=(12, 10))
    style.configure("Section.TLabelframe.Label", font=("Helvetica", 11, "bold"))

    notebook = ttk.Notebook(root)
    notebook.grid(row=0, column=0, sticky="nsew")

    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)

    split_tab = SplitterTab(notebook)
    convert_tab = ConverterTab(notebook)

    notebook.add(split_tab.frame, text="Splitter")
    notebook.add(convert_tab.frame, text="Converter")

    root.mainloop()
# ------------------------------ CLI entrypoint ----------------------------- #

def ask_conversion_format(default: Optional[str] = None) -> str:
    options = "/".join(CONVERSION_FORMATS)
    while True:
        prompt = f"Target format ({options})"
        if default:
            prompt += f" [{default}]"
        prompt += ": "
        raw = input(prompt).strip().lower()
        if not raw and default:
            return default
        if raw in CONVERSION_FORMATS:
            return raw
        print(f"Please choose one of: {options}.")


def run_split_cli(delete_source_default: bool = False) -> None:
    target_mb = ask_target_size_mb()
    source_path = ask_path("Path to the source video or folder: ")
    output_path = ask_path("Output directory for parts (created if missing): ", expect_file=False)
    choice = input(
        "Delete source video(s) after splitting? [{}]: ".format("Y/n" if delete_source_default else "y/N")
    ).strip().lower()
    if not choice:
        delete_source = delete_source_default
    else:
        delete_source = choice in {"y", "yes"}

    progress_state: dict[pathlib.Path, dict[str, float]] = {}

    def progress_callback(path: pathlib.Path, processed: float, total: float) -> None:
        info = progress_state.setdefault(path, {"start": time.time(), "last": -10.0})
        if processed <= 0:
            info["start"] = time.time()
        percent = 0
        if total > 0:
            percent = int(max(0.0, min(processed / total, 1.0)) * 100)
        elif processed > 0:
            percent = 100

        elapsed = time.time() - info["start"]
        eta_text = ""
        if percent < 100 and processed > 0 and total > 0:
            remaining = max(total - processed, 0.0)
            rate = processed / max(elapsed, 1e-6)
            if rate > 0:
                eta_seconds = remaining / rate
                eta_text = f" — ETA {format_timespan(eta_seconds)}"

        if percent == 100:
            message = f"{path.name}: 100% — Done"
        else:
            message = f"{path.name}: {percent}%{eta_text}"

        if percent == 100 or info["last"] < 0 or percent - info["last"] >= 5:
            print(message)
            info["last"] = float(percent)
            if percent == 100:
                info["start"] = time.time()

    split_source(
        source_path,
        target_mb,
        output_path,
        progress_cb=progress_callback,
        delete_source=delete_source,
    )


def run_convert_cli(
    default_format: Optional[str] = None,
    replace_default: bool = False,
) -> None:
    source_path = ask_path("Path to the source video or folder: ")
    target_format = ask_conversion_format(default_format)
    choice = input(
        "Replace existing file(s)? [{}]: ".format("Y/n" if replace_default else "y/N")
    ).strip().lower()
    if not choice:
        replace_existing = replace_default
    else:
        replace_existing = choice in {"y", "yes"}

    output_path = None
    if not replace_existing:
        output_path = ask_path("Output directory for converted files (created if missing): ", expect_file=False)

    progress_state: dict[pathlib.Path, dict[str, float]] = {}

    def progress_callback(path: pathlib.Path, processed: float, total: float) -> None:
        info = progress_state.setdefault(path, {"start": time.time(), "last": -10.0})
        if processed <= 0:
            info["start"] = time.time()
        percent = 0
        if total > 0:
            percent = int(max(0.0, min(processed / total, 1.0)) * 100)
        elif processed > 0:
            percent = 100

        elapsed = time.time() - info["start"]
        eta_text = ""
        if percent < 100 and processed > 0 and total > 0:
            remaining = max(total - processed, 0.0)
            rate = processed / max(elapsed, 1e-6)
            if rate > 0:
                eta_seconds = remaining / rate
                eta_text = f" — ETA {format_timespan(eta_seconds)}"

        if percent == 100:
            message = f"{path.name}: 100% — Done"
        else:
            message = f"{path.name}: {percent}%{eta_text}"

        if percent == 100 or info["last"] < 0 or percent - info["last"] >= 5:
            print(message)
            info["last"] = float(percent)
            if percent == 100:
                info["start"] = time.time()

    convert_source(
        source_path,
        target_format,
        output_path,
        progress_cb=progress_callback,
        replace_existing=replace_existing,
    )


def run_cli(
    mode: Optional[str] = None,
    delete_source_default: bool = False,
    convert_format_default: Optional[str] = None,
    replace_existing_default: bool = False,
) -> None:
    selected_mode = mode
    if selected_mode not in {"split", "convert"}:
        while True:
            raw = input("Choose mode - split or convert [split]: ").strip().lower()
            if not raw or raw in {"s", "split"}:
                selected_mode = "split"
                break
            if raw in {"c", "convert"}:
                selected_mode = "convert"
                break
            print("Please enter 'split' or 'convert'.")

    if selected_mode == "split":
        run_split_cli(delete_source_default=delete_source_default)
    else:
        run_convert_cli(
            default_format=convert_format_default,
            replace_default=replace_existing_default,
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MM Media Tool")
    parser.add_argument("--cli", action="store_true", help="Force CLI mode even if Tkinter is available.")
    parser.add_argument("--mode", choices=["split", "convert"], help="Select the tool mode to run.")
    parser.add_argument("--video", type=pathlib.Path, help="Source video file or directory.")
    parser.add_argument("--output", type=pathlib.Path, help="Output directory.")
    parser.add_argument("--size", type=float, help="Target size per chunk (MB) for splitting.")
    parser.add_argument("--format", choices=CONVERSION_FORMATS, help="Target format for conversion.")
    parser.add_argument(
        "--delete-source",
        action="store_true",
        help="Delete source video file(s) after splitting.",
    )
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Replace source file(s) after conversion.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv or sys.argv[1:])

    mode = args.mode
    if mode is None:
        if args.size is not None:
            mode = "split"
        elif args.format:
            mode = "convert"

    if mode == "split" and args.size is not None and args.size <= 0:
        print("Target size must be positive.", file=sys.stderr)
        sys.exit(1)

    if mode == "split" and args.video and args.output and args.size:
        split_source(
            args.video.expanduser(),
            args.size,
            args.output.expanduser(),
            delete_source=args.delete_source,
        )
        return

    if mode == "convert" and args.video and args.format:
        output_dir: Optional[pathlib.Path]
        if args.replace_existing:
            output_dir = None
        else:
            if args.output is None:
                print("Please provide --output when not replacing existing files.", file=sys.stderr)
                sys.exit(1)
            output_dir = args.output.expanduser()
        convert_source(
            args.video.expanduser(),
            args.format,
            output_dir,
            replace_existing=args.replace_existing,
        )
        return

    if args.cli:
        run_cli(
            mode=mode,
            delete_source_default=args.delete_source,
            convert_format_default=args.format,
            replace_existing_default=args.replace_existing,
        )
        return

    launch_gui()


if __name__ == "__main__":
    main()
