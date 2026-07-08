#!/usr/bin/env python3
"""
Build the Höfði House stage data: the documented meetings of the two
summit days, with attendance and times taken from the memcons themselves.

Each summit memcon in FRUS 1981-1988 Vol. V carries a
<list type="participants"> (attendance by side, as printed) and a
dateline <date from=".." to=".."> (the meeting window). This script
extracts both for every Oct 11-12 document that has them, resolves
attendees to the same canonical person ids used by the register (via
the tei_id / surname mappings already present in frus_core.json), and
emits data/summit_stage.json (mirrored to docs/data/).

Run after enrich_core.py (it reads frus_core.json for person identity).
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from parse_frus import SESSION_MAP, text_of, qn

TEI = "http://www.tei-c.org/ns/1.0"
XML = "http://www.w3.org/XML/1998/namespace"

DATA = Path("data")
DOCS_DATA = Path("docs") / "data"

VOLUME = "frus1981-88v05"
SUMMIT_DAYS = ("1986-10-11", "1986-10-12")

# The machine-readable window on d303 duplicates Session II's
# (15:30-17:40); the printed dateline reads "October 11-12, 1986,
# 8 p.m.-4 a.m." The printed text wins.
WINDOW_OVERRIDES = {
    "d303": ("1986-10-11T20:00:00+00:00", "1986-10-12T04:00:00+00:00"),
}

# Caption context shown with a meeting, where the record needs a caveat
# or a pointer to a parallel meeting without its own memcon.
CAPTION_NOTES = {
    "d303": (
        "This draft memcon of the political working group was disavowed by "
        "Ridgway and included as a matter of record. The parallel arms-control "
        "working group (Nitze–Akhromeyev) met through the same night; its "
        "record survives as Document 304, an editorial note."
    ),
}


def build_person_lookup() -> tuple[
    dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]
]:
    """tei_id -> person, canonical id -> person, and unambiguous
    surname -> person, from the enriched corpus (so stage tokens share
    ids with the register)."""
    records = json.loads((DATA / "frus_core.json").read_text())
    by_tei: dict[str, dict[str, Any]] = {}
    by_id: dict[str, dict[str, Any]] = {}
    by_surname: dict[str, list[dict[str, Any]]] = {}
    for r in records:
        for p in r.get("persons", []):
            if not p.get("in_network") or p["id"] in by_id:
                continue
            entry = {"id": p["id"], "name": p["name"], "side": p.get("side", ""), "tier": p.get("tier", "")}
            by_id[p["id"]] = entry
            if p.get("tei_id"):
                by_tei.setdefault(p["tei_id"], entry)
            surname = p["name"].split()[-1].lower() if p["name"].split() else ""
            by_surname.setdefault(surname, []).append(entry)
    unique_surname = {s: v[0] for s, v in by_surname.items() if len(v) == 1}
    return by_tei, by_id, unique_surname


# Attendance entries that are titles rather than names, as printed —
# mapped to canonical ids (surnames alone are ambiguous: Nancy Reagan
# and Raisa Gorbachev are also in the register).
TITLE_ALIASES = {
    "the president": "reagan_gorbachev.reagan",
    "the general secretary": "reagan_gorbachev.gorbachev",
    "the secretary": "us.shultz",
}

# Generic entries that are not people.
NON_PERSON = {"notetaker", "note taker", "others?", "others", "interpreter"}


def side_of_head(head_text: str) -> str:
    t = head_text.upper()
    if "USSR" in t or "SOVIET" in t:
        return "USSR"
    return "US"


def clean_item_name(item_text: str) -> tuple[str, str]:
    """('Secretary Shultz (came in at 11:30)') -> ('Secretary Shultz', 'came in at 11:30')."""
    note = ""
    m = re.search(r"\(([^)]*)\)\s*$", item_text)
    if m:
        note = m.group(1).strip()
        item_text = item_text[: m.start()].strip()
    return re.sub(r"\s+", " ", item_text).strip(), note


def extract_meetings(volume_xml: Path) -> list[dict[str, Any]]:
    by_tei, by_id, by_surname = build_person_lookup()
    tree = ET.parse(volume_xml)
    meetings: list[dict[str, Any]] = []

    for div in tree.iter(qn("div")):
        if div.get("type") != "document":
            continue
        xid = div.get(f"{{{XML}}}id", "")
        plist = div.find(qn("list") + "[@type='participants']")
        date = div.find(f".//{qn('dateline')}/{qn('date')}")
        if plist is None or date is None:
            continue
        start = date.get("from") or date.get("when") or ""
        end = date.get("to") or ""
        if start[:10] not in SUMMIT_DAYS:
            continue
        if xid in WINDOW_OVERRIDES:
            start, end = WINDOW_OVERRIDES[xid]

        attendees = []
        for side_item in plist.findall(qn("item")):
            sublist = side_item.find(qn("list"))
            if sublist is None:
                continue
            head = sublist.find(qn("head"))
            side = side_of_head(text_of(head) if head is not None else "")
            for item in sublist.findall(qn("item")):
                display, note = clean_item_name(text_of(item))
                if not display or display.lower().rstrip(".") in NON_PERSON:
                    continue
                pn = item.find(f".//{qn('persName')}")
                person = None
                if pn is not None:
                    tei_id = (pn.get("corresp") or "").lstrip("#")
                    person = by_tei.get(tei_id)
                if person is None and display.lower() in TITLE_ALIASES:
                    person = by_id.get(TITLE_ALIASES[display.lower()])
                if person is None:
                    # Strip a trailing ", Interpreter"-style role before
                    # taking the surname.
                    base = display.split(",")[0].strip()
                    surname = base.split()[-1].lower().rstrip(".") if base.split() else ""
                    candidate = by_surname.get(surname)
                    if candidate and (candidate["side"] == side or candidate["side"] == "other"):
                        person = candidate
                attendees.append(
                    {
                        "id": person["id"] if person else None,
                        "name": person["name"] if person else display,
                        "display": display,
                        "side": side,
                        "tier": person["tier"] if person else "",
                        "note": note,
                    }
                )

        info = SESSION_MAP.get(xid, {})
        doc_num = int(xid[1:])
        meetings.append(
            {
                "doc_id": f"{VOLUME}-{xid}",
                "doc_number": doc_num,
                "url": f"https://history.state.gov/historicaldocuments/{VOLUME}/{xid}",
                "session": info.get("session", ""),
                "principals": info.get("principals", ""),
                "venue": info.get("venue", "Hofdi House"),
                "start": start,
                "end": end,
                "time_display": text_of(date),
                "caption_note": CAPTION_NOTES.get(xid, ""),
                "attendees": attendees,
            }
        )

    meetings.sort(key=lambda m: m["start"])
    return meetings


def main() -> int:
    volume_xml = DATA / "raw" / f"{VOLUME}.xml"
    if not volume_xml.exists():
        print(f"error: {volume_xml} not found (run parse_frus.py first)", file=sys.stderr)
        return 1
    meetings = extract_meetings(volume_xml)
    out = {"volume": VOLUME, "days": list(SUMMIT_DAYS), "meetings": meetings}
    payload = json.dumps(out, indent=2, ensure_ascii=False)
    (DATA / "summit_stage.json").write_text(payload)
    (DOCS_DATA / "summit_stage.json").write_text(payload)
    for m in meetings:
        unresolved = [a["display"] for a in m["attendees"] if not a["id"]]
        print(f"{m['doc_id']}  {m['start'][11:16]}-{m['end'][11:16] if m['end'] else '?'}  "
              f"{len(m['attendees'])} attendees  {m['session'] or '(unmapped session)'}"
              + (f"  unresolved: {unresolved}" if unresolved else ""))
    print(f"total meetings: {len(meetings)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
