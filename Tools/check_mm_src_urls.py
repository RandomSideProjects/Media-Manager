#!/usr/bin/env python3
"""check_mm_src_urls.py

Verbose source checker for Media-Manager source JSONs.

What it does
- Recursively scans a directory for *.json
- For each JSON, looks for episode `src` URLs plus common separated-part arrays
  such as `sources`, `parts`, `items`, and `__separatedParts`
- Treats `http` / `https` refs as remote URLs
- Treats non-URL refs as local files resolved relative to the repo root and the
  source file that referenced them
- Parses local `.m3u8` playlists and validates each referenced media target
- Surfaces manifest entries marked with `isPlaceholder: true` as confirmed
  unavailable refs without re-probing them
- Uses urllib HEAD first, falls back to GET Range bytes=0-0, and falls back to
  `curl` when Python hits TLS or other transport-layer issues
- Writes:
  - JSON report (default: ./mm-src-url-report.json)
  - summary text (same name + .summary.txt)

Usage
  python3 Tools/check_mm_src_urls.py --dir "~/Documents/RSP_Media_Manager/Media-Manager/Sources/Files/Anime" \
    --concurrency 16 --timeout 20

Notes
- Some hosts block HEAD; GET Range is used as a fallback.
- Local playlist refs are checked as files first, then each media target inside
  the playlist is validated.
- Placeholder-marked entries are reported as confirmed unavailable using their
  manifest metadata so they stay visible in the report even after being removed
  from active playback.
- If you have protected Copyparty links, you can optionally treat 401/403 as OK.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse


def expand(path: str) -> str:
    return os.path.abspath(os.path.expanduser(path))


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr, flush=True)


def find_json_files(root: str) -> List[str]:
    out: List[str] = []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith(".json"):
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


def load_json(path: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle), None
    except Exception as exc:
        return None, str(exc)


def is_http_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def normalize_status_ok(status: Optional[int], treat_401_ok: bool, treat_403_ok: bool) -> bool:
    if status is None:
        return False
    if 200 <= status < 400:
        return True
    if status == 401 and treat_401_ok:
        return True
    if status == 403 and treat_403_ok:
        return True
    return False


def resolve_local_path(ref: str, base_file: str, repo_root: str) -> str:
    if os.path.isabs(ref):
        return ref

    candidates = [
        os.path.join(repo_root, ref),
        os.path.join(os.path.dirname(base_file), ref),
    ]
    seen: set[str] = set()
    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        if os.path.exists(normalized):
            return normalized
    return os.path.abspath(candidates[0])


def iter_episode_srcs(obj: dict) -> Iterable[Dict[str, Any]]:
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
            ep_title = str(ep.get("title") or "")
            seen = set()
            src = ep.get("src")
            if isinstance(src, str) and src.strip():
                clean_src = src.strip()
                seen.add(clean_src)
                yield {
                    "category": str(cat_name) if cat_name is not None else "",
                    "episodeTitle": ep_title,
                    "src": clean_src,
                    "isPlaceholder": bool(ep.get("isPlaceholder")),
                    "unavailableReason": ep.get("unavailableReason"),
                    "unavailableCheckedAt": ep.get("unavailableCheckedAt"),
                }

            for parts_key in ("sources", "parts", "items", "__separatedParts"):
                parts = ep.get(parts_key)
                if not isinstance(parts, list):
                    continue
                for part_idx, part in enumerate(parts, start=1):
                    if not isinstance(part, dict):
                        continue
                    part_src = part.get("src")
                    if not isinstance(part_src, str) or not part_src.strip():
                        continue
                    clean_part_src = part_src.strip()
                    if clean_part_src in seen:
                        continue
                    seen.add(clean_part_src)
                    part_title = str(part.get("title") or f"Part {part_idx}")
                    label = f"{ep_title} / {part_title}" if ep_title else part_title
                    yield {
                        "category": str(cat_name) if cat_name is not None else "",
                        "episodeTitle": label,
                        "src": clean_part_src,
                        "isPlaceholder": bool(ep.get("isPlaceholder")),
                        "unavailableReason": ep.get("unavailableReason"),
                        "unavailableCheckedAt": ep.get("unavailableCheckedAt"),
                    }


def parse_playlist_targets(playlist_path: str) -> Tuple[Optional[List[str]], Optional[str]]:
    try:
        with open(playlist_path, "r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except Exception as exc:
        return None, str(exc)

    targets: List[str] = []
    playlist_dir = os.path.dirname(playlist_path)
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if is_http_url(line):
            targets.append(line)
            continue
        targets.append(os.path.abspath(os.path.join(playlist_dir, line)))

    if not targets:
        return None, "Playlist did not contain any media targets"
    return targets, None


def urllib_check_url(
    url: str,
    timeout: float,
    treat_401_ok: bool,
    treat_403_ok: bool,
    user_agent: str = "mm-src-checker/1.2",
) -> Dict[str, Any]:
    def do_req(method: str, headers: Dict[str, str]) -> Tuple[int, str]:
        req = urllib.request.Request(url, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.geturl()

    try:
        status, final_url = do_req("HEAD", {"User-Agent": user_agent})
        return {
            "ok": normalize_status_ok(status, treat_401_ok, treat_403_ok),
            "status": status,
            "method": "HEAD",
            "final_url": final_url,
            "error": None,
            "failureType": None if normalize_status_ok(status, treat_401_ok, treat_403_ok) else "http",
            "checker": "urllib",
        }
    except urllib.error.HTTPError as exc:
        status = getattr(exc, "code", None)
        if status in (403, 405):
            try:
                status2, final_url2 = do_req(
                    "GET",
                    {
                        "User-Agent": user_agent,
                        "Range": "bytes=0-0",
                    },
                )
                return {
                    "ok": normalize_status_ok(status2, treat_401_ok, treat_403_ok),
                    "status": status2,
                    "method": "GET range",
                    "final_url": final_url2,
                    "error": None,
                    "failureType": None if normalize_status_ok(status2, treat_401_ok, treat_403_ok) else "http",
                    "checker": "urllib",
                }
            except urllib.error.HTTPError as exc2:
                status2 = getattr(exc2, "code", None)
                body2 = None
                try:
                    body2 = exc2.read().decode("utf-8", "replace")[:500]
                except Exception:
                    body2 = str(exc2)
                return {
                    "ok": normalize_status_ok(status2, treat_401_ok, treat_403_ok),
                    "status": status2,
                    "method": "GET range",
                    "final_url": None,
                    "error": body2,
                    "failureType": None if normalize_status_ok(status2, treat_401_ok, treat_403_ok) else "http",
                    "checker": "urllib",
                }
            except Exception as exc2:
                return {
                    "ok": False,
                    "status": None,
                    "method": "GET range",
                    "final_url": None,
                    "error": str(exc2),
                    "failureType": "transport",
                    "checker": "urllib",
                }

        body = None
        try:
            body = exc.read().decode("utf-8", "replace")[:500]
        except Exception:
            body = str(exc)
        return {
            "ok": normalize_status_ok(status, treat_401_ok, treat_403_ok),
            "status": status,
            "method": "HEAD",
            "final_url": None,
            "error": body,
            "failureType": None if normalize_status_ok(status, treat_401_ok, treat_403_ok) else "http",
            "checker": "urllib",
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": None,
            "method": "HEAD",
            "final_url": None,
            "error": str(exc),
            "failureType": "transport",
            "checker": "urllib",
        }


def curl_check_url(
    url: str,
    timeout: float,
    treat_401_ok: bool,
    treat_403_ok: bool,
) -> Optional[Dict[str, Any]]:
    curl_bin = shutil.which("curl")
    if not curl_bin:
        return None

    def run_curl(args: List[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=max(5, int(timeout) + 5),
            check=False,
        )

    def parse_result(proc: subprocess.CompletedProcess[str], method: str) -> Dict[str, Any]:
        raw = (proc.stdout or "").strip()
        status_text, final_url = (raw.split("\t", 1) + [url])[:2] if raw else ["000", url]
        status = int(status_text) if status_text.isdigit() else None
        ok = normalize_status_ok(status, treat_401_ok, treat_403_ok)
        failure_type = None
        if not ok:
            failure_type = "transport" if status in (None, 0) else "http"
        error = (proc.stderr or "").strip() or None
        if proc.returncode != 0 and not error:
            error = f"curl exited {proc.returncode}"
        return {
            "ok": ok,
            "status": status,
            "method": method,
            "final_url": final_url,
            "error": error,
            "failureType": failure_type,
            "checker": "curl",
        }

    def build_head_args() -> List[str]:
        return [
            curl_bin,
            "-I",
            "-L",
            "--max-time",
            str(timeout),
            "--silent",
            "--show-error",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}\t%{url_effective}",
            url,
        ]

    head_proc = run_curl(build_head_args())
    head_result = parse_result(head_proc, "HEAD via curl")
    if head_result["ok"] or head_result["status"] not in (None, 0, 403, 405):
        return head_result

    get_proc = run_curl(
        [
            curl_bin,
            "-L",
            "--range",
            "0-0",
            "--max-time",
            str(timeout),
            "--silent",
            "--show-error",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}\t%{url_effective}",
            url,
        ]
    )
    get_result = parse_result(get_proc, "GET range via curl")

    # Some hosts on this machine intermittently reject the ranged probe even
    # when a follow-up HEAD resolves cleanly. In that case we prefer the stable
    # HEAD success over a one-off ranged 404.
    if not get_result["ok"] and get_result.get("status") == 404:
        confirm_head = parse_result(run_curl(build_head_args()), "HEAD via curl (confirm)")
        if confirm_head["ok"]:
            confirm_head["probeWarning"] = "GET range probe returned 404 after initial curl fallback"
            return confirm_head

    return get_result


def http_check_url(
    url: str,
    timeout: float,
    treat_401_ok: bool,
    treat_403_ok: bool,
) -> Dict[str, Any]:
    primary = urllib_check_url(url, timeout, treat_401_ok, treat_403_ok)
    if primary.get("ok") or primary.get("failureType") == "http":
        return primary

    curl_result = curl_check_url(url, timeout, treat_401_ok, treat_403_ok)
    if curl_result is None:
        primary["error"] = (
            f"{primary.get('error') or 'transport failure'} (curl unavailable for fallback)"
        )
        return primary

    curl_result["fallbackFrom"] = primary.get("checker")
    curl_result["fallbackError"] = primary.get("error")
    return curl_result


def make_failure(
    category: str,
    episode_title: str,
    src: str,
    result: Dict[str, Any],
    playlist_ref: Optional[str] = None,
    local_path: Optional[str] = None,
) -> Dict[str, Any]:
    item = {
        "category": category,
        "episodeTitle": episode_title,
        "src": src,
        "status": result.get("status"),
        "method": result.get("method"),
        "error": result.get("error"),
        "failureType": result.get("failureType"),
        "checker": result.get("checker"),
    }
    if playlist_ref:
        item["playlist"] = playlist_ref
    if local_path:
        item["localPath"] = local_path
    return item


def build_placeholder_failure(
    category: str,
    episode_title: str,
    src: str,
    reason: Optional[str],
    checked_at: Optional[str],
    base_file: str,
    repo_root: str,
) -> Dict[str, Any]:
    playlist_ref: Optional[str] = None
    local_path: Optional[str] = None
    target = src

    if not is_http_url(src):
        resolved_path = resolve_local_path(src, base_file, repo_root)
        local_path = resolved_path
        if resolved_path.lower().endswith(".m3u8") and os.path.exists(resolved_path):
            playlist_ref = src
            targets, _ = parse_playlist_targets(resolved_path)
            if targets:
                target = str(targets[0])

    failure = make_failure(
        category,
        episode_title,
        target,
        {
            "status": 404,
            "method": "manifest placeholder",
            "error": reason or "Marked unavailable in manifest",
            "failureType": "http",
            "checker": "manifest",
        },
        playlist_ref=playlist_ref,
        local_path=local_path,
    )
    failure["confirmedUnavailable"] = True
    if isinstance(reason, str) and reason.strip():
        failure["unavailableReason"] = reason.strip()
    if isinstance(checked_at, str) and checked_at.strip():
        failure["unavailableCheckedAt"] = checked_at.strip()
    return failure


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Validate Media-Manager source refs, including local playlist files, "
            "remote URLs, and placeholder-marked unavailable entries."
        )
    )
    ap.add_argument("--dir", required=True, help="Directory containing source JSON files (scanned recursively)")
    ap.add_argument("--out", default=None, help="Output report JSON path (default: ./mm-src-url-report.json)")
    ap.add_argument("--concurrency", type=int, default=16)
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--treat-401-ok", action="store_true", help="Treat HTTP 401 as OK (reachable but protected)")
    ap.add_argument("--treat-403-ok", action="store_true", help="Treat HTTP 403 as OK (reachable but forbidden)")
    args = ap.parse_args(argv)

    root = expand(args.dir)
    out_path = expand(args.out) if args.out else os.path.abspath("mm-src-url-report.json")
    repo_root = os.getcwd()

    files = find_json_files(root)
    eprint(f"Found {len(files)} JSON files under: {root}")

    report: Dict[str, Any] = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dir": root,
        "counts": {
            "jsonFiles": len(files),
            "sourcesParsed": 0,
            "srcRefsFound": 0,
            "checksRun": 0,
            "badRefs": 0,
            "httpFailures": 0,
            "transportFailures": 0,
            "localFailures": 0,
            "knownUnavailableRefs": 0,
            "playlistRefs": 0,
            "playlistTargets": 0,
            "parseErrors": 0,
        },
        "sources": [],
    }

    tasks_by_file: Dict[str, List[Dict[str, Any]]] = {}
    known_unavailable_by_file: Dict[str, List[Dict[str, Any]]] = {}
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
        parsed_meta[fp] = {"file": fp, "title": obj.get("title")}
        per_file_tasks: List[Dict[str, Any]] = []

        known_failures: List[Dict[str, Any]] = []

        for entry in iter_episode_srcs(obj):
            cat = str(entry.get("category") or "")
            ep_title = str(entry.get("episodeTitle") or "")
            src = str(entry.get("src") or "")
            report["counts"]["srcRefsFound"] += 1
            if entry.get("isPlaceholder"):
                known_failures.append(
                    build_placeholder_failure(
                        cat,
                        ep_title,
                        src,
                        entry.get("unavailableReason"),
                        entry.get("unavailableCheckedAt"),
                        fp,
                        repo_root,
                    )
                )
                report["counts"]["badRefs"] += 1
                report["counts"]["httpFailures"] += 1
                report["counts"]["knownUnavailableRefs"] += 1
                continue

            if is_http_url(src):
                per_file_tasks.append(
                    {
                        "category": cat,
                        "episodeTitle": ep_title,
                        "target": src,
                        "targetType": "remote",
                    }
                )
                continue

            resolved_path = resolve_local_path(src, fp, repo_root)
            if not os.path.exists(resolved_path):
                per_file_tasks.append(
                    {
                        "category": cat,
                        "episodeTitle": ep_title,
                        "target": src,
                        "targetType": "missing-local",
                        "localPath": resolved_path,
                    }
                )
                continue

            if resolved_path.lower().endswith(".m3u8"):
                report["counts"]["playlistRefs"] += 1
                targets, playlist_err = parse_playlist_targets(resolved_path)
                if playlist_err:
                    per_file_tasks.append(
                        {
                            "category": cat,
                            "episodeTitle": ep_title,
                            "target": src,
                            "targetType": "playlist-parse-error",
                            "localPath": resolved_path,
                            "parseError": playlist_err,
                        }
                    )
                    continue
                assert targets is not None
                report["counts"]["playlistTargets"] += len(targets)
                for playlist_target in targets:
                    per_file_tasks.append(
                        {
                            "category": cat,
                            "episodeTitle": ep_title,
                            "target": playlist_target,
                            "targetType": "remote" if is_http_url(playlist_target) else "local",
                            "playlist": src,
                            "localPath": None if is_http_url(playlist_target) else playlist_target,
                        }
                    )
                continue

            per_file_tasks.append(
                {
                    "category": cat,
                    "episodeTitle": ep_title,
                    "target": src,
                    "targetType": "local",
                    "localPath": resolved_path,
                }
            )

        tasks_by_file[fp] = per_file_tasks
        known_unavailable_by_file[fp] = known_failures

    total_checks = sum(len(v) for v in tasks_by_file.values())
    eprint(f"Total checks queued: {total_checks}")

    per_file: Dict[str, Dict[str, Any]] = {}
    for fp, meta in parsed_meta.items():
        per_file[fp] = {
            "file": fp,
            "title": meta.get("title"),
            "checked": 0,
            "badCount": len(known_unavailable_by_file.get(fp) or []),
            "failures": list(known_unavailable_by_file.get(fp) or []),
        }

    def check_one(fp: str, task: Dict[str, Any], idx: int, total_in_file: int) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
        label = task.get("episodeTitle") or "Item"
        target = task.get("target") or ""
        eprint(f"  [CHECK] ({idx}/{total_in_file}) {label} :: {target}")

        target_type = task.get("targetType")
        if target_type == "missing-local":
            result = {
                "ok": False,
                "status": None,
                "method": "local file",
                "final_url": None,
                "error": "Referenced local file is missing",
                "failureType": "local",
                "checker": "filesystem",
            }
            return fp, task, result

        if target_type == "playlist-parse-error":
            result = {
                "ok": False,
                "status": None,
                "method": "playlist parse",
                "final_url": None,
                "error": task.get("parseError"),
                "failureType": "local",
                "checker": "filesystem",
            }
            return fp, task, result

        if target_type == "local":
            exists = bool(task.get("localPath")) and os.path.exists(str(task.get("localPath")))
            result = {
                "ok": exists,
                "status": None,
                "method": "local file",
                "final_url": None,
                "error": None if exists else "Referenced local file is missing",
                "failureType": None if exists else "local",
                "checker": "filesystem",
            }
            return fp, task, result

        result = http_check_url(
            str(task.get("target")),
            args.timeout,
            args.treat_401_ok,
            args.treat_403_ok,
        )
        return fp, task, result

    start = time.time()

    with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures: List[cf.Future] = []
        for fp in sorted(tasks_by_file.keys()):
            title = per_file[fp].get("title") or os.path.basename(fp)
            srcs = tasks_by_file[fp]
            eprint(f"\n[SOURCE-BEGIN] {title} ({len(srcs)} checks)\n  file={fp}")
            for i, task in enumerate(srcs, start=1):
                futures.append(ex.submit(check_one, fp, task, i, len(srcs)))

        done_by_file: Dict[str, int] = {fp: 0 for fp in tasks_by_file.keys()}
        total_by_file: Dict[str, int] = {fp: len(srcs) for fp, srcs in tasks_by_file.items()}

        for fut in cf.as_completed(futures):
            fp, task, result = fut.result()
            report["counts"]["checksRun"] += 1
            per_file[fp]["checked"] += 1
            done_by_file[fp] += 1

            ok = bool(result.get("ok"))
            status = result.get("status")
            method = result.get("method")
            label = task.get("episodeTitle") or "Item"

            if ok:
                eprint(f"  [OK]    {status} {method} :: {label}")
            else:
                report["counts"]["badRefs"] += 1
                failure_type = result.get("failureType")
                if failure_type == "http":
                    report["counts"]["httpFailures"] += 1
                elif failure_type == "transport":
                    report["counts"]["transportFailures"] += 1
                else:
                    report["counts"]["localFailures"] += 1

                per_file[fp]["badCount"] += 1
                per_file[fp]["failures"].append(
                    make_failure(
                        str(task.get("category") or ""),
                        str(task.get("episodeTitle") or ""),
                        str(task.get("target") or ""),
                        result,
                        playlist_ref=task.get("playlist"),
                        local_path=task.get("localPath"),
                    )
                )
                eprint(f"  [FAIL]  {status} {method} :: {label}")

            if done_by_file[fp] == total_by_file[fp]:
                title = per_file[fp].get("title") or os.path.basename(fp)
                eprint(f"[SOURCE-DONE] {title} :: checked={per_file[fp]['checked']} bad={per_file[fp]['badCount']}")

    for fp in sorted(per_file.keys()):
        report["sources"].append(per_file[fp])

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    summary_path = re.sub(r"\.json$", ".summary.txt", out_path, flags=re.I)
    bad_sources = [s for s in report["sources"] if isinstance(s, dict) and s.get("badCount", 0) > 0]

    lines: List[str] = []
    lines.append(f"Generated: {report['generatedAt']}")
    lines.append(f"Dir: {root}")
    lines.append(f"JSON files: {report['counts']['jsonFiles']}")
    lines.append(f"Sources parsed: {report['counts']['sourcesParsed']}")
    lines.append(f"Source refs found: {report['counts']['srcRefsFound']}")
    lines.append(f"Checks run: {report['counts']['checksRun']}")
    lines.append(f"Playlist refs: {report['counts']['playlistRefs']}")
    lines.append(f"Playlist targets: {report['counts']['playlistTargets']}")
    lines.append(f"Bad refs: {report['counts']['badRefs']}")
    lines.append(f"HTTP failures: {report['counts']['httpFailures']}")
    lines.append(f"Transport failures: {report['counts']['transportFailures']}")
    lines.append(f"Local failures: {report['counts']['localFailures']}")
    lines.append(f"Confirmed unavailable refs: {report['counts']['knownUnavailableRefs']}")
    lines.append(f"Elapsed: {time.time() - start:.1f}s")
    lines.append("")
    lines.append(f"Sources with failures: {len(bad_sources)}")

    for source in sorted(bad_sources, key=lambda x: x.get("badCount", 0), reverse=True)[:100]:
        title = source.get("title") or os.path.basename(source["file"])
        bad_count = int(source.get("badCount", 0) or 0)
        lines.append(f"- {title}: {bad_count} bad")

        for failure in source.get("failures") or []:
            ep = (failure.get("episodeTitle") or "").strip() or "?"
            cat = (failure.get("category") or "").strip()
            status = failure.get("status")
            method = failure.get("method") or ""
            checker = failure.get("checker") or "unknown"
            failure_type = failure.get("failureType") or "unknown"
            item_label = f"{cat} :: {ep}" if cat and cat not in ep else ep
            playlist_suffix = f" via {failure['playlist']}" if failure.get("playlist") else ""
            lines.append(f"    - {item_label} :: {failure_type} :: {status} {method} [{checker}]{playlist_suffix}")

    with open(summary_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")

    eprint(f"\nWrote {out_path}")
    eprint(f"Wrote {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
