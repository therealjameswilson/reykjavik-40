#!/usr/bin/env python3
"""
Ingest Reykjavik-tagged FRUS documents from the hsg-annotate-data
annotated TEI corpus.

The Office of the Historian's annotation program tags documents with
the Event entity "Reykjavik Summit (1986)". Volumes V and VI are
already ingested from HistoryAtState/frus by parse_frus.py; this
script picks up the tagged documents that fall OUTSIDE those parsed
ranges — the Volume XI (START I) negotiation trail and the early
Volume V preparation record — by parsing the per-document TEI files
in the sibling hsg-annotate-data repository.

Persons are attached later by enrich_core.py from the People
annotation extracts, uniformly for the whole corpus, so this parser
emits an empty persons[] list.

Output: data/frus_hsg_supplement.json (a 4th feed for build_core.py).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from parse_frus import TOPIC_PATTERNS, text_of, qn

DATA = Path("data")
DEFAULT_HSG = Path("../hsg-project/repos/hsg-annotate-data")

REYKJAVIK_EVENT = "Reykjavik Summit (1986)"

# Ranges already ingested from HistoryAtState/frus by parse_frus.py.
PARSED_RANGES = {
    "frus1981-88v05": range(267, 310),
    "frus1981-88v06": range(1, 40),
}

SOURCE_LABELS = {
    "frus1981-88v05": "FRUS 1981-1988 v05",
    "frus1981-88v06": "FRUS 1981-1988 v06",
    "frus1981-88v11": "FRUS 1981-1988 v11",
}


def event_tagged_docs(hsg: Path) -> dict[str, list[str]]:
    """volume -> [dN, ...] tagged with the Reykjavik Summit event."""
    out: dict[str, list[str]] = {}
    for extract in sorted((hsg / "tei").glob("annotations_frus1981-88*.xml")):
        volume = extract.stem.replace("annotations_", "")
        for e in ET.parse(extract).findall(".//entry"):
            if e.findtext("table_name") == "Events" and e.findtext("entity_name") == REYKJAVIK_EVENT:
                out[volume] = sorted(
                    {
                        (d.findtext("doc_number") or "").split("#")[1]
                        for d in e.findall(".//document")
                        if "#" in (d.findtext("doc_number") or "")
                    },
                    key=lambda d: int(d[1:]),
                )
    return out


def dateline_date(root: ET.Element) -> tuple[str, str]:
    """(iso, human) from the first dateline date."""
    for date in root.findall(f".//{qn('dateline')}//{qn('date')}"):
        when = date.get("when") or date.get("notBefore") or ""
        m = re.match(r"\d{4}-\d{2}-\d{2}", when)
        if m:
            return m.group(0), text_of(date)
    return "", ""


def dateline_place(root: ET.Element) -> str:
    place = root.find(f".//{qn('dateline')}//{qn('placeName')}")
    return text_of(place) if place is not None else ""


def body_paragraphs(root: ET.Element) -> list[str]:
    body = root.find(f".//{qn('body')}")
    if body is None:
        return []
    return [t for p in body.iter(qn("p")) if (t := text_of(p))]


def volume_dates(hsg: Path, volume: str) -> dict[int, str]:
    """Dateline date per document number for a whole volume, used to
    interpolate the phase of undated editorial notes (documents are
    ordered chronologically within a FRUS volume)."""
    out: dict[int, str] = {}
    for path in (hsg / "data" / "documents" / volume).glob("d*.xml"):
        m = re.fullmatch(r"d(\d+)", path.stem)
        if not m:
            continue
        iso, _ = dateline_date(ET.parse(path).getroot())
        if iso:
            out[int(m.group(1))] = iso
    return out


def interpolated_date(doc_num: int, dates: dict[int, str]) -> str:
    """Nearest preceding dated document's date (volume order is chronological)."""
    below = [n for n in dates if n < doc_num]
    return dates[max(below)] if below else ""


def phase_for(iso_date: str) -> str:
    if not iso_date:
        return ""
    if iso_date < "1986-10-11":
        return "pre-summit"
    if iso_date > "1986-10-12":
        return "aftermath"
    return "summit"


def parse_doc(hsg: Path, volume: str, doc: str, vol_dates: dict[int, str]) -> dict[str, Any] | None:
    path = hsg / "data" / "documents" / volume / f"{doc}.xml"
    if not path.exists():
        return None
    root = ET.parse(path).getroot()
    doc_num = int(doc[1:])

    title_el = root.find(f".//{qn('titleStmt')}/{qn('title')}")
    title = (title_el.text or "").strip() if title_el is not None else ""

    url = ""
    canonical = root.find(f".//{qn('relatedItem')}[@type='canonical']")
    if canonical is not None:
        url = canonical.get("target", "")

    subtype = ""
    for bibl in root.findall(f".//{qn('bibl')}"):
        if bibl.get("type") == "frus-div-subtype":
            subtype = (bibl.text or "").strip()

    iso_date, human_date = dateline_date(root)
    # Editorial notes have no dateline; interpolate from volume order so
    # the phase is right, but leave `date` empty rather than assert one.
    phase_date = iso_date or interpolated_date(doc_num, vol_dates)

    paragraphs = body_paragraphs(root)
    body_text = " ".join(paragraphs)
    excerpt = ""
    for p in paragraphs:
        excerpt = (excerpt + " " + p).strip()
        if len(excerpt) >= 480:
            excerpt = excerpt[:479].rsplit(" ", 1)[0] + "..."
            break

    return {
        "doc_id": f"{volume}-{doc}",
        "doc_number": doc_num,
        "source": SOURCE_LABELS.get(volume, volume),
        "source_kind": subtype or "document",
        "title": title,
        "date": iso_date,
        "date_display": human_date,
        "place": dateline_place(root),
        "url": url or f"https://history.state.gov/historicaldocuments/{volume}/{doc}",
        "summit_phase": phase_for(phase_date),
        "session": "",
        "principals": "",
        "venue": "",
        "persons": [],  # attached by enrich_core.py from the People annotations
        "topics": [t for t, pattern in TOPIC_PATTERNS if pattern.search(body_text)],
        "verified": True,
        "excerpt": excerpt,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--hsg", type=Path, default=DEFAULT_HSG,
                    help="path to the hsg-annotate-data repository")
    ap.add_argument("--out", type=Path, default=DATA / "frus_hsg_supplement.json")
    args = ap.parse_args()

    if not (args.hsg / "tei").is_dir():
        print(f"error: {args.hsg} does not look like hsg-annotate-data", file=sys.stderr)
        return 1

    records: list[dict[str, Any]] = []
    for volume, docs in sorted(event_tagged_docs(args.hsg).items()):
        parsed_range = PARSED_RANGES.get(volume)
        wanted = [d for d in docs if parsed_range is None or int(d[1:]) not in parsed_range]
        if not wanted:
            continue
        vol_dates = volume_dates(args.hsg, volume)
        for doc in wanted:
            record = parse_doc(args.hsg, volume, doc, vol_dates)
            if record:
                records.append(record)
        print(f"{volume}: {len(wanted)} documents ingested from annotated TEI")

    records.sort(key=lambda r: (r["date"] or "9999", r["doc_id"]))
    args.out.write_text(json.dumps(records, indent=2, ensure_ascii=False))
    print(f"total: {len(records)} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
