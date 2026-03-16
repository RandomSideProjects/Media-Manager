#!/usr/bin/env python3
"""check_mm_src_urls.py

Verbose URL checker for Media-Manager source JSONs.

What it does
- Recursively scans a directory for *.json
- For each JSON, looks for: { categories: [ { episodes: [ { src: ... } ] } ] }
- Checks each `src` URL with HEAD, falling back to GET Range bytes=0-0
- Verbose logging:
  - logs each URL check
  - logs start/end of each source JSON
  - shows per-source progress and totals
- Writes:
  - JSON report (default: ./mm-src-url-report.json)
  - summary text (same name + .summary.txt)

Usage
  python3 Tools/check_mm_src_urls.py --dir "~/Documents/RSP Media Manager/Media-Manager/Sources/Files/Anime" \
    --concurrency 16 --timeout 20

Notes
- Some hosts block HEAD; fallback GET Range is used.
- If you have protected Copyparty links, you can optionally treat 401/403 as OK.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


def expand(p: str) -> str:
    return os.path.abspath(os.path.expanduser(p))


def eprint(*a: Any) -> None:
    print(*a, file=sys.stderr, flush=True)


def find_json_files(root: str) -> List[str]:
    out: List[str] = []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith(".json"):
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


def load_json(path: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), None
    except Exception as e:
        return None, str(e)


def iter_episode_srcs(obj: dict):
    # yields (category_name, episode_title, src_url)
    cats = obj.get("categories") or []
    if not isinstance(cats, list):
        return
    for cat in cats:
        if not isinstance(cat, dict):
            continue
        cat_name = cat.get("category")
        eps = cat.get("episodes") or []
        if not isinstance(eps, list):
            continue
        for ep in eps:
            if not isinstance(ep, dict):
                continue
            src = ep.get("src")
            if isinstance(src, str) and src.strip():
                yield (str(cat_name) if cat_name is not None else "", str(ep.get("title") or ""), src.strip())


def http_check_url(
    url: str,
    timeout: float,
    treat_401_ok: bool,
    treat_403_ok: bool,
    user_agent: str = "mm-src-checker/1.1",
) -> Dict[str, Any]:
    """Returns dict: { ok, status, method, final_url, error }"""

    def do_req(method: str, headers: Dict[str, str]):
        req = urllib.request.Request(url, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.geturl()

    # HEAD
    try:
        status, final_url = do_req("HEAD", {"User-Agent": user_agent})
        ok = 200 <= status < 400
        if status == 401 and treat_401_ok:
            ok = True
        if status == 403 and treat_403_ok:
            ok = True
        return {"ok": ok, "status": status, "method": "HEAD", "final_url": final_url, "error": None}

    except urllib.error.HTTPError as e:
        status = getattr(e, "code", None)

        # Retry with GET Range when HEAD isn't allowed / blocked
        if status in (403, 405) or status is None:
            try:
                status2, final_url2 = do_req(
                    "GET",
                    {
                        "User-Agent": user_agent,
                        "Range": "bytes=0-0",
                    },
                )
                ok2 = (200 <= status2 < 400) or status2 == 206
                if status2 == 401 and treat_401_ok:
                    ok2 = True
                if status2 == 403 and treat_403_ok:
                    ok2 = True
                return {"ok": ok2, "status": status2, "method": "GET range", "final_url": final_url2, "error": None}
            except Exception as e2:
                return {"ok": False, "status": status, "method": "GET range", "final_url": None, "error": str(e2)}

        ok = False
        if status == 401 and treat_401_ok:
            ok = True
        if status == 403 and treat_403_ok:
            ok = True
        body = None
        try:
            body = e.read().decode("utf-8", "replace")[:500]
        except Exception:
            body = str(e)
        return {"ok": ok, "status": status, "method": "HEAD", "final_url": None, "error": body}

    except Exception as e:
        return {"ok": False, "status": None, "method": "HEAD", "final_url": None, "error": str(e)}


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="Directory containing source JSON files (scanned recursively)")
    ap.add_argument("--out", default=None, help="Output report JSON path (default: ./mm-src-url-report.json)")
    ap.add_argument("--concurrency", type=int, default=16)
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--treat-401-ok", action="store_true", help="Treat HTTP 401 as OK (reachable but protected)")
    ap.add_argument("--treat-403-ok", action="store_true", help="Treat HTTP 403 as OK (reachable but forbidden)")
    args = ap.parse_args(argv)

    root = expand(args.dir)
    out_path = expand(args.out) if args.out else os.path.abspath("mm-src-url-report.json")

    files = find_json_files(root)

    eprint(f"Found {len(files)} JSON files under: {root}")

    report: Dict[str, Any] = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dir": root,
        "counts": {
            "jsonFiles": len(files),
            "sourcesParsed": 0,
            "episodesFound": 0,
            "urlsChecked": 0,
            "badUrls": 0,
            "parseErrors": 0,
        },
        "sources": [],
    }

    # Pre-parse sources and build tasks grouped by file
    tasks_by_file: Dict[str, List[Tuple[str, str, str]]] = {}
    parsed_meta: Dict[str, Dict[str, Any]] = {}

    for fp in files:
        obj, err = load_json(fp)
        if err:
            report["counts"]["parseErrors"] += 1
            report["sources"].append({"file": fp, "parseError": err})
            eprint(f"[PARSE-ERROR] {fp}: {err}")
            continue
        if not isinstance(obj, dict):
            report["counts"]["parseErrors"] += 1
            report["sources"].append({"file": fp, "parseError": "Top-level JSON is not an object"})
            eprint(f"[PARSE-ERROR] {fp}: top-level JSON is not an object")
            continue

        report["counts"]["sourcesParsed"] += 1
        parsed_meta[fp] = {
            "file": fp,
            "title": obj.get("title"),
        }

        srcs = list(iter_episode_srcs(obj))
        report["counts"]["episodesFound"] += len(srcs)
        tasks_by_file[fp] = srcs

    total_urls = sum(len(v) for v in tasks_by_file.values())
    eprint(f"Total episode src URLs found: {total_urls}")

    # Results per file
    per_file: Dict[str, Dict[str, Any]] = {}
    for fp, meta in parsed_meta.items():
        per_file[fp] = {
            "file": fp,
            "title": meta.get("title"),
            "checked": 0,
            "badCount": 0,
            "failures": [],
        }

    # Worker
    def check_one(fp: str, cat: str, ep_title: str, url: str, idx: int, total_in_file: int):
        eprint(f"  [CHECK] ({idx}/{total_in_file}) {ep_title} :: {url}")
        r = http_check_url(url, args.timeout, args.treat_401_ok, args.treat_403_ok)
        return fp, cat, ep_title, url, r

    start = time.time()

    with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs: List[cf.Future] = []

        for fp in sorted(tasks_by_file.keys()):
            title = per_file[fp].get("title") or os.path.basename(fp)
            srcs = tasks_by_file[fp]
            eprint(f"\n[SOURCE-BEGIN] {title} ({len(srcs)} urls)\n  file={fp}")

            # Submit all jobs for this file
            for i, (cat, ep_title, url) in enumerate(srcs, start=1):
                futs.append(ex.submit(check_one, fp, cat, ep_title, url, i, len(srcs)))

            # Wait for all futures for this source file to complete
            # (We do this by tracking completion counts per-file.)
            # We'll still consume futures globally below.

        # Consume futures as they complete, update per-file counters
        done_by_file: Dict[str, int] = {fp: 0 for fp in tasks_by_file.keys()}
        total_by_file: Dict[str, int] = {fp: len(srcs) for fp, srcs in tasks_by_file.items()}

        for fut in cf.as_completed(futs):
            fp, cat, ep_title, url, r = fut.result()
            report["counts"]["urlsChecked"] += 1
            per_file[fp]["checked"] += 1
            done_by_file[fp] += 1

            ok = bool(r.get("ok"))
            status = r.get("status")
            method = r.get("method")

            if ok:
                eprint(f"  [OK]    {status} {method} :: {ep_title}")
            else:
                report["counts"]["badUrls"] += 1
                per_file[fp]["badCount"] += 1
                per_file[fp]["failures"].append(
                    {
                        "category": cat,
                        "episodeTitle": ep_title,
                        "src": url,
                        "status": status,
                        "method": method,
                        "error": r.get("error"),
                    }
                )
                eprint(f"  [FAIL]  {status} {method} :: {ep_title}")

            # If this file just finished, print completion
            if done_by_file[fp] == total_by_file[fp]:
                title = per_file[fp].get("title") or os.path.basename(fp)
                eprint(
                    f"[SOURCE-DONE] {title} :: checked={per_file[fp]['checked']} bad={per_file[fp]['badCount']}"
                )

    # Attach per-file results
    for fp in sorted(per_file.keys()):
        report["sources"].append(per_file[fp])

    # Write JSON report
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # Summary
    summary_path = re.sub(r"\.json$", ".summary.txt", out_path, flags=re.I)
    bad_sources = [s for s in report["sources"] if isinstance(s, dict) and s.get("badCount", 0) > 0]

    lines: List[str] = []
    lines.append(f"Generated: {report['generatedAt']}")
    lines.append(f"Dir: {root}")
    lines.append(f"JSON files: {report['counts']['jsonFiles']}")
    lines.append(f"Sources parsed: {report['counts']['sourcesParsed']}")
    lines.append(f"Episode src URLs: {report['counts']['episodesFound']}")
    lines.append(f"URLs checked: {report['counts']['urlsChecked']}")
    lines.append(f"Bad URLs: {report['counts']['badUrls']}")
    lines.append(f"Elapsed: {time.time() - start:.1f}s")
    lines.append("")
    lines.append(f"Sources with bad URLs: {len(bad_sources)}")
    for s in sorted(bad_sources, key=lambda x: x.get("badCount", 0), reverse=True)[:100]:
        lines.append(f"- {s.get('title') or os.path.basename(s['file'])}: {s.get('badCount')} bad")

    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    eprint(f"\nWrote {out_path}")
    eprint(f"Wrote {summary_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
