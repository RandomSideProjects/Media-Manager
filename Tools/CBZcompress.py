#!/usr/bin/env python3
"""
CBZ compressor / CBR converter
------------------------------
Given a directory, finds all .cbz, .cbr, and top-level .png/.jpg/.jpeg image files and for each:
1) Extracts archive contents to a temp folder (.cbr via rarfile if available)
2) Resizes every image by a user-provided percentage (default 50%) while respecting EXIF orientation
3) Saves over the original filenames
4) Re-zips contents as .cbz (CBR inputs are converted to CBZ output)
5) Optionally deletes the original .cbr if --delete-cbr provided (or GUI checkbox)
6) Stand-alone images (.png/.jpg/.jpeg) are resized in-place (filename preserved)

CLI Usage:
    python CBZcompress.py /path/to/folder --percent 50
    python CBZcompress.py /path/to/folder            # will prompt for percent if omitted
    python CBZcompress.py /path/to/folder --delete-cbr  # convert & remove original CBRs

GUI Usage:
    python CBZcompress.py --gui   # Launch simple Tkinter GUI

Arguments:
    folder          Path containing .cbz/.cbr and/or image files (optional in GUI mode)
    --percent/-p    Resize percentage (1-1000). If omitted you'll be prompted in CLI mode.
    --delete-cbr    After successful conversion, delete original .cbr file(s).
    --gui           Launch GUI. Other CLI options are ignored except --percent/--delete-cbr which can pre-fill the GUI.

Notes:
    - CBR support requires the 'rarfile' module and an underlying unrar/rar or bsdtar capable of rar extraction.
    - If 'rarfile' is not installed or a backend isn't available, CBR files will be skipped with a warning.
"""

import argparse
import os
import sys
import tempfile
import zipfile
from pathlib import Path
from shutil import copyfileobj
from PIL import Image, ImageOps

try:
    import rarfile  # type: ignore
    _HAS_RARFILE = True
except Exception:  # pragma: no cover
    rarfile = None  # type: ignore
    _HAS_RARFILE = False

try:
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
except Exception:  # pragma: no cover - Tk may not be available
    tk = None  # type: ignore


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ARCHIVE_EXTS = {".cbz", ".cbr"}
STANDALONE_IMAGE_EXTS = {".png", ".jpg", ".jpeg"}

def is_animated_gif(img: Image.Image) -> bool:
    try:
        return getattr(img, "is_animated", False) and img.n_frames > 1
    except Exception:
        return False

def resize_image_in_place(img_path: Path, scale_percent: int) -> bool:
    """Resize the image at img_path by the given scale_percent (integer percent).
    Uses high-quality downsampling. Returns True if resized, False if skipped
    (e.g., animated GIF or dimensions unchanged after rounding).
    """
    try:
        with Image.open(img_path) as im:
            # Respect EXIF orientation (rotates data as needed)
            im = ImageOps.exif_transpose(im)

            # Skip animated GIFs to avoid breaking animation
            if (img_path.suffix.lower() == ".gif") and is_animated_gif(im):
                return False

            if scale_percent <= 0:
                return False
            new_w = max(1, int(im.width * scale_percent / 100))
            new_h = max(1, int(im.height * scale_percent / 100))

            # Only resize if meaningful
            if new_w == im.width and new_h == im.height:
                return False

            im = im.resize((new_w, new_h), resample=Image.LANCZOS)

            ext = img_path.suffix.lower()
            fmt = (im.format or "").upper()

            # Save using sensible defaults per format while keeping the same filename
            save_kwargs = {}
            if ext in {".jpg", ".jpeg"} or fmt == "JPEG":
                # Keep subsampling if present, optimize to shrink size
                save_kwargs.update(dict(quality=85, optimize=True, subsampling="keep"))
                im = im.convert("RGB")  # ensure no alpha for JPEG
                im.save(img_path, format="JPEG", **save_kwargs)
            elif ext == ".png" or fmt == "PNG":
                save_kwargs.update(dict(optimize=True))
                im.save(img_path, format="PNG", **save_kwargs)
            elif ext == ".webp" or fmt == "WEBP":
                # Lossy WEBP at a reasonable quality; preserves alpha if present
                save_kwargs.update(dict(quality=80, method=6))
                im.save(img_path, format="WEBP", **save_kwargs)
            elif ext == ".gif" or fmt == "GIF":
                # Single-frame GIFs only (animated ones are skipped above)
                im = im.convert("P", palette=Image.ADAPTIVE)
                im.save(img_path, format="GIF", optimize=True)
            else:
                # Fallback—shouldn't hit since we gate by extension
                im.save(img_path)

            return True
    except Exception as e:
        print(f"    [!] Failed to process image {img_path}: {e}", file=sys.stderr)
        return False

def extract_cbz(cbz_path: Path, dest_dir: Path):
    with zipfile.ZipFile(cbz_path, "r") as zf:
        # Extract with members to preserve filenames as-is
        zf.extractall(dest_dir)

def extract_cbr(cbr_path: Path, dest_dir: Path):
    if not _HAS_RARFILE:
        raise RuntimeError("rarfile module/back-end not available")
    with rarfile.RarFile(cbr_path, "r") as rf:  # type: ignore[attr-defined]
        rf.extractall(dest_dir)

def rezip_folder(src_dir: Path, out_zip_path: Path):
    # Create zip with deflated compression
    with zipfile.ZipFile(out_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src_dir):
            root_path = Path(root)
            for fname in files:
                fpath = root_path / fname
                # Build archive name relative to src_dir, always forward slashes
                arcname = fpath.relative_to(src_dir).as_posix()
                zf.write(fpath, arcname)

def process_cbz_file(cbz_path: Path, scale_percent: int, logger=print) -> None:
    # Backwards compatibility wrapper
    return process_archive(cbz_path, scale_percent, delete_cbr=False, logger=logger)

def process_archive(archive_path: Path, scale_percent: int, delete_cbr: bool, logger=print) -> None:
    logger(f"[+] Processing: {archive_path.name}")
    with tempfile.TemporaryDirectory(prefix="cbz_work_") as workdir:
        workdir = Path(workdir)
        extract_dir = workdir / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)

        # 1) Extract
        try:
            if archive_path.suffix.lower() == ".cbz":
                extract_cbz(archive_path, extract_dir)
            elif archive_path.suffix.lower() == ".cbr":
                try:
                    extract_cbr(archive_path, extract_dir)
                except Exception as e:  # noqa
                    logger(f"    [!] Skipping CBR (cannot extract): {archive_path} ({e})")
                    return
            else:
                logger("    [!] Unknown archive type, skipping")
                return
        except zipfile.BadZipFile:
            logger(f"    [!] Skipping (bad/corrupted zip): {archive_path}")
            return

        # 2) Resize images in place
        resized_count = 0
        skipped_count = 0
        for root, _, files in os.walk(extract_dir):
            for fname in files:
                fpath = Path(root) / fname
                if fpath.suffix.lower() in IMAGE_EXTS:
                    if resize_image_in_place(fpath, scale_percent):
                        resized_count += 1
                    else:
                        skipped_count += 1

        logger(f"    Resized: {resized_count} | Skipped: {skipped_count}")

        # 3) Re-zip to a temp file next to the original for atomic replace
        # Determine output path (always .cbz)
        if archive_path.suffix.lower() == ".cbz":
            out_final = archive_path
        else:  # .cbr -> convert to .cbz
            out_final = archive_path.with_suffix('.cbz')

        tmp_out = out_final.with_suffix(out_final.suffix + ".tmp")
        rezip_folder(extract_dir, tmp_out)

        # 4) Atomic replace original / create new cbz
        os.replace(tmp_out, out_final)
        if archive_path.suffix.lower() == ".cbr" and out_final != archive_path:
            logger(f"    Created: {out_final.name} (converted from {archive_path.name})")
            if delete_cbr:
                try:
                    archive_path.unlink()
                    logger(f"    Deleted original CBR: {archive_path.name}")
                except Exception as e:  # noqa
                    logger(f"    [!] Failed to delete original CBR: {e}")
        else:
            logger(f"    Replaced original: {out_final.name}")

def main_cli(args):
    root = Path(args.folder).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        print(f"Error: '{root}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    percent = args.percent
    if percent is None:
        # Interactive prompt
        try:
            raw = input("Enter resize percent (default 50): ").strip()
            percent = int(raw) if raw else 50
        except (ValueError, KeyboardInterrupt):
            print("Invalid input. Aborting.", file=sys.stderr)
            sys.exit(1)

    if percent <= 0:
        print("Percent must be > 0", file=sys.stderr)
        sys.exit(1)

    entries = sorted([p for p in root.iterdir() if p.is_file()])
    archives = [p for p in entries if p.suffix.lower() in ARCHIVE_EXTS]
    images = [p for p in entries if p.suffix.lower() in STANDALONE_IMAGE_EXTS]

    if not archives and not images:
        print("No archives or supported images found in the given folder.")
        sys.exit(0)

    print(f"Found {len(archives)} archive(s) and {len(images)} image(s) in: {root} | Scale: {percent}%")
    for arc in archives:
        try:
            process_archive(arc, percent, delete_cbr=args.delete_cbr)
        except Exception as e:
            print(f"[!] Error processing {arc.name}: {e}", file=sys.stderr)

    for img in images:
        process_image_file(img, percent, logger=print)

    print("Done.")

def process_image_file(img_path: Path, scale_percent: int, logger=print):
    """Resize a standalone image file in-place."""
    if img_path.suffix.lower() not in STANDALONE_IMAGE_EXTS:
        return
    try:
        if resize_image_in_place(img_path, scale_percent):
            logger(f"[+] Resized image: {img_path.name}")
        else:
            logger(f"[=] Skipped image (no change or unsupported): {img_path.name}")
    except Exception as e:  # noqa
        logger(f"[!] Error processing image {img_path.name}: {e}")

def build_arg_parser():
    ap = argparse.ArgumentParser(description="CBZ compressor: batch shrink images inside CBZ by a percentage.")
    ap.add_argument("folder", type=str, nargs="?", help="Folder containing .cbz files (optional with --gui)")
    ap.add_argument("--percent", "-p", type=int, help="Resize percent (e.g. 50). If omitted you'll be prompted in CLI mode.")
    ap.add_argument("--gui", action="store_true", help="Launch GUI instead of CLI.")
    ap.add_argument("--delete-cbr", action="store_true", help="After converting CBR to CBZ, delete the original CBR.")
    return ap

def main():
    ap = build_arg_parser()
    args = ap.parse_args()

    if args.gui:
        if tk is None:
            print("Tkinter not available in this environment.", file=sys.stderr)
            sys.exit(1)
        launch_gui(prefill_percent=args.percent, prefill_delete_cbr=args.delete_cbr)
        return

    if not args.folder:
        ap.error("folder is required in CLI mode (omit only when using --gui)")
    main_cli(args)

# ---------------- GUI ---------------- #

def launch_gui(prefill_percent=None, prefill_delete_cbr=False):  # pragma: no cover - UI code
    root = tk.Tk()
    root.title("CBZ Compressor")
    root.geometry("640x480")

    state = {
        "processing": False,
        "stop": False,
        "thread": None,
        "total": 0,
        "done": 0,
    }

    def log(msg: str):
        text.configure(state="normal")
        text.insert("end", msg + "\n")
        text.see("end")
        text.configure(state="disabled")

    def choose_folder():
        path = filedialog.askdirectory()
        if path:
            folder_var.set(path)

    def validate_percent(p: str) -> bool:
        if p == "":
            return True
        return p.isdigit() and int(p) > 0

    def run_processing():
        import threading

        folder = folder_var.get().strip()
        if not folder:
            messagebox.showerror("Error", "Please select a folder")
            return
        percent_str = percent_var.get().strip() or "50"
        try:
            percent = int(percent_str)
        except ValueError:
            messagebox.showerror("Error", "Percent must be a positive integer")
            return
        if percent <= 0:
            messagebox.showerror("Error", "Percent must be > 0")
            return

        cbz_dir = Path(folder)
        if not cbz_dir.exists() or not cbz_dir.is_dir():
            messagebox.showerror("Error", "Folder does not exist or is not a directory")
            return
        entries = sorted([p for p in cbz_dir.iterdir() if p.is_file()])
        archives = [p for p in entries if p.suffix.lower() in ARCHIVE_EXTS]
        images = [p for p in entries if p.suffix.lower() in STANDALONE_IMAGE_EXTS]
        if not archives and not images:
            messagebox.showinfo("Info", "No archives or supported images found in the selected folder")
            return

        state["processing"] = True
        state["stop"] = False
        state["total"] = len(archives) + len(images)
        state["done"] = 0
        progress.configure(maximum=state["total"], value=0)
        start_btn.configure(state="disabled")
        cancel_btn.configure(state="normal")
        log(f"Found {len(archives)} archive(s) and {len(images)} image(s). Starting with scale {percent}% ...")

        def worker():
            for arc in archives:
                if state["stop"]:
                    log("[!] Cancelled by user.")
                    break
                try:
                    process_archive(arc, percent, delete_cbr=delete_cbr_var.get(), logger=log)
                except Exception as e:  # noqa
                    log(f"[!] Error processing {arc.name}: {e}")
                state["done"] += 1
                progress.configure(value=state["done"])
            if not state["stop"]:
                for img in images:
                    if state["stop"]:
                        break
                    process_image_file(img, percent, logger=log)
                    state["done"] += 1
                    progress.configure(value=state["done"])
            log("Done." if not state["stop"] else "Stopped.")
            start_btn.configure(state="normal")
            cancel_btn.configure(state="disabled")
            state["processing"] = False

        t = threading.Thread(target=worker, daemon=True)
        state["thread"] = t
        t.start()

    def cancel_processing():
        if state["processing"]:
            state["stop"] = True
            cancel_btn.configure(state="disabled")

    main_frame = ttk.Frame(root, padding=10)
    main_frame.pack(fill="both", expand=True)

    folder_row = ttk.Frame(main_frame)
    folder_row.pack(fill="x", pady=5)
    ttk.Label(folder_row, text="Folder:").pack(side="left")
    folder_var = tk.StringVar()
    folder_entry = ttk.Entry(folder_row, textvariable=folder_var)
    folder_entry.pack(side="left", fill="x", expand=True, padx=5)
    ttk.Button(folder_row, text="Browse", command=choose_folder).pack(side="left")

    percent_row = ttk.Frame(main_frame)
    percent_row.pack(fill="x", pady=5)
    ttk.Label(percent_row, text="Percent:").pack(side="left")
    percent_var = tk.StringVar(value=str(prefill_percent if prefill_percent else 50))
    delete_cbr_var = tk.BooleanVar(value=bool(prefill_delete_cbr))
    delete_row = ttk.Frame(main_frame)
    delete_row.pack(fill="x", pady=2)
    ttk.Checkbutton(delete_row, text="Delete original CBR after conversion", variable=delete_cbr_var).pack(side="left")
    vcmd = (root.register(validate_percent), '%P')
    percent_entry = ttk.Entry(percent_row, textvariable=percent_var, validate="key", validatecommand=vcmd, width=6)
    percent_entry.pack(side="left", padx=5)
    ttk.Label(percent_row, text="%").pack(side="left")

    btn_row = ttk.Frame(main_frame)
    btn_row.pack(fill="x", pady=5)
    start_btn = ttk.Button(btn_row, text="Start", command=run_processing)
    start_btn.pack(side="left")
    cancel_btn = ttk.Button(btn_row, text="Cancel", command=cancel_processing, state="disabled")
    cancel_btn.pack(side="left", padx=5)

    progress = ttk.Progressbar(main_frame, mode="determinate")
    progress.pack(fill="x", pady=5)

    text = tk.Text(main_frame, state="disabled", wrap="word")
    text.pack(fill="both", expand=True, pady=5)
    scroll = ttk.Scrollbar(text, command=text.yview)
    text.configure(yscrollcommand=scroll.set)
    scroll.pack(side="right", fill="y")

    root.mainloop()

if __name__ == "__main__":
    main()