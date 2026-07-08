#!/usr/bin/env python3
"""
Fetch White House Photographic Office plates for the Reykjavik Summit from the
Ronald Reagan Presidential Library and Museum, save full-size and 640-pixel
thumbnails into docs/assets/photos/reagan/, and emit
docs/data/reagan_photos.json.

Gallery source:
    https://www.reaganlibrary.gov/archives/audiovisual/white-house-photo-collection-galleries/summits-mikhail-gorbachev

Runs deterministically from the manifest below; re-run to pick up changes on
the Library's page.
"""

from __future__ import annotations
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image  # type: ignore
except ImportError:
    Image = None

GALLERY_URL = (
    "https://www.reaganlibrary.gov/archives/audiovisual/"
    "white-house-photo-collection-galleries/summits-mikhail-gorbachev"
)
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DOCS_DATA = ROOT / "docs" / "data"
PHOTOS_DIR = ROOT / "docs" / "assets" / "photos" / "reagan"
THUMBS_DIR = PHOTOS_DIR / "thumbs"

# (id, date mm/dd/yyyy, caption, time-of-day anchor in the FRUS chronology)
PHOTOS = [
    ("C37401-8A",  "10/11/1986", "10:30",
     "President Reagan and Soviet General Secretary Gorbachev at the Hofdi House in Reykjavik, Iceland during the Reykjavik Summit."),
    ("C37401-14",  "10/11/1986", "10:30",
     "President Reagan and Soviet General Secretary Gorbachev at the Hofdi House in Reykjavik, Iceland during the Reykjavik Summit."),
    ("C37407-19",  "10/11/1986", "10:30",
     "President Reagan meeting with Soviet General Secretary Gorbachev for the first meeting at Hofdi House in Reykjavik, Iceland during the Reykjavik Summit."),
    ("C37406-14",  "10/11/1986", "10:30",
     "President Reagan meeting with Soviet General Secretary Gorbachev at Hofdi House during the Reykjavik Summit. Iceland."),
    ("C37408-16A", "10/11/1986", "11:15",
     "President Reagan and Soviet General Secretary Gorbachev meet at Hofdi House with Jack Matlock and translator Dmitry Zarechnak during the Reykjavik Summit. Iceland."),
    ("C37409-29",  "10/11/1986", "11:15",
     "President Reagan and Soviet General Secretary Gorbachev meet at Hofdi House with translator Dmitry Zarechnak and the Soviet translator during the Reykjavik Summit. Iceland."),
    ("C37412-24",  "10/11/1986", "11:15",
     "President Reagan and Soviet General Secretary Gorbachev meet at Hofdi House with George Shultz, Eduard Shevardnadze, Jack Matlock and translator Dmitry Zarechnak during the Reykjavik Summit. Iceland."),
    ("C37414-10",  "10/11/1986", "13:00",
     "President Reagan having a Luncheon with Staff \u2014 Ken Adelman, Donald Regan, George Shultz, Max Kampelman, John Poindexter, Richard Perle \u2014 at U.S. Ambassador\u2019s residence, Reykjavik, Iceland."),
    ("C37418-7",   "10/12/1986", "08:00",
     "President Reagan in a staff briefing with Ken Adelman, George Shultz, Donald Regan, Robert Linhard, Paul Nitze, and John Poindexter in Hofdi House during the Reykjavik Summit in Iceland."),
    ("C37418-5",   "10/12/1986", "08:00",
     "President Reagan in a staff briefing with Ken Adelman, George Shultz, Donald Regan, Richard Perle, Robert Linhard and John Poindexter in Hofdi House during the Reykjavik Summit in Iceland."),
    ("C37419-19",  "10/12/1986", "09:00",
     "President Reagan in a staff briefing with Ken Adelman, George Shultz, Donald Regan, Paul Nitze, and John Poindexter in Hofdi House during the Reykjavik Summit in Iceland."),
    ("C37419-20",  "10/12/1986", "09:00",
     "President Reagan in a staff briefing with Paul Nitze, Donald Regan, George Shultz, Ken Adelman, John Poindexter, Richard Perle and Max Kampelman in Hofdi House during the Reykjavik Summit in Iceland."),
    ("C37435-18",  "10/12/1986", "10:00",
     "President Reagan greets Soviet General Secretary Gorbachev at Hofdi House during the Reykjavik Summit. Iceland."),
    ("C37428-2",   "10/12/1986", "18:00",
     "President Reagan says goodbye to Soviet General Secretary Gorbachev after the last meeting at Hofdi House, Reykjavik, Iceland."),
    ("C37428-10",  "10/12/1986", "18:00",
     "President Reagan says goodbye to Soviet General Secretary Gorbachev after the last meeting at Hofdi House, Reykjavik, Iceland."),
    ("C37428-11",  "10/12/1986", "18:00",
     "President Reagan says goodbye to Soviet General Secretary Gorbachev after the last meeting at Hofdi House, Reykjavik, Iceland."),
    ("C37428-18",  "10/12/1986", "18:00",
     "President Reagan says goodbye to Soviet General Secretary Gorbachev after the last meeting at Hofdi House, Reykjavik, Iceland."),
    ("C37428-19",  "10/12/1986", "18:00",
     "President Reagan says goodbye to Soviet General Secretary Gorbachev after the last meeting at Hofdi House, Reykjavik, Iceland."),
    ("C37432-20",  "10/12/1986", "20:00",
     "President Reagan in a briefing regarding his speech at Keflavik airport with David Chew, Dennis Thomas, Pat Buchanan, Donald Regan, John Poindexter in Keflavik, Iceland."),
]


def resolve_urls(html: str) -> dict:
    """Map each photo id to the actual href on the Library page.

    The Library serves plates at a few different URL patterns:
      /public/archives/photographs/large/<id>.jpg (canonical)
      /sites/default/files/2025-04/40-whpo-<id>_N.jpg (revised)
    We accept either.
    """
    urls = {}
    for pid, _date, _time, _caption in PHOTOS:
        lower = pid.lower()
        m = re.search(rf'<a href="([^"]+{re.escape(lower)}[^"]*\.jpg)"', html, re.IGNORECASE)
        href = m.group(1) if m else f"/public/archives/photographs/large/{lower}.jpg"
        urls[pid] = href if href.startswith("http") else f"https://www.reaganlibrary.gov{href}"
    return urls


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "reykjavik-40/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> int:
    print(f"[fetch_reagan_photos] gallery -> {GALLERY_URL}")
    html = fetch(GALLERY_URL).decode("utf-8", errors="replace")
    urls = resolve_urls(html)

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)

    records = []
    for seq, (pid, date, time_hint, caption) in enumerate(PHOTOS, 1):
        lower = pid.lower()
        fname = f"{lower}.jpg"
        dst = PHOTOS_DIR / fname
        if not dst.exists() or dst.stat().st_size < 5000:
            print(f"  [{seq:>2}] fetch {pid} ({urls[pid]})")
            dst.write_bytes(fetch(urls[pid]))
        else:
            print(f"  [{seq:>2}] cached {pid}")
        # thumbnail
        thumb = THUMBS_DIR / fname
        if Image is not None and (not thumb.exists() or thumb.stat().st_size < 5000):
            im = Image.open(dst)
            im.thumbnail((640, 640))
            im.save(thumb, "JPEG", quality=82, optimize=True)
        # normalise date -> ISO
        mo, dy, yr = date.split("/")
        iso = f"{yr}-{int(mo):02d}-{int(dy):02d}"
        records.append({
            "id": pid,
            "date": iso,
            "time_hint": time_hint,
            "caption": caption,
            "source_url": urls[pid],
            "filename": fname,
            "seq": seq,
        })

    payload = {
        "source": GALLERY_URL,
        "collection": "White House Photographic Collection, Ronald Reagan Presidential Library",
        "summit": "Reykjavik Summit",
        "location": "H\u00f6f\u00f0i House, Reykjav\u00edk, Iceland",
        "photographers": "White House Photo Office",
        "count": len(records),
        "photos": records,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    for out in (DATA_DIR / "reagan_photos.json", DOCS_DATA / "reagan_photos.json"):
        out.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"  wrote {out.relative_to(ROOT)}")
    print(f"[fetch_reagan_photos] {len(records)} plates ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
