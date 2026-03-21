#!/usr/bin/env python3
"""Convert Copyparty folder listings (the JSON from `?ls`) into a Media-Manager source JSON.

This is meant for *video folders* where filenames contain episode markers like S01E25.

You can build a source from ONE folder or MULTIPLE folders (multiple categories).

Examples:
  # Fetch from one copyparty folder and emit a Media-Manager source
  python3 copyparty_listing_to_mm_source.py \
    --url "https://cpr.xpbliss.fyi/pub/MM/Kusuriya/" \
    --pw "me@alexspac.es" \
    --title "Kusuriya no Hitorigoto" \
    --pretty \
    --out ~/Downloads/Kusuriya.json

  # Multiple folders -> multiple categories.
  # Category names default to: Season 1, Season 2, ... in the order provided.
  python3 copyparty_listing_to_mm_source.py \
    --title "Kusuriya no Hitorigoto" \
    --pw "me@alexspac.es" \
    --folder "https://cpr.xpbliss.fyi/pub/MM/Kusuriya/S1/" \
    --folder "https://cpr.xpbliss.fyi/pub/MM/Kusuriya/S2/" \
    --pretty --out ~/Downloads/Kusuriya.json

  # Override category name per folder using =NAME
  python3 copyparty_listing_to_mm_source.py \
    --title "Kusuriya no Hitorigoto" \
    --pw "me@alexspac.es" \
    --folder "https://cpr.xpbliss.fyi/pub/MM/Kusuriya/S1/=Season 1" \
    --folder "https://cpr.xpbliss.fyi/pub/MM/Kusuriya/NCOP/=OP/ED" \
    --pretty --out ~/Downloads/Kusuriya.json

  # Convert a saved response
  python3 copyparty_listing_to_mm_source.py \
    --in listing.json \
    --base "https://cpr.xpbliss.fyi/pub/MM/Kusuriya/" \
    --title "Kusuriya no Hitorigoto" \
    --out ~/Downloads/Kusuriya.json

Output schema matches existing Media-Manager Sources/Files/Anime/*.json:
  { "title": str, "categories": [ {"category": "Season N", "episodes": [ ... ]} ] }

Episode objects:
  { "title": "Episode X", "src": <url>, "fileSizeBytes": int, "durationSeconds": int }

Notes:
- We keep Copyparty's `href` exactly as-is (already URL-encoded) and join it onto the folder URL.
- Duration seconds is derived from tags[".dur"] when present; it is rounded to nearest int.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.error


SE_RE = re.compile(r"\bS(?P<season>\d{1,2})E(?P<ep>\d{1,3})\b", re.IGNORECASE)


def _parse_folder_spec(spec: str) -> tuple[str, str | None]:
    """Parse --folder spec: URL or URL=NAME."""
    if "=" in spec:
        url, name = spec.split("=", 1)
        url = url.strip()
        name = name.strip() or None
        return url, name
    return spec.strip(), None


def _norm_base(base: str) -> str:
    # Ensure scheme/netloc exist and path ends with /
    u = urllib.parse.urlsplit(base)
    if not u.scheme or not u.netloc:
        raise ValueError(f"--base/--url must be an absolute URL (got: {base!r})")
    path = u.path or "/"
    if not path.endswith("/"):
        path += "/"
    # Drop query/fragment for base join.
    return urllib.parse.urlunsplit((u.scheme, u.netloc, path, "", ""))


def _build_ls_url(url: str) -> str:
    # Use same flags as u2c.py: ?ls&lt&dots
    u = urllib.parse.urlsplit(url)
    path = u.path or "/"
    if not path.endswith("/"):
        path += "/"

    q = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
    q = [(k, v) for (k, v) in q if k not in ("ls", "lt", "dots")]
    q += [("ls", ""), ("lt", ""), ("dots", "")]
    query = urllib.parse.urlencode(q, doseq=True)
    return urllib.parse.urlunsplit((u.scheme, u.netloc, path, query, u.fragment))


def fetch_ls_json(url: str, pw: str | None, timeout: float = 30.0) -> dict:
    ls_url = _build_ls_url(url)
    req = urllib.request.Request(ls_url, method="GET")
    req.add_header("Accept", "application/json, */*")
    req.add_header("User-Agent", "copyparty_listing_to_mm_source.py")
    if pw:
        req.add_header("PW", pw)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        return json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code} fetching {ls_url}\n{body}".rstrip())
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error fetching {ls_url}: {e}")


def _file_to_episode_obj(f: dict, folder_url: str) -> dict | None:
    """Turn one copyparty file JSON object into a (partially filled) Media-Manager episode object."""
    base = _norm_base(folder_url)

    href = f.get("href")
    if not href or not isinstance(href, str):
        return None

    decoded = urllib.parse.unquote(href)
    m = SE_RE.search(decoded)

    sz = f.get("sz")
    tags = f.get("tags") or {}

    dur = tags.get(".dur")
    dur_s = None
    if isinstance(dur, (int, float)):
        dur_s = int(round(dur))

    ep_obj: dict = {
        "title": "Episode 1",  # temporary; fixed later
        "src": urllib.parse.urljoin(base, href),
        "_href": href,
    }
    if isinstance(sz, int):
        ep_obj["fileSizeBytes"] = sz
    if dur_s is not None:
        ep_obj["durationSeconds"] = dur_s

    if m:
        ep_obj["_season"] = int(m.group("season"))
        ep_obj["_ep"] = int(m.group("ep"))

    return ep_obj


def _sort_eps(ep_objs: list[dict]) -> list[dict]:
    def k(ep: dict):
        ep_no = ep.get("_ep")
        href = ep.get("_href") or ""
        return (
            ep_no is None,
            ep_no if isinstance(ep_no, int) else 10**9,
            href,
        )

    return sorted(ep_objs, key=k)


def listing_to_category(listing: dict, folder_url: str, category_name: str) -> dict:
    files = listing.get("files") or []
    eps = [x for x in (_file_to_episode_obj(f, folder_url) for f in files) if x]
    eps = _sort_eps(eps)
    return {"category": category_name, "episodes": eps}


def listing_to_categories_by_season(listing: dict, folder_url: str) -> list[dict]:
    """Split one folder listing into multiple categories based on SxxEyy in filenames."""
    files = listing.get("files") or []

    by_cat: dict[str, list[dict]] = {}

    for f in files:
        ep = _file_to_episode_obj(f, folder_url)
        if not ep:
            continue

        s = ep.get("_season")
        if isinstance(s, int):
            cname = f"Season {s}"
        else:
            cname = "Season 1"

        by_cat.setdefault(cname, []).append(ep)

    out = []
    # Seasons in numeric order; Specials last.
    season_nums = sorted(
        [int(k.split(" ", 1)[1]) for k in by_cat.keys() if k.startswith("Season ")]
    )
    for s in season_nums:
        cname = f"Season {s}"
        out.append({"category": cname, "episodes": _sort_eps(by_cat.get(cname, []))})

    if "Specials" in by_cat:
        out.append({"category": "Specials", "episodes": _sort_eps(by_cat["Specials"])})

    return out


def _format_se(season: int, ep: int) -> str:
    # Season is intentionally ignored in the label; we only use it to find `ep` reliably.
    # This keeps episode titles like "Episode 1" rather than "Episode S02E01".
    return str(ep)


def _apply_episode_numbering(source: dict, mode: str) -> None:
    """Mutates `source` in-place.

    mode:
      - category: Episode 1..N within each category
      - global: Episode 1..N across the whole source (category order)
      - se: Episode S02E01 (from filename markers when available)
    """

    if mode not in ("category", "global", "se"):
        raise ValueError(f"bad episode numbering mode: {mode}")

    g = 0
    for cat in source.get("categories", []):
        c = 0
        for ep in cat.get("episodes", []):
            c += 1
            g += 1

            if mode == "category":
                label = str(c)
            elif mode == "global":
                label = str(g)
            else:
                s = ep.get("_season")
                e = ep.get("_ep")
                if isinstance(s, int) and isinstance(e, int):
                    label = _format_se(s, e)
                else:
                    # fallback if filename didn't contain SxxExx
                    label = str(c)

            ep["title"] = f"Episode {label}"

            # Strip internal metadata
            ep.pop("_season", None)
            ep.pop("_ep", None)
            ep.pop("_href", None)


def listings_to_mm_source(
    listings: list[tuple[dict, str, str]],
    title: str,
    episode_numbering: str,
    split_by_season: bool,
) -> dict:
    """listings: [(listing_json, folder_url, category_name), ...]"""

    if not split_by_season:
        categories = [listing_to_category(j, folder_url=u, category_name=cn) for (j, u, cn) in listings]
        out = {"title": title, "categories": categories}
        _apply_episode_numbering(out, episode_numbering)
        return out

    # Merge categories across all listings, splitting by season from filename.
    merged: dict[str, list[dict]] = {}

    for (j, folder_url, _cn) in listings:
        cats = listing_to_categories_by_season(j, folder_url)
        for cat in cats:
            cname = cat["category"]
            merged.setdefault(cname, []).extend(cat.get("episodes", []))

    # Build final categories in order Season 1..N (if present), then other categories.
    seasons = []
    others = []
    for cname in merged.keys():
        if cname.startswith("Season "):
            try:
                seasons.append(int(cname.split(" ", 1)[1]))
            except Exception:
                others.append(cname)
        else:
            others.append(cname)

    seasons = sorted(set(seasons))
    ordered = [f"Season {s}" for s in seasons]

    # Put Specials last if present; otherwise alpha for remaining.
    other_unique = sorted(set([x for x in others if x != "Specials"]))
    ordered += other_unique
    if "Specials" in merged:
        ordered.append("Specials")

    categories = [{"category": cname, "episodes": _sort_eps(merged.get(cname, []))} for cname in ordered if cname in merged]

    out = {"title": title, "categories": categories}
    _apply_episode_numbering(out, episode_numbering)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()

    # New preferred mode: multiple folders -> multiple categories
    ap.add_argument(
        "--folder",
        action="append",
        help='Copyparty folder URL, optionally with category override: "URL=Season 1". Repeatable.',
    )

    # Legacy single-folder / saved-json mode
    src = ap.add_mutually_exclusive_group(required=False)
    src.add_argument("--url", help="Copyparty folder URL to fetch (will call ?ls)")
    src.add_argument("--in", dest="in_path", help="Path to a saved copyparty ?ls JSON")

    ap.add_argument("--pw", default=None, help="Copyparty password (sent as PW header) when fetching")
    ap.add_argument("--timeout", type=float, default=30.0)

    ap.add_argument("--base", help="Base URL for src links (required when using --in).")
    ap.add_argument("--category", help="Category name override when using --url or --in (single-category output).")

    ap.add_argument("--title", required=True, help="Media-Manager source title")

    ap.add_argument(
        "--episode-numbering",
        choices=["category", "global", "se"],
        default="category",
        help="How to number Episode X titles: category (default), global, or se (use filename's SxxExx but label as just the episode number).",
    )

    ap.add_argument(
        "--split-by-season",
        action="store_true",
        help="If set, files containing SxxEyy will be placed into category 'Season xx' based on the filename (merged across all folders).",
    )

    ap.add_argument("--out", default=None, help="Write output JSON to this file (otherwise prints)")
    ap.add_argument("--pretty", action="store_true")

    args = ap.parse_args(argv)

    listings: list[tuple[dict, str, str]] = []

    if args.folder:
        for idx, spec in enumerate(args.folder, start=1):
            url, cname = _parse_folder_spec(spec)
            cname = cname or f"Season {idx}"
            j = fetch_ls_json(url, args.pw, timeout=args.timeout)
            listings.append((j, url, cname))

    elif args.url or args.in_path:
        # Backwards compatible: build exactly ONE category from one listing
        if args.url:
            j = fetch_ls_json(args.url, args.pw, timeout=args.timeout)
            base = args.base or args.url
        else:
            with open(args.in_path, "r", encoding="utf-8") as f:
                j = json.load(f)
            if not args.base:
                raise SystemExit("--base is required when using --in")
            base = args.base

        cname = args.category or "Season 1"
        listings.append((j, base, cname))

    else:
        raise SystemExit("Provide either --folder (repeatable) OR one of --url/--in")

    if args.split_by_season and len(listings) != 1:
        raise SystemExit("--split-by-season only works when exactly one folder/listing is provided")

    out_obj = listings_to_mm_source(
        listings,
        title=args.title,
        episode_numbering=args.episode_numbering,
        split_by_season=args.split_by_season,
    )

    s = json.dumps(out_obj, indent=2 if args.pretty else None, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(s)
            f.write("\n")
    else:
        sys.stdout.write(s + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
