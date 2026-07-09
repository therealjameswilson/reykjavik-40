#!/usr/bin/env python3
"""
Fetch participant portraits for the Höfði House / person cards and emit
docs/data/portraits.json (also mirrored to data/portraits.json).

Provenance model
----------------
The edition holds itself to documented, freely-licensed sources. Rather than
hard-code image URLs and assert a licence, this script is driven by a curated
table of Wikimedia Commons *File:* pages (SOURCES below). For each file it
queries the MediaWiki API for the real download URL together with the licence,
author, and credit Commons records, and it KEEPS ONLY files whose licence is on
the free-licence allowlist (public domain, CC0, CC BY, CC BY-SA). Anything
non-free — or any File page that cannot be resolved — is skipped with a warning
and simply left out of the manifest. The person card renders a portrait only
where an entry exists and its image actually loads, so partial coverage is safe.

Because coverage is uneven by design, the seed table is deliberately limited to
figures with a well-established free-licensed portrait. Interpreters, notetakers
and several delegation members have no such image and are intentionally absent.
Add rows as verified; re-run to (re)emit the manifest.

Usage:
    python3 scripts/fetch_portraits.py

Network access to commons.wikimedia.org / upload.wikimedia.org is required.
Review the emitted portraits.json — the credit/licence fields are taken
verbatim from Commons and belong on screen with each face.
"""

from __future__ import annotations
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image  # optional: only used to shrink/centre-crop
except ImportError:
    Image = None

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DOCS_DATA = ROOT / "docs" / "data"
PORTRAITS_DIR = ROOT / "docs" / "assets" / "photos" / "portraits"
SITE_PREFIX = "assets/photos/portraits"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

# Licences we accept. Matched case-insensitively as substrings of the
# LicenseShortName Commons returns (e.g. "Public domain", "CC0", "CC BY-SA 3.0").
FREE_LICENCES = ("public domain", "pd-", "cc0", "cc by")

# person id (canonical, from data/summit_stage.json) -> candidate Commons File
# pages, best first. The File names below were located on Wikimedia Commons;
# the script tries each in turn and keeps the FIRST that both resolves and
# reports a free licence, so a stale or renamed candidate falls through to the
# next rather than dropping the person. Add or reorder candidates as needed.
SOURCES = [
    {"id": "reagan_gorbachev.reagan", "name": "President Reagan", "files": [
        "File:Official Portrait of President Reagan 1981.jpg",
        "File:Ronald Reagan 1981 presidential portrait.jpg"]},
    {"id": "us.shultz", "name": "Secretary of State George Shultz", "files": [
        "File:George Pratt Shultz.jpg",
        "File:George P. Shultz.jpg"]},
    {"id": "us.poindexter", "name": "Vice Adm. John Poindexter", "files": [
        "File:Admiral John Poindexter, official Navy photo, 1985.JPEG"]},
    {"id": "us.nitze", "name": "Paul Nitze", "files": [
        "File:Paul Nitze as SECNAV c1963.jpg",
        "File:Nitze, Paul.jpg",
        "File:Paul Nitze.jpeg"]},
    {"id": "us.perle", "name": "Richard Perle", "files": [
        "File:Richard Perle (cropped) (2).jpg",
        "File:Richard Perle (cropped).jpg"]},
    {"id": "us.matlock", "name": "Ambassador Jack Matlock", "files": [
        "File:Jack F Matlock, Jr.jpg",
        "File:Jack Matlock 19860107.jpg"]},
    {"id": "reagan_gorbachev.gorbachev", "name": "General Secretary Gorbachev", "files": [
        "File:RIAN archive 850809 General Secretary of the CPSU CC M. Gorbachev (cropped).jpg",
        "File:RIAN archive 485307 Mikhail Gorbachev.jpg"]},
    {"id": "ussr.shevardnadze", "name": "Foreign Minister Shevardnadze", "files": [
        "File:Eduard shevardnadze.jpg",
        "File:Eduard Schewardnadse.jpg"]},
    {"id": "person.primakov-evgeniy", "name": "Yevgeny Primakov", "files": [
        "File:RIAN archive 38725 Director of the USSR Central Intelligence Service Yevgeny Primakov.jpg"]},
]


def api_get(params: dict) -> dict:
    url = COMMONS_API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "reykjavik-40/1.0 (portraits)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "reykjavik-40/1.0 (portraits)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def plain(html_or_text: str) -> str:
    """Strip the light HTML Commons sometimes wraps Artist/Credit in."""
    import re
    return re.sub(r"<[^>]+>", "", html_or_text or "").replace("\n", " ").strip()


def resolve(file_page: str) -> dict | None:
    """Return {image_url, license, license_url, artist, credit, source_url} or None."""
    data = api_get({
        "action": "query", "titles": file_page, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": 512,
    })
    pages = data.get("query", {}).get("pages", {})
    for _, page in pages.items():
        if "missing" in page or "imageinfo" not in page:
            return None
        info = page["imageinfo"][0]
        meta = info.get("extmetadata", {})
        get = lambda k: (meta.get(k) or {}).get("value", "")
        return {
            "image_url": info.get("thumburl") or info.get("url"),
            "license": plain(get("LicenseShortName")),
            "license_url": get("LicenseUrl"),
            "artist": plain(get("Artist")),
            "credit": plain(get("Credit")),
            "source_url": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(file_page)}",
        }
    return None


def is_free(licence: str) -> bool:
    low = (licence or "").lower()
    return any(tok in low for tok in FREE_LICENCES)


def main() -> int:
    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)
    portraits: dict[str, dict] = {}
    skipped: list[str] = []

    for src in SOURCES:
        pid, name = src["id"], src["name"]
        candidates = src.get("files") or ([src["file"]] if src.get("file") else [])
        print(f"[fetch_portraits] {pid}")
        # Try each candidate File page; keep the first that resolves free.
        meta = None
        reasons = []
        for file_page in candidates:
            try:
                m = resolve(file_page)
            except Exception as e:  # network / API error
                reasons.append(f"{file_page}: resolve error ({e})")
                continue
            if not m or not m["image_url"]:
                reasons.append(f"{file_page}: missing on Commons")
                continue
            if not is_free(m["license"]):
                reasons.append(f"{file_page}: non-free ({m['license']})")
                continue
            meta = m
            print(f"  using {file_page}")
            break
        if not meta:
            for r in reasons:
                print(f"  - {r}")
            skipped.append(f"{pid}: no free candidate ({'; '.join(reasons) or 'none listed'})")
            continue

        fname = f"{pid.replace('.', '_')}.jpg"
        dst = PORTRAITS_DIR / fname
        try:
            raw = fetch_bytes(meta["image_url"])
        except Exception as e:
            print(f"  ! download failed ({e}); skipping")
            skipped.append(f"{pid}: download failed")
            continue
        dst.write_bytes(raw)
        # Optional: centre-crop to a square and shrink, if Pillow is present.
        if Image is not None:
            try:
                im = Image.open(dst).convert("RGB")
                w, h = im.size
                s = min(w, h)
                im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
                im.thumbnail((320, 320))
                im.save(dst, "JPEG", quality=85, optimize=True)
            except Exception as e:
                print(f"  . kept original (crop skipped: {e})")

        # Credit line for the card: prefer explicit Credit, fall back to Artist.
        credit_bits = [b for b in (meta["credit"] or meta["artist"], meta["license"]) if b]
        portraits[pid] = {
            "id": pid,
            "name": name,
            "credit": " · ".join(credit_bits) if credit_bits else "Wikimedia Commons",
            "license": meta["license"],
            "license_url": meta["license_url"],
            "source_url": meta["source_url"],
            "filename": fname,
            "local_url": f"{SITE_PREFIX}/{fname}",
        }
        print(f"  ok  {meta['license']}  ({meta['image_url']})")

    payload = {
        "source_note": (
            "Participant portraits keyed by canonical person id. Images and their "
            "credit/licence are pulled from Wikimedia Commons by scripts/fetch_portraits.py "
            "and kept only under a free licence. Coverage is intentionally partial."
        ),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(portraits),
        "portraits": portraits,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    for out in (DATA_DIR / "portraits.json", DOCS_DATA / "portraits.json"):
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        print(f"  wrote {out.relative_to(ROOT)}")

    print(f"[fetch_portraits] {len(portraits)} portraits kept, {len(skipped)} skipped")
    for s in skipped:
        print(f"  skipped {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
